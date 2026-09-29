import { test } from "node:test";
import assert from "node:assert/strict";

import { CentcomClient } from "../src/client.js";
import { ActionsApi } from "../src/actions.js";
import { TraceRun, TraceReportError, newTraceId } from "../src/tracing.js";

/**
 * Traces reported from the runtime, and sub-agents:
 *   - asSubAgent sends Contro1-Sub-Agent on every call from that view, Actions included;
 *   - one run keeps one trace id, and a sub-agent's run links to it;
 *   - failing closed means a tool whose start was not recorded does not run.
 */

type Seen = { path: string; subAgent: string | null; body: Record<string, unknown> };

function fakeServer(options: { down?: boolean } = {}) {
  const seen: Seen[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    seen.push({ path: url.pathname, subAgent: headers.get("contro1-sub-agent"), body: init?.body ? JSON.parse(String(init.body)) : {} });
    if (options.down) return new Response(JSON.stringify({ message: "down" }), { status: 503, headers: { "content-type": "application/json" } });
    const payload = url.pathname.endsWith("/actions/invoke")
      ? { invocation: { invocation_id: "inv_1", state: "executed" } }
      : { id: "rec_1" };
    return new Response(JSON.stringify(payload), { status: 201, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { seen, restore: () => { globalThis.fetch = original; } };
}

const client = () => new CentcomClient({ apiKey: "cc_test_x", baseUrl: "https://example.test/api/centcom/v1" });

test("a sub-agent view sends the header, the parent does not", async () => {
  const server = fakeServer();
  try {
    const parent = client();
    const researcher = parent.asSubAgent("researcher");
    await researcher.logAction({ action: "tool.lookup", summary: "s", source: { integration: "t" } });
    await new ActionsApi(researcher).invoke({ action_id: "gmail.message.list", input: {}, authority_mode: "agent_principal", account_mode: "shared" });
    await parent.logAction({ action: "tool.lookup", summary: "s", source: { integration: "t" } });
    assert.deepEqual(server.seen.map((s) => s.subAgent), ["researcher", "researcher", null]);
    assert.throws(() => parent.asSubAgent(""));
  } finally {
    server.restore();
  }
});

test("one trace per run, and a linked sub-agent run", async () => {
  const server = fakeServer();
  try {
    const run = new TraceRun(client(), { source: "test" });
    await run.report("step.one", "first");
    await run.subAgent("writer").report("step.two", "second");
    assert.equal(server.seen[0]!.body.trace_id, run.traceId);
    assert.equal(server.seen[1]!.body.parent_trace_id, run.traceId);
    assert.notEqual(server.seen[1]!.body.trace_id, run.traceId);
    assert.notEqual(newTraceId(), newTraceId());
  } finally {
    server.restore();
  }
});

test("a wrapped tool reports its start and end", async () => {
  const server = fakeServer();
  try {
    const run = new TraceRun(client());
    const lookup = run.wrap("lookup_order", (args: { order_id: string }) => ({ order: args.order_id }));
    assert.deepEqual(await lookup({ order_id: "1842" }), { order: "1842" });
    const [start, end] = server.seen.map((s) => (s.body.tool_calls as Array<Record<string, unknown>>)[0]!);
    assert.deepEqual(start!.input, { order_id: "1842" });
    assert.equal(end!.outcome, "success");
  } finally {
    server.restore();
  }
});

test("failing closed stops the tool; failing open runs it", async () => {
  const server = fakeServer({ down: true });
  try {
    const ran: number[] = [];
    const strict = new TraceRun(client(), { failClosed: true }).wrap("refund", (amount: number) => { ran.push(amount); });
    await assert.rejects(strict(240), TraceReportError);
    assert.equal(ran.length, 0, "a tool whose start was not recorded must not run");
    const read = (n: number): void => { ran.push(n); };
    await new TraceRun(client(), { failClosed: false }).wrap("read", read)(1);
    assert.deepEqual(ran, [1]);
  } finally {
    server.restore();
  }
});
