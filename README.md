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

## Correlation and Routing

- `external_request_id` = one external action idempotency key.
- `case_id` (send as `correlation_id`) = broader business case that can contain multiple requests and audit records.
- `in_reply_to` = direct continuation of a prior request or audit record.
- `POST /api/centcom/v1/requests/control-map` previews role mapping, fallback reviewers, shift coverage, and policy satisfiability before request creation.

## Customer Agent Plugin Pattern

Build one adapter around the SDK so the customer agent can call a tiny, stable tool surface:

```ts
type ControlMapCache = { value: unknown; ts: number } | null;

export class Contro1Plugin {
  private cache: ControlMapCache = null;
  constructor(private client: CentcomClient) {}

  async previewPolicy(payload: Record<string, unknown>, ttlMs = 5 * 60_000) {
    if (this.cache && Date.now() - this.cache.ts < ttlMs) return this.cache.value;
    const value = await this.client.post('/api/centcom/v1/requests/control-map', payload);
    this.cache = { value, ts: Date.now() };
    return value;
  }

  requestHumanReview(input: { title: string; context: string; case_id: string; action_id: string } & Record<string, unknown>) {
    return this.client.createProtocolRequest({
      title: input.title,
      context: input.context,
      correlation_id: input.case_id,
      external_request_id: input.action_id,
      ...input,
    });
  }

  logAuditAction(input: { action: string; summary: string; case_id: string; in_reply_to?: { type: 'request' | 'audit_record'; id: string } } & Record<string, unknown>) {
    return this.client.logAction({
      action: input.action,
      summary: input.summary,
      correlation_id: input.case_id,
      in_reply_to: input.in_reply_to,
      ...input,
    });
  }
}
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
- `skills/contro1-eu-oversight.md`
- `skills/contro1-us-ai-governance.md`

## Ask a human

```ts
const client = new CentcomClient({ apiKey: process.env.CONTRO1_API_KEY! });
const threadId = client.newThreadId();

const request = await client.createProtocolRequest({
  title: 'Approve vendor transfer?',
  request_type: 'approval',
  source: { integration: 'finance-agent' },
  continuation: { mode: 'decision', webhook_url: 'https://agent.example.com/webhook' },
  external_request_id: 'payment:run_1024:approve',
  correlation_id: 'case_payment_run_1024',
});
```

## Log an autonomous action

```ts
await client.logAction({
  action: 'transfer.executed',
  summary: 'Transferred $500 to approved vendor account',
  source: { integration: 'finance-agent' },
  outcome: 'success',
  correlation_id: 'case_payment_run_1024',
  in_reply_to: { type: 'request', id: request.id },
});
```

Use `createProtocolRequest` for human review and `logAction` for audit-only records.
