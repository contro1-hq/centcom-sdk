/**
 * Talk to Contro1 through this computer's Contro1 service instead of holding a
 * credential. The endpoint is a unix socket or a Windows named pipe; the
 * service adds the agent's credential, and this process cannot choose an
 * identity.
 */

import { request as httpRequest } from "node:http";

export interface TransportResponse {
  status: number;
  headers: Headers;
  body: string;
}

export type Transport = (method: string, path: string, headers: Record<string, string>, body?: string) => Promise<TransportResponse>;

/** `npipe:////./pipe/name` or `unix:///path.sock` to a socketPath node understands. */
export function socketPathFor(endpoint: string): string {
  if (endpoint.startsWith("npipe:")) {
    const rest = endpoint.slice("npipe:".length).replace(/^\/+/u, "");
    if (!rest.startsWith("./pipe/")) throw new Error("npipe endpoints must be npipe:////./pipe/<name>");
    return `\\\\.\\pipe\\${rest.slice("./pipe/".length)}`;
  }
  if (endpoint.startsWith("unix://")) {
    const path = endpoint.slice("unix://".length);
    if (!path.startsWith("/")) throw new Error("unix endpoints must be absolute");
    return path;
  }
  throw new Error("endpoint must be npipe:////./pipe/<name> or unix:///<path>");
}

const FORBIDDEN_HEADERS = new Set(["authorization", "cookie", "dpop", "host"]);

export function brokerTransport(endpoint: string, options: { timeoutMs?: number } = {}): Transport {
  const socketPath = socketPathFor(endpoint);
  return (method, path, headers, body) =>
    new Promise((resolve, reject) => {
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(headers)) {
        if (!FORBIDDEN_HEADERS.has(k.toLowerCase())) clean[k] = v;
      }
      const req = httpRequest(
        { socketPath, method, path, headers: { ...clean, host: "contro1-broker", ...(body ? { "content-length": Buffer.byteLength(body).toString() } : {}) }, agent: false },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const h = new Headers();
            for (const [k, v] of Object.entries(res.headers)) {
              if (typeof v === "string") h.set(k, v);
              else if (Array.isArray(v)) h.set(k, v.join(", "));
            }
            resolve({ status: res.statusCode ?? 0, headers: h, body: Buffer.concat(chunks).toString("utf8") });
          });
        },
      );
      req.setTimeout(options.timeoutMs ?? 90_000, () => req.destroy(new Error("Contro1 service request timed out")));
      req.on("error", (error) => reject(new Error(`The Contro1 service on this computer is not reachable (${error.message}); run contro1 doctor`)));
      if (body) req.write(body);
      req.end();
    });
}
