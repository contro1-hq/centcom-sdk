/**
 * The Action Gateway in the TypeScript SDK.
 *
 * WHAT THIS HAS TO PROVE:
 *
 *   The idempotency key travels as a header and is never invented.
 *
 *   Waiting re-reads and never re-submits.
 *
 *   The result comes back, and when it cannot, the reason does - as its own
 *   error, not as a failed Action.
 */

import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { ActionResultUnavailableError, ActionsApi, didExecute } from "../src/actions.js";
import { CentcomClient } from "../src/client.js";

interface Seen { method: string; url: string; headers: IncomingMessage["headers"]; body: string }

async function gateway(states: string[], resultBody: Record<string, unknown>) {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      seen.push({ method: req.method!, url: req.url!, headers: req.headers, body });
      res.setHeader("Content-Type", "application/json");
      if (req.method === "POST" && req.url!.endsWith("/actions/invoke")) {
        res.statusCode = 202;
        res.end(JSON.stringify({ ok: true, reused: false, invocation: { invocation_id: "inv_1", state: "awaiting_approval" } }));
        return;
      }
      if (req.method === "GET" && req.url!.endsWith("/actions/inv_1")) {
        const state = states.length > 1 ? states.shift()! : states[0];
        res.end(JSON.stringify({
          ok: true,
          invocation: { invocation_id: "inv_1", state },
          ...(state === "executed" ? resultBody : {}),
        }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ ok: false }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const actions = new ActionsApi(new CentcomClient({ apiKey: "cc_live_test", baseUrl: `http://127.0.0.1:${port}/api/centcom/v1` }));
  return { actions, seen, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

test("invoke sends the idempotency key as a header and invents none", async () => {
  const { actions, seen, close } = await gateway(["executed"], { result: {} });
  try {
    await actions.invoke({
      action_id: "gmail.message.send", input: { to: "a@example.com" },
      authority_mode: "agent_principal", account_mode: "shared", connection_id: "conn_1",
      idempotency_key: "order-42-reminder",
    });
    assert.equal(seen.at(-1)!.headers["idempotency-key"], "order-42-reminder");
    const body = JSON.parse(seen.at(-1)!.body);
    assert.equal(body.idempotency_key, undefined, "the key is a header, not a body field");

    await actions.invoke({ action_id: "gmail.message.list", input: {}, authority_mode: "agent_principal", account_mode: "personal" });
    assert.equal(seen.at(-1)!.headers["idempotency-key"], undefined, "no key is invented");
  } finally { await close(); }
});

test("waiting re-reads and never re-submits, then the result is returned", async () => {
  const { actions, seen, close } = await gateway(["awaiting_approval", "ready", "executed"], { result: { messages: [{ id: "m1" }] } });
  try {
    const settled = await actions.waitForInvocation("inv_1", { intervalMs: 1 });
    assert.ok(didExecute(settled));
    assert.ok(seen.every((call) => call.method === "GET"), "waiting must never POST");
    assert.deepEqual(await actions.getResult("inv_1"), { messages: [{ id: "m1" }] });
  } finally { await close(); }
});

test("a missing result says why and is not a failure", async () => {
  const { actions, close } = await gateway(["executed"], { result_unavailable: "This action succeeded, but its result has passed its retention period." });
  try {
    await assert.rejects(
      () => actions.getResult("inv_1"),
      (error: unknown) => error instanceof ActionResultUnavailableError && /retention/.test(error.reason),
    );
  } finally { await close(); }
});
