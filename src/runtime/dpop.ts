/**
 * DPoP (RFC 9449) for Contro1 runtime connections. Node only.
 *
 * The private key stays inside a KeyObject; only the public JWK and signatures
 * leave this module. Proofs are ES256 with raw R||S signatures, matching the
 * server, the Go broker and the shared test vectors.
 */

import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";

export interface PublicJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
}

export interface DpopKey {
  readonly privateKey: KeyObject;
  readonly publicJwk: PublicJwk;
  readonly thumbprint: string;
}

export function generateDpopKey(): DpopKey {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return dpopKeyFromKeyObjects(privateKey, publicKey);
}

export function dpopKeyFromKeyObjects(privateKey: KeyObject, publicKey: KeyObject): DpopKey {
  const exported = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const publicJwk: PublicJwk = { kty: "EC", crv: "P-256", x: exported.x, y: exported.y };
  return { privateKey, publicJwk, thumbprint: jwkThumbprint(publicJwk) };
}

/** RFC 7638 thumbprint: required members, lexicographic order. */
export function jwkThumbprint(jwk: PublicJwk): string {
  const canonical = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}","y":"${jwk.y}"}`;
  return createHash("sha256").update(canonical, "utf8").digest("base64url");
}

export function accessTokenHash(accessToken: string): string {
  return createHash("sha256").update(accessToken, "ascii").digest("base64url");
}

const b64json = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

export interface ProofInput {
  method: string;
  url: string;
  accessToken?: string;
  nonce?: string;
  now?: Date;
  extra?: Record<string, unknown>;
}

export function createDpopProof(key: DpopKey, input: ProofInput): string {
  const url = new URL(input.url);
  url.search = "";
  url.hash = "";
  const payload: Record<string, unknown> = {
    htm: input.method.toUpperCase(),
    htu: url.toString(),
    iat: Math.floor((input.now ?? new Date()).getTime() / 1000),
    jti: randomBytes(18).toString("base64url"),
    ...(input.accessToken ? { ath: accessTokenHash(input.accessToken) } : {}),
    ...(input.nonce ? { nonce: input.nonce } : {}),
    ...(input.extra ?? {}),
  };
  const signingInput = `${b64json({ typ: "dpop+jwt", alg: "ES256", jwk: key.publicJwk })}.${b64json(payload)}`;
  const signature = sign("sha256", Buffer.from(signingInput, "ascii"), { key: key.privateKey, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${signature.toString("base64url")}`;
}
