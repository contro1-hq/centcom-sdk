/**
 * The SDK's runtime connection support.
 *
 * WHAT THIS HAS TO PROVE:
 *
 *   The SDK's DPoP matches everyone else's: the shared vectors' thumbprint and
 *   ath, and a proof this SDK makes verifies with the vector key.
 *
 *   One refresh at a time, and the rotated refresh token is durable BEFORE any
 *   caller is handed the new access token. A crash between the two is the way
 *   an agent loses its only credential.
 *
 *   A terminal failure (reuse, revoked) is reported with its remediation and
 *   never retried into something else.
 *
 *   One client, one identity: an api key and a connection together are refused.
 *
 *   Through the local service the SDK sends no credential of its own.
 */

import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, createVerify, createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CentcomClient } from "../src/client.js";
import { brokerTransport, socketPathFor } from "../src/runtime/brokerTransport.js";
import { accessTokenHash, createDpopProof, dpopKeyFromKeyObjects, generateDpopKey, jwkThumbprint, type PublicJwk } from "../src/runtime/dpop.js";
import { FileCredentialStore, InMemoryCredentialStore, keyToPem, type StoredCredential } from "../src/runtime/storage.js";
import { RuntimeCredentialError, RuntimeTokenProvider } from "../src/runtime/tokenProvider.js";

// Resolved from the package directory: this test runs with `npm test` in sdk/js.
const VECTOR_PATH = join(process.cwd(), "..", "..", "packages", "protocol", "test-vectors", "runtime", "dpop-vectors.json");
const VECTORS = JSON.parse(readFileSync(VECTOR_PATH, "utf8")) as {
  key: { private_jwk: { d: string; x: string; y: string }; public_jwk: PublicJwk; jkt: string };
  access_token: { value: string; ath: string };
  valid: Array<{ name: string; proof: string }>;
};

function vectorKey() {
  const jwk = VECTORS.key.private_jwk;
  const privateKey = createPrivateKey({ key: { kty: "EC", crv: "P-256", d: jwk.d, x: jwk.x, y: jwk.y }, format: "jwk" });
  return dpopKeyFromKeyObjects(privateKey, createPublicKey(privateKey));
}

test("the SDK agrees with the shared DPoP vectors", () => {
  const key = vectorKey();
  assert.equal(jwkThumbprint(VECTORS.key.public_jwk), VECTORS.key.jkt);
  assert.equal(key.thumbprint, VECTORS.key.jkt);
  assert.equal(accessTokenHash(VECTORS.access_token.value), VECTORS.access_token.ath);

  const proof = createDpopProof(key, { method: "post", url: "https://api.contro1.test/api/centcom/v1/requests?x=1#f", accessToken: VECTORS.access_token.value, nonce: "n" });
  const [header, payload, signature] = proof.split(".");
  const decodedHeader = JSON.parse(Buffer.from(header!, "base64url").toString());
  const decodedPayload = JSON.parse(Buffer.from(payload!, "base64url").toString());
  assert.equal(decodedHeader.typ, "dpop+jwt");
  assert.equal(decodedHeader.alg, "ES256");
  assert.equal(decodedPayload.htm, "POST");
  assert.equal(decodedPayload.htu, "https://api.contro1.test/api/centcom/v1/requests", "query and fragment are dropped");
  assert.equal(decodedPayload.ath, VECTORS.access_token.ath);
  assert.equal(decodedPayload.nonce, "n");
  const raw = Buffer.from(signature!, "base64url");
  assert.equal(raw.length, 64, "ES256 signatures are raw R||S");
  const verifier = createVerify("sha256");
  verifier.update(`${header}.${payload}`);
  assert.ok(verifier.verify({ key: createPublicKey(key.privateKey), dsaEncoding: "ieee-p1363" }, raw));
});

/** A fake token endpoint that really rotates, and really checks the key. */
function fakeAuthorizationServer(options: { onRefresh?: () => void } = {}) {
  const state = { current: "ccrt_1", refreshes: 0, reuse: false, requireNonce: true, nonce: "n1" };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const form = new URLSearchParams(body);
      const proof = req.headers.dpop as string | undefined;
      res.setHeader("dpop-nonce", state.nonce);
      res.setHeader("content-type", "application/json");
      if (!proof) {
        res.writeHead(400).end(JSON.stringify({ error: "invalid_dpop_proof" }));
        return;
      }
      const payload = JSON.parse(Buffer.from(proof.split(".")[1]!, "base64url").toString());
      if (state.requireNonce && payload.nonce !== state.nonce) {
        res.writeHead(400).end(JSON.stringify({ error: "use_dpop_nonce" }));
        return;
      }
      if (state.reuse || form.get("refresh_token") !== state.current) {
        res.writeHead(400).end(JSON.stringify({ error: "invalid_grant", contro1_reason: "refresh_reuse", remediation: { code: "CONNECTION_NOT_ACTIVE", public_message: "This connection was suspended.", next_step: "Connect this computer again." } }));
        return;
      }
      state.refreshes += 1;
      options.onRefresh?.();
      state.current = `ccrt_${state.refreshes + 1}`;
      res.writeHead(200).end(JSON.stringify({ access_token: `at_${form.get("resource")}_${state.refreshes}`, token_type: "DPoP", expires_in: 300, refresh_token: state.current, agent_id: "agt_1", enrollment_id: "enr_1" }));
    });
  });
  return { server, state };
}

async function listening(server: ReturnType<typeof createServer>): Promise<string> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address() as { port: number };
  return `http://127.0.0.1:${address.port}`;
}

function credential(): StoredCredential {
  return { enrollmentId: "enr_1", agentId: "agt_1", refreshToken: "ccrt_1", privateKeyPem: keyToPem(generateDpopKey()) };
}

test("concurrent callers cause one refresh, and both resources are cached", async () => {
  const { server, state } = fakeAuthorizationServer();
  const apiUrl = await listening(server);
  try {
    const provider = new RuntimeTokenProvider({ apiUrl, store: new InMemoryCredentialStore(credential()) });
    const tokens = await Promise.all(Array.from({ length: 50 }, () => provider.accessToken("api")));
    assert.equal(new Set(tokens).size, 1);
    assert.equal(state.refreshes, 1, "50 callers, one refresh");
    assert.equal(await provider.accessToken("api"), tokens[0], "cached");
    const mcp = await provider.accessToken("mcp");
    assert.ok(mcp.startsWith("at_mcp_"));
    assert.equal(state.refreshes, 2, "a different audience needs its own token");
  } finally {
    server.close();
  }
});

test("the rotated refresh token is durable before any caller gets a token", async () => {
  const dir = mkdtempSync(join(tmpdir(), "contro1-sdk-"));
  const { server, state } = fakeAuthorizationServer();
  const apiUrl = await listening(server);
  try {
    const path = join(dir, "credential.json");
    const store = new FileCredentialStore(path);
    await store.save(credential());
    const provider = new RuntimeTokenProvider({ apiUrl, store });
    const token = await provider.accessToken("api");
    const persisted = JSON.parse(readFileSync(path, "utf8")) as StoredCredential;
    assert.equal(persisted.refreshToken, state.current, "the new refresh token is on disk");
    assert.ok(!JSON.stringify(persisted).includes(token), "the access token is not persisted");

    // A second provider (a restart) continues from the persisted token.
    const after = new RuntimeTokenProvider({ apiUrl, store: new FileCredentialStore(path) });
    assert.ok(await after.accessToken("api"));
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a failed save never hands out a token", async () => {
  const { server } = fakeAuthorizationServer();
  const apiUrl = await listening(server);
  try {
    const store = new InMemoryCredentialStore(credential());
    store.save = async () => { throw new Error("disk full"); };
    const provider = new RuntimeTokenProvider({ apiUrl, store });
    await assert.rejects(() => provider.accessToken("api"), /disk full/);
  } finally {
    server.close();
  }
});

test("reuse is terminal and carries its remediation", async () => {
  const { server, state } = fakeAuthorizationServer();
  const apiUrl = await listening(server);
  try {
    state.reuse = true;
    const provider = new RuntimeTokenProvider({ apiUrl, store: new InMemoryCredentialStore(credential()) });
    await assert.rejects(
      () => provider.accessToken("api"),
      (error: unknown) => {
        assert.ok(error instanceof RuntimeCredentialError);
        assert.equal(error.kind, "reuse_suspended");
        assert.equal(error.terminal, true);
        assert.equal(error.remediation?.code, "CONNECTION_NOT_ACTIVE");
        return true;
      },
    );
  } finally {
    server.close();
  }
});

test("one client, one identity", () => {
  const provider = new RuntimeTokenProvider({ apiUrl: "https://api.contro1.test", store: new InMemoryCredentialStore(null) });
  assert.throws(() => new CentcomClient({ apiKey: "cc_live_x", tokenProvider: provider }), /exactly one/);
  assert.throws(() => new CentcomClient({} as never), /apiKey is required/);
  assert.doesNotThrow(() => new CentcomClient({ tokenProvider: provider }));
});

test("a client with a connection sends DPoP, and retries a nonce challenge once", async () => {
  const seen: Array<{ auth?: string; dpop?: string }> = [];
  let served = 0;
  const api = createServer((req, res) => {
    seen.push({ auth: req.headers.authorization as string, dpop: req.headers.dpop as string });
    served += 1;
    res.setHeader("content-type", "application/json");
    if (served === 1) {
      res.setHeader("www-authenticate", 'DPoP error="use_dpop_nonce"');
      res.setHeader("dpop-nonce", "fresh");
      res.writeHead(401).end(JSON.stringify({ ok: false }));
      return;
    }
    res.writeHead(200).end(JSON.stringify({ id: "req_1", state: "queued" }));
  });
  const { server: asServer } = fakeAuthorizationServer();
  const asUrl = await listening(asServer);
  const apiUrl = await listening(api);
  try {
    const provider = new RuntimeTokenProvider({ apiUrl: asUrl, store: new InMemoryCredentialStore(credential()) });
    const client = new CentcomClient({ tokenProvider: provider, baseUrl: `${apiUrl}/api/centcom/v1` });
    const created = await client.post<{ id: string }>("/requests", { type: "approval", question: "q", context: "c" });
    assert.equal(created.id, "req_1");
    assert.equal(seen.length, 2, "the nonce challenge is retried once");
    for (const call of seen) {
      assert.ok(call.auth?.startsWith("DPoP at_api_"));
      assert.equal(call.dpop?.split(".").length, 3);
    }
    const second = JSON.parse(Buffer.from(seen[1]!.dpop!.split(".")[1]!, "base64url").toString());
    assert.equal(second.nonce, "fresh", "the retry carries the server's nonce");
    assert.equal(second.ath, createHash("sha256").update(seen[1]!.auth!.slice("DPoP ".length), "ascii").digest("base64url"));
  } finally {
    api.close();
    asServer.close();
  }
});

test("through the local Contro1 service the SDK sends no credential", async () => {
  const pipe = process.platform === "win32" ? `\\\\.\\pipe\\contro1-sdk-test-${process.pid}` : join(mkdtempSync(join(tmpdir(), "contro1-sock-")), "s.sock");
  const endpoint = process.platform === "win32" ? `npipe:////./pipe/contro1-sdk-test-${process.pid}` : `unix://${pipe}`;
  const seen: Array<Record<string, unknown>> = [];
  const server = createServer((req, res) => {
    seen.push({ path: req.url, auth: req.headers.authorization, cookie: req.headers.cookie, dpop: req.headers.dpop });
    res.setHeader("content-type", "application/json");
    res.writeHead(200).end(JSON.stringify({ ok: true, auth: { agent_id: "agt_1" } }));
  });
  await new Promise<void>((r) => server.listen(pipe, r));
  try {
    assert.equal(socketPathFor(endpoint), pipe);
    const client = new CentcomClient({ transport: brokerTransport(endpoint), baseUrl: "http://contro1-broker/api/centcom/v1" });
    const status = await client.get<{ auth: { agent_id: string } }>("/runtime/status");
    assert.equal(status.auth.agent_id, "agt_1");
    assert.equal(seen[0]!.path, "/api/centcom/v1/runtime/status");
    assert.equal(seen[0]!.auth, undefined);
    assert.equal(seen[0]!.dpop, undefined);
  } finally {
    server.close();
  }
});
