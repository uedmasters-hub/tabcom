import { createHash, randomBytes } from "node:crypto";

/** A URL-safe random secret. Used for magic-link tokens, poll ids,
 *  and session tokens — each is a fresh 256-bit value. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** One-way hash for anything we store — the raw token exists only in
 *  the email we send / the bearer credential the client holds, never
 *  at rest in the database. A leaked database backup should not be
 *  enough to sign in as anyone. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
