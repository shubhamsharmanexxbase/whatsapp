# WhatsApp AI Chatbot Web App

A full-stack WhatsApp business chatbot dashboard that:

- Connects to WhatsApp Cloud API (Meta Graph API)
- Handles webhook-based inbound messages
- Stores and displays conversation history
- Uses OpenAI for AI auto-replies (optional)
- Supports manual send and broadcast messaging from the web UI

## Features

- **Conversation inbox** with all message history per contact
- **Message thread view** for selected WhatsApp number
- **Manual sending** to any selected conversation
- **Broadcast messaging** to multiple recipients
- **Webhook verification + ingestion** for WhatsApp events
- **AI replies** to inbound customer messages

## Tech Stack

- Backend: Node.js + Express
- Frontend: Vanilla HTML/CSS/JS (served by Express)
- Storage: JSON file (`data/messages.json`)
- APIs: WhatsApp Cloud API + OpenAI Chat Completions API

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment:

```bash
cp .env.example .env
```

Set:

- `WHATSAPP_TOKEN` (Meta permanent/system access token)
- `WHATSAPP_PHONE_NUMBER_ID` (WhatsApp business number id)
- `WHATSAPP_VERIFY_TOKEN` (for webhook verification)
- `OPENAI_API_KEY` (optional; if missing, fallback auto-replies are used)

3. Run:

```bash
npm start
```

Open `http://localhost:3000`.

## WhatsApp Webhook Configuration

Set callback URL to:

- `https://<your-domain>/api/webhook`

Verification token should match `.env`:

- `WHATSAPP_VERIFY_TOKEN`

## Main API Endpoints

- `GET /api/conversations` - list conversation summaries
- `GET /api/conversations/:waId/messages` - get full message history
- `POST /api/messages/send` - send one message
- `POST /api/messages/broadcast` - send to many recipients
- `GET /api/webhook` - verification endpoint
- `POST /api/webhook` - inbound WhatsApp message events

## Notes

- If WhatsApp credentials are not set, send/broadcast calls are **simulated** but still stored locally.
- For production, replace JSON-file storage with a DB (PostgreSQL/MySQL) and add authentication.
