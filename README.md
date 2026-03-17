# @contro1/sdk

Official CENTCOM JavaScript/TypeScript SDK.

Use this package to:
- Create human approval requests
- Query request status
- Cancel pending requests
- Verify signed webhook callbacks

## Install

```bash
npm install @contro1/sdk
```

## Quick Start

```ts
import { CentcomClient } from "@contro1/sdk";

const client = new CentcomClient({ apiKey: process.env.CENTCOM_API_KEY! });

const req = await client.createRequest({
  type: "approval",
  context: "Order #123 refund request",
  question: "Approve refund?",
  callback_url: "https://your-app.com/centcom-webhook",
  priority: "urgent"
});

console.log(req.id, req.state);
```

## Webhook Verification

```ts
import { verifyWebhook } from "@contro1/sdk";

const isValid = verifyWebhook(rawBody, signature, timestamp, webhookSecret);
```

## API

- `CentcomClient`
  - `createRequest(params)`
  - `getRequest(requestId)`
  - `cancelRequest(requestId)`
  - `waitForResponse(requestId, intervalMs?, timeoutMs?)`
- `verifyWebhook(rawBody, signature, timestamp, secret)`
- `webhookMiddleware(secret)` for Express

## Related Packages

- `@contro1/claude-code` for Claude Code approvals
