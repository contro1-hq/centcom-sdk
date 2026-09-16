/**
 * Enrolling an SDK-hosted agent with a connection ticket from
 * `contro1 connect` (platform "sdk"): register a key, wait for the owner,
 * store the credential. Also workload federation (RFC 8693) for cloud
 * workloads whose platform issues OIDC tokens.
 */

import { createDpopProof, generateDpopKey, type DpopKey } from "./dpop.js";
import { keyToPem, type CredentialStore } from "./storage.js";
import { RUNTIME_PATHS, RuntimeCredentialError, RuntimeTokenProvider } from "./tokenProvider.js";

export interface DeviceAuthorization {
  device_code: string;
  user_code: string | null;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
  batch_id: string;
  enrollment_id: string;
  item_id: string;
}

export async function registerKeyWithTicket(options: {
  apiUrl: string;
  connectionTicket: string;
  itemId: string;
  key?: DpopKey;
  fetch?: typeof fetch;
}): Promise<{ key: DpopKey; authorization: DeviceAuthorization }> {
  const key = options.key ?? generateDpopKey();
  const url = `${options.apiUrl.replace(/\/+$/u, "")}${RUNTIME_PATHS.deviceAuthorization}`;
  const response = await (options.fetch ?? fetch)(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", dpop: createDpopProof(key, { method: "POST", url }) },
    body: new URLSearchParams({ connection_ticket: options.connectionTicket, item_id: options.itemId, client_id: "contro1-runtime" }).toString(),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (!response.ok) {
    throw new RuntimeCredentialError(String(body.error_description ?? body.error ?? "device authorization failed"), "server");
  }
  return { key, authorization: body as DeviceAuthorization };
}

/**
 * Poll until the owner decides. Resolves once the credential is stored.
 * The device code never leaves this function and is never logged.
 */
export async function waitForApproval(options: {
  apiUrl: string;
  key: DpopKey;
  authorization: DeviceAuthorization;
  store: CredentialStore;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ agentId: string; enrollmentId: string }> {
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  // A throwaway store just to reuse the provider's DPoP token request.
  const probe = new RuntimeTokenProvider({
    apiUrl: options.apiUrl,
    fetch: options.fetch,
    store: { load: async () => ({ enrollmentId: "", agentId: "", refreshToken: "", privateKeyPem: keyToPem(options.key) }), save: async () => undefined },
  });
  let interval = Math.max(1, options.authorization.interval || 5);
  const deadline = Date.now() + options.authorization.expires_in * 1000 + 30_000;
  while (Date.now() < deadline) {
    if (options.signal?.aborted) throw new RuntimeCredentialError("Stopped waiting for approval.", "pending");
    try {
      const tokens = await probe.tokenRequest({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: options.authorization.device_code, client_id: "contro1-runtime", resource: "api" });
      await options.store.save({
        enrollmentId: tokens.enrollment_id ?? options.authorization.enrollment_id,
        agentId: tokens.agent_id ?? "",
        refreshToken: tokens.refresh_token!,
        privateKeyPem: keyToPem(options.key),
        approvalExpiresAt: tokens.approval_expires_at,
      });
      return { agentId: tokens.agent_id ?? "", enrollmentId: tokens.enrollment_id ?? options.authorization.enrollment_id };
    } catch (error) {
      if (error instanceof RuntimeCredentialError && (error.kind === "pending" || error.kind === "slow_down")) {
        interval = error.interval ?? (error.kind === "slow_down" ? interval + 5 : interval);
        await sleep(interval * 1000);
        continue;
      }
      throw error;
    }
  }
  throw new RuntimeCredentialError("The approval request expired.", "expired");
}

/**
 * RFC 8693 token exchange for a cloud workload. The platform's own OIDC token
 * is the subject; a trust policy the accountable owner approved decides which
 * Agent it becomes. No refresh token is issued: exchange again when needed.
 */
export async function exchangeWorkloadToken(options: {
  apiUrl: string;
  subjectToken: string;
  key: DpopKey;
  resource?: "api" | "mcp";
  fetch?: typeof fetch;
}): Promise<{ access_token: string; expires_in: number; agent_id: string; enrollment_id: string }> {
  const provider = new RuntimeTokenProvider({
    apiUrl: options.apiUrl,
    fetch: options.fetch,
    store: { load: async () => ({ enrollmentId: "", agentId: "", refreshToken: "", privateKeyPem: keyToPem(options.key) }), save: async () => undefined },
  });
  const tokens = await provider.tokenRequest({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: options.subjectToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    client_id: "contro1-runtime",
    resource: options.resource ?? "api",
  });
  return tokens as any;
}
