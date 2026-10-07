# WhatsApp Gateway

A lightweight Node.js WhatsApp messaging gateway built for sending automated notifications and scheduled summaries through a linked WhatsApp account.

The gateway exposes a protected REST API that can be called by external services such as Supabase Edge Functions.

## Overview

The service connects to WhatsApp as a linked device and provides an HTTP endpoint for sending messages to one or multiple recipients.

Current architecture:

```text
Supabase
   │
   │ Scheduled Edge Function
   ▼
WhatsApp Gateway
   │
   │ Protected REST API
   ▼
WhatsApp Linked Device
   │
   ├── Recipient 1
   ├── Recipient 2
   └── Recipient N
```

The initial use case is sending a scheduled daily social-listening summary generated from data stored in Supabase.

## Features

- WhatsApp linked-device connection
- Persistent WhatsApp authentication session
- REST API for sending messages
- Single or multiple recipients
- API secret authentication
- Automatic WhatsApp reconnection
- Health-check endpoint
- Recipient numbers masked in application logs
- Environment-based configuration
- Designed for integration with Supabase Edge Functions and Cron

## API

### Health Check

```http
GET /health
```

Example response:

```json
{
  "success": true,
  "service": "WhatsApp Gateway",
  "whatsapp_connected": true
}
```

### Send Message

```http
POST /send
```

Authentication:

```http
Authorization: Bearer <API_SECRET>
```

Example request:

```json
{
  "to": [
    "+9665XXXXXXXX",
    "+9665XXXXXXXX"
  ],
  "message": "Daily summary"
}
```

Example response:

```json
{
  "success": true,
  "total": 2,
  "sent": 2,
  "failed": 0
}
```

## Environment Variables

Create a local `.env` file:

```env
PORT=3000
API_SECRET=your_private_api_secret
```

An `.env.example` file is included for reference.

Never commit real credentials to the repository.

## Installation

Install dependencies:

```bash
npm install
```

Start the gateway:

```bash
node index.js
```

On the first run, link a WhatsApp account using:

**WhatsApp → Settings → Linked Devices → Link a Device**

Scan the QR code displayed by the gateway.

## Security

Sensitive files must never be committed to Git.

The following are excluded through `.gitignore`:

```text
.env
auth_info/
node_modules/
```

`auth_info/` contains the WhatsApp linked-device session and must be treated as sensitive authentication material.

API requests to `/send` are protected using the `API_SECRET` environment variable.

Production secrets should be configured through the hosting platform's environment-variable or secret-management system rather than stored in source code.

## Planned Integration

The production workflow will be:

```text
Supabase tweets table
        ↓
Supabase Cron
        ↓
Daily Summary Edge Function
        ↓
WhatsApp Gateway
        ↓
WhatsApp recipients
```

The gateway is responsible only for message delivery. Summary generation, scheduling, and tweet processing remain within Supabase.

## Disclaimer

This project uses a linked-device WhatsApp integration rather than the official WhatsApp Business Platform.

It is intended for development, testing, and controlled messaging to authorized recipients. Use responsibly and comply with WhatsApp's applicable terms and messaging policies.