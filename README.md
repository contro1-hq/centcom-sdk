# @contro1/sdk

Official CENTCOM JavaScript/TypeScript SDK.

## Agent Integration Kit

To save time, give your coding agent this skill. It inspects your system, reports governance gaps, and suggests Contro1 integration (optional):

```
https://contro1.com/agent-kit
```

Use this package to:
- Create human approval requests
- Create canonical protocol requests
- Record audit-only agent actions
- Preview Control Map routing
- Query request status
- Export request/agent evidence
- Read thread and trace timelines
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
  risk_level: "high",
  policy_trigger: "Refunds above $1,000 require manager review.",
  policy_context: {
    source: "custom_rules",
    policy_name: "refund-controls",
    rule_id: "refund-over-1000",
    rule_reason: "Refunds above $1,000 require manager review.",
    policy_version: "git:8f42c1a",
    enforcement: "require_approval"
  },
  approval_comment_required: true,
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
- `POST /api/centcom/v1/requests/control-map` optionally previews role mapping, fallback reviewers, shift coverage, and policy satisfiability for complex routing.

## Policy evidence fields

Use these fields from any policy or risk source, not only a specific framework:

- `risk_level`: `low`, `medium`, `high`, or `critical`.
- `policy_trigger`: short human-readable reason review is required.
- `policy_context`: evidence envelope with `source`, `policy_name`, `rule_id`, `rule_reason`, `policy_version`, and `enforcement`.
- `approval_comment_required`: force reviewer justification even when risk is low or medium.

Contro1 does not need to own your policy engine. Your app, rules service, Microsoft AGT, OPA, Cedar, or custom code can decide that review is required; Contro1 handles routing, human decision, signed callback, and audit evidence.

## Customer Agent Plugin Pattern

Build one adapter around the SDK so the customer agent can call a tiny, stable tool surface:

```ts
type ControlMapCache = { value: unknown; ts: number } | null;

export class Contro1Plugin {
  private cache: ControlMapCache = null;
  constructor(private client: CentcomClient) {}

  async previewPolicy(payload: Record<string, unknown>, ttlMs = 5 * 60_000) {
    if (this.cache && Date.now() - this.cache.ts < ttlMs) return this.cache.value;
    const value = await this.client.previewControlMap(payload);
    this.cache = { value, ts: Date.now() };
    return value;
  }

  requestHumanReview(input: { title: string; context: string; case_id: string; action_id: string } & Record<string, unknown>) {
    return this.client.createProtocolRequest({
      title: input.title,
      description: input.context,
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
  - `request(method, path, body?, headers?)`
  - `get(path, query?)`
  - `post(path, body?, headers?)`
  - `delete(path, body?, headers?)`
  - `createRequest(params)`
  - `createProtocolRequest(request)`
  - `logAction(params)`
  - `previewControlMap(params)`
  - `listRequests(params?)`
  - `getRequest(requestId)`
  - `getProtocolResponse(requestId)`
  - `getRequestEvidence(requestId)`
  - `getThread(threadId)`
  - `getTrace(traceId)`
  - `registerAgent(params)`
  - `listAgents(params?)`
  - `getAgent(agentId)`
  - `getAgentTrail(agentId, params?)`
  - `getAgentEvidence(agentId, params?)`
  - `cancelRequest(requestId)`
  - `waitForResponse(requestId, intervalMs?, timeoutMs?)`
  - `waitForProtocolResponse(requestId, intervalMs?, timeoutMs?)`
- `verifyWebhook(rawBody, signature, timestamp, secret)`
- `webhookMiddleware(secret)` for Express

## Quick Verify

```bash
node -e "import('@contro1/sdk').then(() => console.log('sdk installed'))"
```

## Related Packages

- [`centcom`](https://github.com/contro1-hq/centcom) for Python backend integrations
- [`centcom-langgraph`](https://github.com/contro1-hq/centcom-langgraph) for LangGraph workflows
- [`contro1-microsoft-agent-governance-toolkit-integration`](https://github.com/contro1-hq/contro1-microsoft-agent-governance-toolkit-integration) for Microsoft AGT `require_approval` policy decisions
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
  description: 'Payment run 1024 wants to transfer funds to a vendor.',
  request_type: 'approval',
  source: { integration: 'finance-agent' },
  risk_level: 'high',
  policy_trigger: 'Payments above $10,000 require finance approval.',
  policy_context: {
    source: 'custom_rules',
    policy_name: 'finance-transfer-controls',
    rule_id: 'payment-over-10000',
    rule_reason: 'Payments above $10,000 require finance approval.',
    policy_version: 'git:8f42c1a',
    enforcement: 'require_approval',
  },
  approval_comment_required: true,
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
