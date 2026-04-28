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
const threadId = client.newThreadId();

const req = await client.createRequest({
  type: "approval",
  question: "Approve production deploy?",
  context: "Release 2026.03.16 includes billing migration.",
  callback_url: "https://your-app.com/centcom-webhook",
  priority: "urgent",
  thread_id: threadId,
  approval_policy: {
    mode: "threshold",
    required_approvals: 2,
    required_roles: ["manager", "admin"],
    separation_of_duties: true,
    fail_closed_on_timeout: true,
  },
  metadata: { service: "deploy-bot" },
});
```

`callback_url` can be omitted for polling-only integrations.

For high-risk actions, set `approval_policy.required_approvals = 2`. The first approval records an audit event but does not trigger the callback or polling terminal state; the request resolves only after quorum, rejection, cancellation, or timeout.

Mini example (role-gated request):
```ts
const req = await client.createRequest({
  type: "approval",
  question: "Approve DB migration?",
  context: "Adds index to critical table",
  required_role: "admin",
});
```

## Step 4b: Generate a Thread ID

Use `thread_id` when multiple requests and audit records belong to the same agent run, customer case, or incident.

```ts
const threadId = client.newThreadId();

const req = await client.createProtocolRequest({
  title: "Approve vendor transfer?",
  request_type: "approval",
  source: { integration: "finance-agent", workflow_id: "vendor-payment" },
  continuation: { mode: "decision", webhook_url: "https://your-app.com/centcom-webhook" },
  external_request_id: "vendor-payment:transfer-8842",
  thread_id: threadId,
});
```

Rules:
- Put the same `thread_id` on related requests and audit records.
- Use `external_request_id` for idempotency. Do not use `thread_id` as an idempotency key.
- Use `in_reply_to` when an audit record follows a specific request.

## Step 4c: Log Autonomous Actions

Use `client.logAction` when the agent already acted within policy and Contro1 should keep a durable audit record. This does not notify an operator or block execution.

```ts
await client.logAction({
  action: "vendor_transfer.executed",
  summary: "Transferred $500 to the approved vendor account",
  source: { integration: "finance-agent", workflow_id: "vendor-payment" },
  outcome: "success",
  thread_id: threadId,
  in_reply_to: { type: "request", id: req.id },
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
- Use thread_id to group related items, not to deduplicate requests.
- Use logAction for allowed autonomous actions that still need audit evidence.
- Keep fallback behavior explicit (deny/abort on uncertainty).
- Redact secrets before logging context or tool input.
- Never commit API keys in source code.
- Fail closed if quorum is not reached before timeout for deploys, payments, bulk deletion, or privilege escalation.

## Related Skills

- LangGraph workflow skill:
  `https://github.com/contro1-hq/centcom-langgraph/blob/main/skills/centcom-langgraph.md`
- Claude connector skill:
  `https://github.com/contro1-hq/centcom-claude-code/blob/main/skills/centcom-claude-code.md`

## Full Reference Links

- JavaScript/TypeScript SDK repo: https://github.com/contro1-hq/centcom-sdk
- Skill file source: https://github.com/contro1-hq/centcom-sdk/blob/main/skills/centcom-js-sdk.md
- TypeScript SDK skill: https://github.com/contro1-hq/centcom-sdk/blob/main/skills/centcom-typescript-sdk.md
- Python SDK repo: https://github.com/contro1-hq/centcom
- Audit records and threads docs: https://contro1.com/docs/audit-records-and-threads
- Requests API docs: https://contro1.com/docs/requests-api
