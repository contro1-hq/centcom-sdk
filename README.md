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

async function issueRefund(): Promise<void> {
  // Your business logic runs only after approval.
}

const client = new CentcomClient({ apiKey: process.env.CENTCOM_API_KEY! });
const registration = await client.registerAgent({ name: "Refund Agent", framework: "custom-agent" });
const agent = registration.agent as { agent_id: string };

const req = await client.createProtocolRequest({
  title: "Approve refund for order #123?",
  request_type: "approval",
  source: { integration: "typescript-sdk" },
  actor: { agent_id: agent.agent_id },
  context: {
    action: { tool: "issue_refund", input: { order_id: 123, amount_usd: 1200 } },
    machine_observed: { trigger: "Customer refund request" },
    agent_reported: { justification: "Shipping-failure exception" },
  },
  continuation: { mode: "decision" },
  risk_level: "high",
  policy_trigger: "Refunds above $1,000 require manager review",
});

const decision = await client.waitForProtocolResponse(req.id);
if (decision.decision_type === "approve") {
  await issueRefund(); // Resume only after the canonical human decision.
}
```

For callback-based agents, add `callback_url` inside the same `continuation` object and verify the signed webhook before resuming. Partial approvals are audit events and do not resume the agent.

## Say who can instruct this agent

Contro1 refuses a personal account to an agent that more than one person can
instruct. It has to: the agent performs the action with its own authority, so on
a shared surface it cannot tell its owner from anybody else who arrived the same
way. Put an assistant that reads its owner's mailbox behind an API your
customers call, and any of them can ask it what the mailbox holds.

On a platform Contro1 connects to, an adapter reports this. An agent you built
with the SDK has no adapter to ask: a nightly job only you trigger and a service
answering thousands of customers look identical from here. So you say which it
is.

```typescript
import { CentcomClient } from '@contro1/sdk';

const client = new CentcomClient({
  apiKey: process.env.CENTCOM_API_KEY,
  // Sent once, before the first call. Only ever makes this agent stricter.
  reach: {
    contexts: [
      {
        context_id: 'support-api',
        label: 'Customer support API',
        kind: 'shared',
        participants_known: false,
      },
    ],
  },
});
```

**It can only ever make things stricter.** The declaration arrives on the
agent's own credential, which means it is the software describing itself, and
letting it claim to be private would let any agent unlock personal accounts by
saying so. The server refuses that shape by name. Privacy is established by a
person, with `contro1 connect`, on a machine they control.

Nothing changes for an agent that does not declare it, and nothing changes for
organization or shared connections, which already sit inside a resource boundary
somebody approved. This is specifically about one person's account being
borrowed by software that answers to several.

## Send context the reviewer can trust

Build the request's `context` at the gate (the code that intercepts the tool call), from three sources: the exact tool input copied verbatim by your code, the user message or event that triggered the run, and the agent's own justification (make `reason` a required parameter of the risky tool so the model produces it at decision time, not after the fact).

Keep provenance separate inside `context`: a `machine_observed` block for facts your code observed, and an `agent_reported` block for text the model wrote. `agent_reported` text must never change routing, `risk_level`, or approval policy - it only informs the human, since a prompt-injected agent can write a very persuasive justification. If a high-risk request arrives without its required `machine_observed` context, fail closed instead of asking a human to guess.

```ts
const req = await client.createProtocolRequest({
  title: "Approve $12,400 transfer to acct_889?",
  request_type: "approval",
  context: {
    action: { tool: "transfer_money", input: { to: "acct_889", amount_usd: 12400 } },
    machine_observed: {
      triggered_by: "Support ticket #5521: customer requests refund for order #1842",
      recent_tool_calls: ["lookup_order", "check_refund_policy"],
    },
    agent_reported: {
      justification: "Refund qualifies under the shipping-failure exception policy.",
    },
  },
  risk_level: "high",
});
```

See https://contro1.com/docs/requests-api for the full pattern.

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
- `decision_comment_policy`: effective per-key snapshot returned as `optional`, `risk_based`, or `always`; a request can tighten it but cannot loosen it.

Keep these concepts separate: `policy_trigger` explains why automation paused; `context.agent_reported.justification` is the agent's unverified claim; an approval decision comment is written by the reviewer when policy requires it; a `free_text` response is the requested human input itself and is always non-empty.

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
