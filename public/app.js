let selectedWaId = null;

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function formatTime(ts) {
  return new Date(ts).toLocaleString();
}

async function loadConversations() {
  const { conversations } = await api('/api/conversations');
  const list = document.getElementById('conversationList');
  list.innerHTML = '';

  if (conversations.length === 0) {
    list.textContent = 'No messages yet. Connect webhook and send a WhatsApp message.';
    return;
  }

  conversations.forEach((c) => {
    const div = document.createElement('div');
    div.className = `conversation-item ${c.wa_id === selectedWaId ? 'active' : ''}`;
    div.innerHTML = `
      <strong>${c.contact_name}</strong><br>
      <small>${c.wa_id}</small>
      <div>${c.last_message || ''}</div>
    `;
    div.onclick = () => {
      selectedWaId = c.wa_id;
      renderConversation();
      loadConversations();
    };
    list.appendChild(div);
  });

  if (!selectedWaId) {
    selectedWaId = conversations[0].wa_id;
    renderConversation();
  }
}

async function renderConversation() {
  if (!selectedWaId) return;
  const { conversation } = await api(`/api/conversations/${selectedWaId}/messages`);

  document.getElementById('chatTitle').textContent = `Messages · ${conversation.contact_name} (${conversation.wa_id})`;

  const messagesEl = document.getElementById('messages');
  messagesEl.innerHTML = '';

  conversation.messages.forEach((m) => {
    const div = document.createElement('div');
    div.className = `bubble ${m.role === 'incoming' ? 'incoming' : 'outgoing'}`;
    div.innerHTML = `<div>${m.text}</div><small>${m.from} · ${formatTime(m.timestamp)}</small>`;
    messagesEl.appendChild(div);
  });

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

document.getElementById('sendForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!selectedWaId) return alert('Select a conversation first.');

  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text) return;

  await api('/api/messages/send', {
    method: 'POST',
    body: JSON.stringify({ to: selectedWaId, text })
  });

  input.value = '';
  await renderConversation();
  await loadConversations();
});

document.getElementById('broadcastForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const recipientsRaw = document.getElementById('recipientsInput').value;
  const text = document.getElementById('broadcastMessage').value.trim();

  const recipients = recipientsRaw
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

  const resultEl = document.getElementById('broadcastResult');
  resultEl.textContent = 'Sending...';

  try {
    const result = await api('/api/messages/broadcast', {
      method: 'POST',
      body: JSON.stringify({ recipients, text })
    });
    resultEl.textContent = JSON.stringify(result, null, 2);
    await loadConversations();
    if (selectedWaId) await renderConversation();
  } catch (err) {
    resultEl.textContent = `Error: ${err.message}`;
  }
});

loadConversations();
setInterval(loadConversations, 5000);
