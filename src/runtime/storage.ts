/**
 * Where a RuntimeTokenProvider keeps its refresh token. The refresh token
 * rotates on every use, so a store must be durable before it returns, and two
 * processes must never refresh the same family concurrently (the second would
 * present a spent token and suspend the connection). Use a FileStore with an
 * ExternalLock, or one process per connection.
 */

import { createPrivateKey, createPublicKey } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { dpopKeyFromKeyObjects, type DpopKey } from "./dpop.js";

export interface StoredCredential {
  enrollmentId: string;
  agentId: string;
  refreshToken: string;
  /** PKCS#8 PEM. Protect the file: it is the connection's key. */
  privateKeyPem: string;
  approvalExpiresAt?: string;
}

export interface CredentialStore {
  load(): Promise<StoredCredential | null>;
  /** Must be durable when it resolves. */
  save(credential: StoredCredential): Promise<void>;
}

/** Serializes refreshes across processes (a lock file, a database row, ...). */
export interface ExternalLock {
  withLock<T>(fn: () => Promise<T>): Promise<T>;
}

export class InMemoryCredentialStore implements CredentialStore {
  private value: StoredCredential | null;
  constructor(initial: StoredCredential | null = null) {
    this.value = initial;
  }
  async load() {
    return this.value ? { ...this.value } : null;
  }
  async save(credential: StoredCredential) {
    this.value = { ...credential };
  }
}

export class FileCredentialStore implements CredentialStore {
  constructor(readonly path: string, readonly lock?: ExternalLock) {}

  async load(): Promise<StoredCredential | null> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as StoredCredential;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async save(credential: StoredCredential): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(credential), { mode: 0o600, flush: true });
    await rename(tmp, this.path);
  }
}

export function keyFromCredential(credential: StoredCredential): DpopKey {
  const privateKey = createPrivateKey(credential.privateKeyPem);
  return dpopKeyFromKeyObjects(privateKey, createPublicKey(privateKey));
}

export function keyToPem(key: DpopKey): string {
  return key.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
}
