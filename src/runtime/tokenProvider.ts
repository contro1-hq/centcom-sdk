/**
 * RuntimeTokenProvider: DPoP access tokens for one owner-approved connection.
 *
 *  - One refresh at a time. Concurrent callers wait for the same refresh.
 *  - The rotated refresh token is saved BEFORE any waiter gets the new access
 *    token, so a crash never loses the only valid refresh token.
 *  - Access tokens are cached per resource ("api" or "mcp") with a 60 second margin.
 *  - A server nonce challenge is retried once.
 *  - Terminal failures (revoked, reuse, expired approval) surface as
 *    RuntimeCredentialError with the server's remediation, and are never
 *    retried or replaced by any other credential.
 */

import { createDpopProof, type DpopKey } from "./dpop.js";
import { keyFromCredential, type CredentialStore, type ExternalLock, type StoredCredential } from "./storage.js";

export type RuntimeResource = "api" | "mcp";

export interface Remediation {
  code: string;
  public_message: string;
  missing?: string;
  who?: { display_name: string; role: string } | null;
  next_step: string;
  action_url?: string;
  retryable?: boolean;
}

export class RuntimeCredentialError extends Error {
  constructor(
    message: string,
    readonly kind: "revoked" | "reuse_suspended" | "approval_expired" | "not_connected" | "server" | "network" | "pending" | "slow_down" | "declined" | "expired",
    readonly remediation?: Remediation,
    readonly interval?: number,
  ) {
    super(message);
  }
  get terminal(): boolean {
    return ["revoked", "reuse_suspended", "approval_expired", "not_connected", "declined", "expired"].includes(this.kind);
  }
}

export const RUNTIME_PATHS = {
  deviceAuthorization: "/api/centcom/v1/runtime/oauth/device_authorization",
  token: "/api/centcom/v1/runtime/oauth/token",
  revoke: "/api/centcom/v1/runtime/oauth/revoke",
} as const;

export interface TokenProviderOptions {
  /** Origin of the Contro1 API, e.g. https://api.contro1.com */
  apiUrl: string;
  store: CredentialStore;
  lock?: ExternalLock;
  fetch?: typeof fetch;
  now?: () => Date;
}

type Cached = { token: string; expiresAt: number };

export class RuntimeTokenProvider {
  private readonly apiUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly cache = new Map<RuntimeResource, Cached>();
  private inflight?: Promise<unknown>;
  private nonce?: string;
  private key?: DpopKey;
  refreshCount = 0;

  constructor(private readonly options: TokenProviderOptions) {
    this.apiUrl = options.apiUrl.replace(/\/+$/u, "");
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async dpopKey(): Promise<DpopKey> {
    if (this.key) return this.key;
    const credential = await this.options.store.load();
    if (!credential) throw new RuntimeCredentialError("This connection has no stored credential.", "not_connected");
    this.key = keyFromCredential(credential);
    return this.key;
  }

  observeNonce(headers: Headers): void {
    const nonce = headers.get("dpop-nonce");
    if (nonce) this.nonce = nonce;
  }

  invalidate(resource?: RuntimeResource): void {
    if (resource) this.cache.delete(resource);
    else this.cache.clear();
  }

  async accessToken(resource: RuntimeResource = "api"): Promise<string> {
    for (;;) {
      const cached = this.cache.get(resource);
      if (cached && cached.expiresAt - 60_000 > this.now().getTime()) return cached.token;
      if (this.inflight) {
        await this.inflight.catch(() => undefined);
        continue;
      }
      const run = this.refresh(resource);
      this.inflight = run;
      try {
        return await run;
      } finally {
        this.inflight = undefined;
      }
    }
  }

  private async refresh(resource: RuntimeResource): Promise<string> {
    const doRefresh = async () => {
      const credential = await this.options.store.load();
      if (!credential) throw new RuntimeCredentialError("This connection has no stored credential.", "not_connected");
      this.key ??= keyFromCredential(credential);
      this.refreshCount += 1;
      const body = await this.tokenRequest({ grant_type: "refresh_token", refresh_token: credential.refreshToken, client_id: "contro1-runtime", resource });
      const next: StoredCredential = { ...credential, refreshToken: body.refresh_token ?? credential.refreshToken };
      // Durable before anyone sees the new access token.
      await this.options.store.save(next);
      this.cache.set(resource, { token: body.access_token, expiresAt: this.now().getTime() + body.expires_in * 1000 });
      return body.access_token as string;
    };
    return this.options.lock ? this.options.lock.withLock(doRefresh) : doRefresh();
  }

  /** Token endpoint with DPoP and one nonce retry. */
  async tokenRequest(form: Record<string, string>): Promise<{ access_token: string; expires_in: number; refresh_token?: string; agent_id?: string; enrollment_id?: string; approval_expires_at?: string }> {
    const key = await this.dpopKey();
    const url = `${this.apiUrl}${RUNTIME_PATHS.token}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", dpop: createDpopProof(key, { method: "POST", url, nonce: this.nonce }) },
          body: new URLSearchParams(form).toString(),
        });
      } catch (error) {
        throw new RuntimeCredentialError(`Contro1 is not reachable: ${(error as Error).message}`, "network");
      }
      this.observeNonce(response.headers);
      const payload = (await response.json().catch(() => ({}))) as Record<string, any>;
      if (response.ok) return payload as any;
      if (payload.error === "use_dpop_nonce" && attempt === 0) continue;
      throw classify(payload);
    }
    throw new RuntimeCredentialError("The token endpoint kept asking for a nonce.", "server");
  }

  /** Headers for one resource request. */
  async authorize(method: string, url: string, resource: RuntimeResource = "api"): Promise<Record<string, string>> {
    const token = await this.accessToken(resource);
    const key = await this.dpopKey();
    return { authorization: `DPoP ${token}`, dpop: createDpopProof(key, { method, url, accessToken: token, nonce: this.nonce }) };
  }
}

function classify(payload: Record<string, any>): RuntimeCredentialError {
  const remediation = payload.remediation as Remediation | undefined;
  const reason = String(payload.contro1_reason ?? "");
  const message = String(payload.error_description ?? payload.error ?? "token request failed");
  switch (true) {
    case payload.error === "authorization_pending":
      return new RuntimeCredentialError(message, "pending", remediation, payload.interval);
    case payload.error === "slow_down":
      return new RuntimeCredentialError(message, "slow_down", remediation, payload.interval);
    case payload.error === "access_denied":
      return new RuntimeCredentialError(message, "declined", remediation);
    case payload.error === "expired_token":
      return new RuntimeCredentialError(message, "expired", remediation);
    case reason === "refresh_reuse" || reason === "refresh_key_mismatch":
      return new RuntimeCredentialError(message, "reuse_suspended", remediation);
    case reason === "approval_expired" || reason === "refresh_expired":
      return new RuntimeCredentialError(message, "approval_expired", remediation);
    case payload.error === "invalid_grant":
      return new RuntimeCredentialError(message, "revoked", remediation);
    default:
      return new RuntimeCredentialError(message, "server", remediation);
  }
}
