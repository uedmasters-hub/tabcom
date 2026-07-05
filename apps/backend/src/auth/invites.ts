import { randomInt } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import { db, schema } from "../db/client";

/** How many codes every new account gets to hand out. */
export const INVITES_PER_USER = 5;

/**
 * The operator's way in. Multi-use, env-configured, never stored in
 * the database — a leaked DB dump can't reveal it, and it can be
 * rotated by changing one env var. If unset, only table codes work.
 */
const MASTER_INVITE = (process.env.TABCOM_MASTER_INVITE ?? "").trim();

if (!MASTER_INVITE) {
  console.warn(
    "[tabcom:invites] TABCOM_MASTER_INVITE is not set — no master code is active. " +
      "Only single-use codes from the invites table will be accepted."
  );
}

/** Crockford-ish alphabet: no 0/O, no 1/I/L — every code survives
 *  being read aloud or hand-typed from a screenshot. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function randomGroup(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}

/** e.g. TAB-7F3K-Q2ND */
export function generateInviteCode(): string {
  return `TAB-${randomGroup(4)}-${randomGroup(4)}`;
}

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

function isMaster(code: string): boolean {
  return !!MASTER_INVITE && code === MASTER_INVITE.toUpperCase();
}

export type InviteCheckResult =
  | { ok: true }
  | { ok: false; reason: "invalid_invite" };

/**
 * Non-consuming pre-check, used by the extension's register gate for
 * live feedback while typing. The authoritative check is the atomic
 * consume at registration time — this one just makes the UI honest.
 */
export async function checkInvite(rawCode: string): Promise<InviteCheckResult> {
  const code = normalizeCode(rawCode);
  if (!code) return { ok: false, reason: "invalid_invite" };
  if (isMaster(code)) return { ok: true };

  const [row] = await db
    .select({ id: schema.invites.id })
    .from(schema.invites)
    .where(and(eq(schema.invites.code, code), isNull(schema.invites.usedBy)))
    .limit(1);

  return row ? { ok: true } : { ok: false, reason: "invalid_invite" };
}

/**
 * Atomically claim a code for a freshly created user. The
 * `used_by IS NULL` guard in the UPDATE is what makes this safe under
 * concurrency — two simultaneous registrations with the same code can
 * both pass the pre-check, but only one UPDATE will match a row.
 * Master codes always succeed and consume nothing.
 */
export async function consumeInvite(
  rawCode: string,
  userId: string
): Promise<InviteCheckResult> {
  const code = normalizeCode(rawCode);
  if (isMaster(code)) return { ok: true };

  const claimed = await db
    .update(schema.invites)
    .set({ usedBy: userId, usedAt: new Date() })
    .where(and(eq(schema.invites.code, code), isNull(schema.invites.usedBy)))
    .returning({ id: schema.invites.id });

  return claimed.length > 0 ? { ok: true } : { ok: false, reason: "invalid_invite" };
}

/**
 * Grant a new account its allowance. Retries on the (astronomically
 * unlikely) unique-code collision rather than failing registration
 * over it.
 */
export async function grantInvites(userId: string): Promise<void> {
  let granted = 0;
  let attempts = 0;

  while (granted < INVITES_PER_USER && attempts < INVITES_PER_USER * 3) {
    attempts++;
    try {
      await db
        .insert(schema.invites)
        .values({ code: generateInviteCode(), createdBy: userId });
      granted++;
    } catch {
      // unique collision — regenerate and try again
    }
  }
}

/**
 * Self-healing top-up: grants the allowance if (and only if) this
 * account currently holds zero codes. Covers two cases with one
 * check — a brand-new registration, AND an account that predates the
 * invite system entirely (created back when registerAccount had no
 * gate at all) logging back in and finally getting its codes.
 * Never re-tops an account that already has some — 5 is a one-time
 * grant, not a recurring allowance.
 */
export async function ensureInviteAllowance(userId: string): Promise<void> {
  const [existing] = await db
    .select({ id: schema.invites.id })
    .from(schema.invites)
    .where(eq(schema.invites.createdBy, userId))
    .limit(1);

  if (!existing) await grantInvites(userId);
}

export interface InviteSummary {
  code: string;
  used: boolean;
  usedAt: string | null;
}

/** Every code this user owns, for the Settings "Invitations" panel. */
export async function listInvites(userId: string): Promise<InviteSummary[]> {
  const rows = await db
    .select({
      code: schema.invites.code,
      usedAt: schema.invites.usedAt,
    })
    .from(schema.invites)
    .where(eq(schema.invites.createdBy, userId))
    .orderBy(schema.invites.createdAt);

  return rows.map((row) => ({
    code: row.code,
    used: !!row.usedAt,
    usedAt: row.usedAt ? row.usedAt.toISOString() : null,
  }));
}
