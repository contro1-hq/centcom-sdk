---
name: centcom-js-sdk
description: Guide for integrating the CENTCOM JavaScript/TypeScript SDK in Node backends and agents.
user_invocable: true
---

# CENTCOM JS/TS SDK Integration Guide

You are helping a developer integrate `@contro1/sdk` into an existing JavaScript or TypeScript codebase.

## Step 1: Read Existing Integration Points

Identify:
- Where they currently call external services requiring approval
- Where webhook endpoints can be mounted
- Whether runtime is Express/Fastify/Next API routes

## Step 2: Install and Configure

Install package:

```bash
npm install @contro1/sdk
```

Set env:

```bash
CENTCOM_API_KEY=cc_live_xxx
```

Optional:
- `CENTCOM_BASE_URL`
- Webhook secret for signature verification

## Step 3: Initialize Client

```ts
import { CentcomClient } from "@contro1/sdk";

const client = new CentcomClient({
  apiKey: process.env.CENTCOM_API_KEY!,
});
```

## Step 4: Create Approval Requests

```ts
const req = await client.createRequest({
  type: "approval",
  question: "Approve production deploy?",
  context: "Release 2026.03.16 includes billing migration.",
  callback_url: "https://your-app.com/centcom-webhook",
  priority: "urgent",
  metadata: { service: "deploy-bot" },
});
```

`callback_url` can be omitted for polling-only integrations.

Mini example (role-gated request):
```ts
const req = await client.createRequest({
  type: "approval",
  question: "Approve DB migration?",
  context: "Adds index to critical table",
  required_role: "admin",
});
```

## Step 5: Receive or Poll Decision

Webhook-first:
- Verify signature in webhook route
- Apply business decision from payload

Polling fallback:

```ts
const result = await client.waitForResponse(req.id, 3000, 600000);
```

## Step 6: Verify Webhook Signature

```ts
import { verifyWebhook } from "@contro1/sdk";

const valid = verifyWebhook(rawBody, signature, timestamp, webhookSecret);
```

If using Express middleware:

```ts
import { webhookMiddleware } from "@contro1/sdk";
app.post("/centcom-webhook", webhookMiddleware(process.env.CENTCOM_WEBHOOK_SECRET!));
```

## Safety Checklist

- Use idempotency key for retried request creation.
- Keep fallback behavior explicit (deny/abort on uncertainty).
- Redact secrets before logging context or tool input.
- Never commit API keys in source code.

## Related Skills

- LangGraph workflow skill:
  `https://github.com/contro1-hq/centcom-langgraph/blob/main/skills/centcom-langgraph.md`
- Claude connector skill:
  `https://github.com/contro1-hq/centcom-claude-code/blob/main/skills/centcom-claude-code.md`
