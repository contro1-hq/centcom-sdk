import crypto from "node:crypto";
import type { WebhookPayload } from "./types.js";

const MAX_TIMESTAMP_AGE_SECONDS = 300;

export function verifyWebhook(
  rawBody: string | Buffer,
  signature: string,
  timestamp: string,
  secret: string,
): boolean {
  const ts = Number.parseInt(timestamp, 10);
  if (Number.isNaN(ts)) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (age > MAX_TIMESTAMP_AGE_SECONDS) return false;

  const payload = `${timestamp}.${typeof rawBody === "string" ? rawBody : rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export function webhookMiddleware(secret: string) {
  return (req: any, res: any, next: any) => {
    const signature = req.headers["x-centcom-signature"] as string;
    const timestamp = req.headers["x-centcom-timestamp"] as string;
    const requestId = req.headers["x-centcom-request-id"] as string;

    if (!signature || !timestamp) {
      res.status(401).json({ error: "Missing webhook signature headers" });
      return;
    }

    const rawBody = (req as any).rawBody || JSON.stringify(req.body);
    if (!verifyWebhook(rawBody, signature, timestamp, secret)) {
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }

    req.centcomPayload = req.body as WebhookPayload;
    req.centcomRequestId = requestId;
    next();
  };
}
