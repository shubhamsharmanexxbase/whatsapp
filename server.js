require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'messages.json');

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ conversations: {} }, null, 2));
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function nowIso() {
  return new Date().toISOString();
}

function upsertMessage({ wa_id, from, role, text, timestamp }) {
  const db = readDb();
  if (!db.conversations[wa_id]) {
    db.conversations[wa_id] = {
      wa_id,
      contact_name: wa_id,
      last_updated: timestamp || nowIso(),
      messages: []
    };
  }
  const convo = db.conversations[wa_id];
  convo.last_updated = timestamp || nowIso();
  convo.messages.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    from,
    role,
    text,
    timestamp: timestamp || nowIso()
  });
  writeDb(db);
  return convo;
}

function listConversations() {
  const db = readDb();
  return Object.values(db.conversations)
    .map((c) => ({
      wa_id: c.wa_id,
      contact_name: c.contact_name,
      last_updated: c.last_updated,
      last_message: c.messages[c.messages.length - 1]?.text || ''
    }))
    .sort((a, b) => new Date(b.last_updated) - new Date(a.last_updated));
}

function getConversation(wa_id) {
  const db = readDb();
  return db.conversations[wa_id] || null;
}

async function callOpenAI(prompt) {
  if (!process.env.OPENAI_API_KEY) {
    return `Auto-reply: I received your message \"${prompt}\". (Set OPENAI_API_KEY for smarter replies.)`;
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a concise business support assistant for WhatsApp customers.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.4
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${errText}`);
  }

  const json = await response.json();
  return json.choices?.[0]?.message?.content?.trim() || 'Thanks for your message!';
}

async function sendWhatsAppText(to, text) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    return { simulated: true, message: 'WhatsApp credentials missing; message stored locally only.' };
  }

  const response = await fetch(
    `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        text: { body: text }
      })
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`WhatsApp API error ${response.status}: ${errText}`);
  }

  return response.json();
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, at: nowIso() });
});

app.get('/api/conversations', (_req, res) => {
  res.json({ conversations: listConversations() });
});

app.get('/api/conversations/:waId/messages', (req, res) => {
  const convo = getConversation(req.params.waId);
  if (!convo) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  res.json({ conversation: convo });
});

app.post('/api/messages/send', async (req, res) => {
  const { to, text } = req.body || {};
  if (!to || !text) return res.status(400).json({ error: '`to` and `text` are required' });

  upsertMessage({ wa_id: to, from: 'business', role: 'outgoing', text, timestamp: nowIso() });

  try {
    const whatsappResult = await sendWhatsAppText(to, text);
    res.json({ ok: true, whatsappResult });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.post('/api/messages/broadcast', async (req, res) => {
  const { recipients, text } = req.body || {};
  if (!Array.isArray(recipients) || recipients.length === 0 || !text) {
    return res.status(400).json({ error: '`recipients` (non-empty array) and `text` are required' });
  }

  const results = [];
  for (const to of recipients) {
    upsertMessage({ wa_id: to, from: 'business', role: 'outgoing', text, timestamp: nowIso() });
    try {
      const whatsappResult = await sendWhatsAppText(to, text);
      results.push({ to, ok: true, whatsappResult });
    } catch (error) {
      results.push({ to, ok: false, error: error.message });
    }
  }

  res.json({ ok: true, total: recipients.length, results });
});

app.get('/api/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.status(403).send('Verification failed');
});

app.post('/api/webhook', async (req, res) => {
  try {
    const entries = req.body.entry || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const contact = (value.contacts && value.contacts[0]) || null;
        const messages = value.messages || [];

        for (const message of messages) {
          const from = message.from;
          const text = message.text?.body || '[non-text message]';
          const timestamp = message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : nowIso();
          const name = contact?.profile?.name || from;

          const db = readDb();
          if (!db.conversations[from]) {
            db.conversations[from] = {
              wa_id: from,
              contact_name: name,
              last_updated: timestamp,
              messages: []
            };
          }
          db.conversations[from].contact_name = name;
          writeDb(db);

          upsertMessage({ wa_id: from, from: name, role: 'incoming', text, timestamp });

          const aiReply = await callOpenAI(text);
          upsertMessage({ wa_id: from, from: 'AI Assistant', role: 'outgoing', text: aiReply, timestamp: nowIso() });

          try {
            await sendWhatsAppText(from, aiReply);
          } catch (sendErr) {
            console.error('Failed to send WhatsApp AI reply:', sendErr.message);
          }
        }
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  ensureDb();
  console.log(`WhatsApp AI chatbot app running at http://localhost:${PORT}`);
});
