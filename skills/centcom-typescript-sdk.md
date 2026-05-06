# Contro1 TypeScript SDK Skill

Use `createProtocolRequest` when the agent must wait for an operator. Use `logAction` when the agent already acted within policy and Contro1 should keep an audit record.

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
- Audit records and cases docs: https://contro1.com/docs/audit-records-and-cases
- Requests API docs: https://contro1.com/docs/requests-api
