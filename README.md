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
  priority: "urgent",
  approval_policy: {
    mode: "threshold",
    required_approvals: 2,
    required_roles: ["manager", "admin"],
    separation_of_duties: true,
    fail_closed_on_timeout: true
  }
});

console.log(req.id, req.state);
```

For high-risk actions, callbacks are delivered only after quorum is met, a reviewer rejects, or the request times out. Partial approvals are audit events and do not resume the agent.

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

## Quick Verify

```bash
node -e "import('@contro1/sdk').then(() => console.log('sdk installed'))"
```

## Related Packages

- [`centcom`](https://github.com/contro1-hq/centcom) for Python backend integrations
- [`centcom-langgraph`](https://github.com/contro1-hq/centcom-langgraph) for LangGraph workflows
- [`@contro1/claude-code`](https://github.com/contro1-hq/centcom-claude-code) for Claude Code approvals

## Skill

This repo includes an integration skill:
- `skills/centcom-js-sdk.md`

## Ask a human

```ts
const client = new CentcomClient({ apiKey: process.env.CONTRO1_API_KEY! });
const threadId = client.newThreadId();

const request = await client.createProtocolRequest({
  title: 'Approve vendor transfer?',
  request_type: 'approval',
  source: { integration: 'finance-agent' },
  continuation: { mode: 'decision', webhook_url: 'https://agent.example.com/webhook' },
  thread_id: threadId,
});
```

## Log an autonomous action

```ts
await client.logAction({
  action: 'transfer.executed',
  summary: 'Transferred $500 to approved vendor account',
  source: { integration: 'finance-agent' },
  outcome: 'success',
  thread_id: threadId,
  in_reply_to: { type: 'request', id: request.id },
});
```

Use `createProtocolRequest` for human review and `logAction` for audit-only records.
