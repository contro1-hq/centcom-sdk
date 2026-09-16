import type {
  AgentEvidenceOptions,
  AgentListParams,
  AgentRegisterParams,
  AuditRecord,
  AuditRecordCreateParams,
  CentcomConfig,
  CentcomRequest,
  CreateRequestParams,
  ListAuditRecordsParams,
  ListRequestsParams,
  QueryParams,
} from "./types.js";
import {
  fromLegacyRequest,
  toLegacyCreateRequestParams,
  validateContro1Request,
  type Contro1Request,
  type Contro1Response,
} from "./protocol.js";

const DEFAULT_BASE_URL = "https://api.contro1.com/api/centcom/v1";
const DEFAULT_TIMEOUT = 30_000;

function randomHex(bytes: number): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    const values = new Uint8Array(bytes);
    cryptoApi.getRandomValues(values);
    return Array.from(values).map((value) => value.toString(16).padStart(2, "0")).join("");
  }
  return Array.from({ length: bytes }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, "0")).join("");
}

function withQuery(path: string, query?: QueryParams): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      params.set(key, value.join(","));
    } else {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `${path}${path.includes("?") ? "&" : "?"}${qs}` : path;
}

export class CentcomClient {
  private apiKey?: string;
  private baseUrl: string;
  private timeout: number;
  private tokenProvider?: CentcomConfig["tokenProvider"];
  private transport?: CentcomConfig["transport"];

  constructor(config: CentcomConfig) {
    const configured = [config.apiKey, config.tokenProvider, config.transport].filter(Boolean).length;
    if (configured === 0) throw new Error("apiKey is required (or tokenProvider, or transport)");
    if (configured > 1) throw new Error("configure exactly one of apiKey, tokenProvider or transport: one client, one identity");
    this.apiKey = config.apiKey;
    this.tokenProvider = config.tokenProvider;
    this.transport = config.transport;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeout = config.timeout || DEFAULT_TIMEOUT;
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    if (this.transport) return this.requestViaTransport<T>(method, path, body, headers);
    if (this.tokenProvider) return this.requestWithDpop<T>(method, path, body, headers);
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const contentType = res.headers.get("content-type") || "";
      const data = contentType.includes("application/json")
        ? await res.json()
        : await res.text();

      if (!res.ok) {
        const message = data && typeof data === "object" && "message" in data
          ? String((data as Record<string, unknown>).message)
          : `HTTP ${res.status}`;
        const err = new Error(message);
        (err as Error & { status?: number; response?: unknown }).status = res.status;
        (err as Error & { status?: number; response?: unknown }).response = data;
        throw err;
      }

      return data as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private static fail(status: number, data: unknown): never {
    const record = data && typeof data === "object" ? (data as Record<string, any>) : undefined;
    const message = record?.message ?? record?.error?.message ?? `HTTP ${status}`;
    const err = new Error(String(message));
    (err as Error & { status?: number; response?: unknown; remediation?: unknown }).status = status;
    (err as Error & { status?: number; response?: unknown; remediation?: unknown }).response = data;
    (err as Error & { status?: number; response?: unknown; remediation?: unknown }).remediation = record?.error?.remediation ?? record?.remediation;
    throw err;
  }

  private async requestViaTransport<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    const res = await this.transport!(method, `${url.pathname}${url.search}`, { "content-type": "application/json", accept: "application/json", ...headers }, body ? JSON.stringify(body) : undefined);
    const data = res.body ? (() => { try { return JSON.parse(res.body); } catch { return res.body; } })() : null;
    if (res.status < 200 || res.status >= 300) CentcomClient.fail(res.status, data);
    return data as T;
  }

  private async requestWithDpop<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);
      try {
        const auth = await this.tokenProvider!.authorize(method, url, "api");
        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json", ...headers, ...auth },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
        this.tokenProvider!.observeNonce(res.headers);
        const contentType = res.headers.get("content-type") || "";
        const data = contentType.includes("application/json") ? await res.json() : await res.text();
        if (res.status === 401 && attempt < 2) {
          const challenge = res.headers.get("www-authenticate") || "";
          if (challenge.includes("use_dpop_nonce")) continue;
          const hasRemediation = Boolean((data as any)?.error?.remediation);
          if (challenge.includes("invalid_token") && attempt === 0 && !hasRemediation) {
            this.tokenProvider!.invalidate("api");
            continue;
          }
        }
        if (!res.ok) CentcomClient.fail(res.status, data);
        return data as T;
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error("Contro1 kept refusing the runtime credential");
  }

  async get<T>(path: string, query?: QueryParams): Promise<T> {
    return this.request<T>("GET", withQuery(path, query));
  }

  async post<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request<T>("POST", path, body, headers);
  }

  async delete<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request<T>("DELETE", path, body, headers);
  }

  async createRequest(params: CreateRequestParams): Promise<CentcomRequest> {
    const headers: Record<string, string> = {};
    if (params.idempotency_key) {
      headers["Idempotency-Key"] = params.idempotency_key;
    }

    const { idempotency_key, ...body } = params;
    return this.post<CentcomRequest>("/requests", body, headers);
  }

  newThreadId(): string {
    return `thr_${randomHex(16)}`;
  }

  async createProtocolRequest(request: Contro1Request): Promise<CentcomRequest> {
    const validation = validateContro1Request(request);
    if (!validation.valid) {
      throw new Error(`Invalid Contro1Request: ${validation.errors.join("; ")}`);
    }
    return this.createRequest(toLegacyCreateRequestParams(request));
  }

  async listRequests(params?: ListRequestsParams): Promise<{ requests: CentcomRequest[] }> {
    return this.get<{ requests: CentcomRequest[] }>("/requests", params);
  }

  async getRequest(requestId: string): Promise<CentcomRequest> {
    return this.get<CentcomRequest>(`/requests/${requestId}`);
  }

  async getProtocolResponse(requestId: string): Promise<Contro1Response> {
    const req = await this.getRequest(requestId);
    return fromLegacyRequest(req);
  }

  async getRequestEvidence(requestId: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(`/requests/${requestId}/evidence`);
  }

  async cancelRequest(requestId: string): Promise<{ message: string }> {
    return this.delete<{ message: string }>(`/requests/${requestId}`);
  }

  async previewControlMap(params: CreateRequestParams | Contro1Request): Promise<Record<string, unknown>> {
    const looksProtocol = "request_type" in params || "source" in params || "continuation" in params;
    const body = looksProtocol ? toLegacyCreateRequestParams(params as Contro1Request) : params;
    const { idempotency_key, ...payload } = body as CreateRequestParams;
    return this.post<Record<string, unknown>>("/requests/control-map", payload);
  }

  async logAction(params: AuditRecordCreateParams): Promise<AuditRecord> {
    return this.post<AuditRecord>("/audit-records", params);
  }

  async listAuditRecords(params?: ListAuditRecordsParams): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>("/audit-records", params);
  }

  async getAuditRecord(recordId: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(`/audit-records/${recordId}`);
  }

  async getThread(threadId: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(`/threads/${threadId}`);
  }

  async getTrace(traceId: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(`/traces/${traceId}`);
  }

  async registerAgent(params: AgentRegisterParams): Promise<Record<string, unknown>> {
    return this.post<Record<string, unknown>>("/agents/register", params);
  }

  async listAgents(params?: AgentListParams): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>("/agents", params);
  }

  async getAgent(agentId: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(`/agents/${agentId}`);
  }

  async getAgentTrail(agentId: string, params?: { trace_id?: string; limit?: number }): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(`/agents/${agentId}/trail`, params);
  }

  async getAgentEvidence(agentId: string, params?: AgentEvidenceOptions): Promise<Record<string, unknown> | string> {
    return this.get<Record<string, unknown> | string>(`/agents/${agentId}/evidence`, params);
  }

  async waitForResponse(
    requestId: string,
    intervalMs = 3000,
    timeoutMs = 600_000,
  ): Promise<CentcomRequest> {
    const deadline = Date.now() + timeoutMs;
    const terminalStates = new Set([
      "answered",
      "callback_pending",
      "callback_delivered",
      "callback_failed",
      "closed",
      "expired",
      "cancelled",
    ]);

    while (Date.now() < deadline) {
      const req = await this.getRequest(requestId);
      if (terminalStates.has(req.state)) {
        return req;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Timeout waiting for response on request ${requestId}`);
  }

  async waitForProtocolResponse(
    requestId: string,
    intervalMs = 3000,
    timeoutMs = 600_000,
  ): Promise<Contro1Response> {
    const req = await this.waitForResponse(requestId, intervalMs, timeoutMs);
    return fromLegacyRequest(req);
  }
}
