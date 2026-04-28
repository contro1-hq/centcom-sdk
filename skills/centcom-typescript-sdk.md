# Contro1 TypeScript SDK Skill

Use `createProtocolRequest` when the agent must wait for an operator. Use `logAction` when the agent already acted within policy and Contro1 should keep an audit record.

## Thread rules

- Generate a thread with `client.newThreadId()` or pass a stable existing `thr_*` id.
- Put the same `thread_id` on related requests and audit records.
- Use `in_reply_to` for follow-up logs after an operator answer.
- Keep `external_request_id` per action/request for idempotency.

```ts
const threadId = client.newThreadId();
const req = await client.createProtocolRequest({ ...payload, thread_id: threadId });
await client.logAction({
  action: 'agent.follow_up_completed',
  summary: 'Completed the operator-approved follow-up',
  source: { integration: 'my-agent' },
  thread_id: threadId,
  in_reply_to: { type: 'request', id: req.id },
});
```

## Full reference links

- TypeScript SDK repo: https://github.com/contro1-hq/centcom-sdk
- Skill file source: https://github.com/contro1-hq/centcom-sdk/blob/main/skills/centcom-typescript-sdk.md
- Python SDK repo: https://github.com/contro1-hq/centcom
- Audit records and threads docs: https://contro1.com/docs/audit-records-and-threads
- Requests API docs: https://contro1.com/docs/requests-api
