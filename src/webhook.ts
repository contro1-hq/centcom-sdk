import crypto from 'crypto';
import type { WebhookPayload } from './types.js';

const MAX_TIMESTAMP_AGE_SECONDS = 300; // 5 minutes

/**
 * Verify an incoming CENTCOM webhook signature.
 *
 * @param rawBody - The raw request body as a string or Buffer
 * @param signature - The X-CentCom-Signature header value
 * @param timestamp - The X-CentCom-Timestamp header value
 * @param secret - Your organization's webhook signing secret (whsec_xxx)
 * @returns true if the signature is valid and the timestamp is fresh
 */
export function verifyWebhook(
  rawBody: string | Buffer,
  signature: string,
  timestamp: string,
  secret: string,
): boolean {
  // Check timestamp freshness (prevent replay attacks)
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (age > MAX_TIMESTAMP_AGE_SECONDS) return false;

  // Compute expected signature
  const payload = `${timestamp}.${typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  // Constant-time comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  } catch {
    return false;
  }
}

/**
 * Express middleware that verifies CENTCOM webhook signatures.
 * Attaches the parsed payload to req.centcomPayload if valid.
 *
 * Usage:
 *   app.post('/webhook', webhookMiddleware('whsec_xxx'), (req, res) => {
 *     const payload = (req as any).centcomPayload as WebhookPayload;
 *     // handle the payload...
 *     res.sendStatus(200);
 *   });
 *
 * Important: This middleware requires the raw body. Configure Express with:
 *   app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
 */
export function webhookMiddleware(secret: string) {
  return (req: any, res: any, next: any) => {
    const signature = req.headers['x-centcom-signature'] as string;
    const timestamp = req.headers['x-centcom-timestamp'] as string;
    const requestId = req.headers['x-centcom-request-id'] as string;

    if (!signature || !timestamp) {
      res.status(401).json({ error: 'Missing webhook signature headers' });
      return;
    }

    // Get raw body - either from rawBody middleware or stringified body
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);

    if (!verifyWebhook(rawBody, signature, timestamp, secret)) {
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }

    req.centcomPayload = req.body as WebhookPayload;
    req.centcomRequestId = requestId;
    next();
  };
}
