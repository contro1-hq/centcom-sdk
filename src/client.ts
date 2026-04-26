import type { CentcomConfig, CreateRequestParams, CentcomRequest } from "./types.js";

const DEFAULT_BASE_URL = "https://api.contro1.com/api/centcom/v1";
const DEFAULT_TIMEOUT = 30_000;

export class CentcomClient {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;

  constructor(config: CentcomConfig) {
    if (!config.apiKey) throw new Error("apiKey is required");
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeout = config.timeout || DEFAULT_TIMEOUT;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
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

      const data = (await res.json()) as Record<string, unknown>;

      if (!res.ok) {
        const err = new Error((data.message as string) || `HTTP ${res.status}`);
        (err as Error & { status?: number }).status = res.status;
        throw err;
      }

      return data as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async createRequest(params: CreateRequestParams): Promise<CentcomRequest> {
    const headers: Record<string, string> = {};
    if (params.idempotency_key) {
      headers["Idempotency-Key"] = params.idempotency_key;
    }

    const { idempotency_key, ...body } = params;
    return this.request<CentcomRequest>("POST", "/requests", body, headers);
  }

  async getRequest(requestId: string): Promise<CentcomRequest> {
    return this.request<CentcomRequest>("GET", `/requests/${requestId}`);
  }

  async cancelRequest(requestId: string): Promise<{ message: string }> {
    return this.request<{ message: string }>("DELETE", `/requests/${requestId}`);
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
}
