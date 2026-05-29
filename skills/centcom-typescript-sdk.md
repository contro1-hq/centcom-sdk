# Contro1 TypeScript SDK Skill

Use `createProtocolRequest` when the agent must wait for an operator. Use `logAction` when the agent already acted within policy and Contro1 should keep an audit record.

## Policy evidence fields

When the caller already knows why review is required, include the evidence directly in the request. This is not Microsoft-specific; use it with any policy engine, rules service, risk classifier, or application rule.

```ts
await client.createProtocolRequest({
  title: 'Approve vendor transfer?',
  request_type: 'approval',
  source: { integration: 'finance-agent', workflow_id: 'vendor-payment' },
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
});
```

## Case continuity rules

- Generate a case id or use a stable existing business case id.
- Put the same `correlation_id` on related requests and audit records.
- Use `in_reply_to` for follow-up logs after an operator answer.
- Keep `external_request_id` per action/request for idempotency.

```ts
const caseId = `case_${Date.now()}`;
const req = await client.createProtocolRequest({ ...payload, correlation_id: caseId });
await client.logAction({
  action: 'agent.follow_up_completed',
  summary: 'Completed the operator-approved follow-up',
  source: { integration: 'my-agent' },
  correlation_id: caseId,
  in_reply_to: { type: 'request', id: req.id },
});
```

## Full reference links

- TypeScript SDK repo: https://github.com/contro1-hq/centcom-sdk
- Skill file source: https://github.com/contro1-hq/centcom-sdk/blob/main/skills/centcom-typescript-sdk.md
- EU oversight skill: https://github.com/contro1-hq/centcom-sdk/blob/main/skills/contro1-eu-oversight.md
- US AI governance skill: https://github.com/contro1-hq/centcom-sdk/blob/main/skills/contro1-us-ai-governance.md
- Python SDK repo: https://github.com/contro1-hq/centcom
- Microsoft AGT companion skill: https://github.com/contro1-hq/contro1-microsoft-agent-governance-toolkit-integration/blob/main/skills/contro1-microsoft-agent-governance-toolkit-integration.md
- Audit records and cases docs: https://contro1.com/docs/audit-records-and-cases
- Requests API docs: https://contro1.com/docs/requests-api
