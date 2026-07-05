import { and, eq, gt, inArray, isNull } from "drizzle-orm";

import { db, schema } from "../db/client";
import { checkInvite, consumeInvite, ensureInviteAllowance } from "./invites";
import { sendMagicLinkEmail } from "./mailer";
import { generateToken, hashToken } from "./tokens";

const LOGIN_REQUEST_TTL_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // one request per email per minute
const HANDOFF_TTL_MS = 5 * 60 * 1000; // how long a verified session waits to be polled

/** In-memory handoff from "link was clicked" to "extension's next poll
 *  picks it up" — the raw bearer token is generated at verify time and
 *  lives here just long enough to be collected once. It is never
 *  written to the database in any form, hashed or otherwise. */
const pendingHandoff = new Map<
  string,
  { rawSessionToken: string; user: { id: string; email: string; username: string | null; displayName: string | null; avatarColor: string | null; verified: boolean }; expiresAt: number }
>();

function cleanupHandoffs() {
  const now = Date.now();
  for (const [pollId, entry] of pendingHandoff) {
    if (entry.expiresAt < now) pendingHandoff.delete(pollId);
  }
}

const recentRequestByEmail = new Map<string, number>();

export type RequestLinkResult =
  | { ok: true; pollId: string }
  | { ok: false; reason: "rate_limited" | "invalid_email" };

export async function requestMagicLink(
  rawEmail: string,
  publicBaseUrl: string
): Promise<RequestLinkResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, reason: "invalid_email" };
  }

  const lastRequest = recentRequestByEmail.get(email);
  if (lastRequest && Date.now() - lastRequest < RATE_LIMIT_WINDOW_MS) {
    return { ok: false, reason: "rate_limited" };
  }
  recentRequestByEmail.set(email, Date.now());

  const token = generateToken();
  const pollId = generateToken();
  const expiresAt = new Date(Date.now() + LOGIN_REQUEST_TTL_MS);

  await db.insert(schema.loginRequests).values({
    email,
    tokenHash: hashToken(token),
    pollId,
    expiresAt,
  });

  const verifyUrl = `${publicBaseUrl}/auth/verify?token=${encodeURIComponent(token)}`;
  await sendMagicLinkEmail(email, verifyUrl);

  return { ok: true, pollId };
}

export type VerifyResult =
  | { ok: true; email: string }
  | { ok: false; reason: "invalid_or_expired" };

/** Called when the person clicks the link in their email. Finds (or
 *  creates) the user, issues a real session, and hands it off for the
 *  extension's poll to collect — nothing about the session itself is
 *  ever returned to this HTTP response, which is just a web page the
 *  person sees in their browser, not the extension. */
export async function verifyMagicLink(rawToken: string): Promise<VerifyResult> {
  cleanupHandoffs();

  const tokenHash = hashToken(rawToken);
  const [request] = await db
    .select()
    .from(schema.loginRequests)
    .where(
      and(
        eq(schema.loginRequests.tokenHash, tokenHash),
        isNull(schema.loginRequests.consumedAt),
        gt(schema.loginRequests.expiresAt, new Date())
      )
    )
    .limit(1);

  if (!request) return { ok: false, reason: "invalid_or_expired" };

  await db
    .update(schema.loginRequests)
    .set({ consumedAt: new Date() })
    .where(eq(schema.loginRequests.id, request.id));

  const [existingUser] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, request.email))
    .limit(1);

  const user =
    existingUser ??
    (
      await db.insert(schema.users).values({ email: request.email }).returning()
    )[0]!;

  // Clicking the link IS the proof of email control — mark verified
  // regardless of whether this account already existed (lean
  // onboarding's "verify later") or is being created fresh here (the
  // original direct sign-in path). Idempotent if already verified.
  if (!user.emailVerifiedAt) {
    await db
      .update(schema.users)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(schema.users.id, user.id));
  }

  const rawSessionToken = generateToken();
  await db.insert(schema.sessions).values({
    userId: user.id,
    tokenHash: hashToken(rawSessionToken),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });

  pendingHandoff.set(request.pollId, {
    rawSessionToken,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      avatarColor: user.avatarColor,
      verified: true,
    },
    expiresAt: Date.now() + HANDOFF_TTL_MS,
  });

  return { ok: true, email: request.email };
}

export type PollResult =
  | { status: "waiting" }
  | {
      status: "verified";
      sessionToken: string;
      user: { id: string; email: string; username: string | null; displayName: string | null; avatarColor: string | null; verified: boolean };
    }
  | { status: "expired" };

export async function pollLoginRequest(pollId: string): Promise<PollResult> {
  cleanupHandoffs();

  const handoff = pendingHandoff.get(pollId);
  if (handoff) {
    // Single collection only — delete on read so a leaked pollId
    // can't be replayed to steal a session after the fact.
    pendingHandoff.delete(pollId);
    return {
      status: "verified",
      sessionToken: handoff.rawSessionToken,
      user: handoff.user,
    };
  }

  const [request] = await db
    .select()
    .from(schema.loginRequests)
    .where(eq(schema.loginRequests.pollId, pollId))
    .limit(1);

  if (!request || request.expiresAt < new Date()) {
    return { status: "expired" };
  }
  return { status: "waiting" };
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  username: string | null;
  displayName: string | null;
  avatarColor: string | null;
  verified: boolean;
}

const USERNAME_RULE = /^[a-z0-9_]{3,20}$/;

function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@/, "");
}

export type UsernameCheckResult =
  | { ok: true; available: true }
  | { ok: true; available: false; suggestions: string[] }
  | { ok: false; reason: "invalid_format" };

/**
 * Live availability check for the onboarding username field. When
 * taken, returns real suggestions rather than just "no" — decorated
 * variants (name1, name_394) rather than the bare name itself. This
 * is deliberate, not a fallback of convenience: clean short handles
 * are worth reserving rather than handing out as an accident of who
 * typed fastest (see suggestUsernames for the reasoning).
 */
export async function checkUsernameAvailable(
  rawUsername: string
): Promise<UsernameCheckResult> {
  const username = normalizeUsername(rawUsername);
  if (!USERNAME_RULE.test(username)) {
    return { ok: false, reason: "invalid_format" };
  }

  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .limit(1);

  if (!existing) return { ok: true, available: true };

  return { ok: true, available: false, suggestions: await suggestUsernames(username) };
}

/**
 * Generates decorated variants of a taken username and returns only
 * the ones actually free — one DB round trip, not one per candidate.
 *
 * Deliberately biased AWAY from suggesting the bare name with a
 * trivial "2" appended, and toward visibly-decorated handles (a
 * trailing random-looking number, an underscore break). The plain,
 * short form of a popular name is worth more sitting available than
 * handed to whoever typed it first — it's the asset a later verified/
 * enterprise-handle offering would actually be selling.
 */
export async function suggestUsernames(base: string): Promise<string[]> {
  const clean = normalizeUsername(base).replace(/[^a-z0-9_]/g, "").slice(0, 15) || "user";

  const candidates = [
    `${clean}${Math.floor(Math.random() * 9) + 1}`,
    `${clean}${String(Math.floor(Math.random() * 90) + 10)}`,
    `${clean}_${String(Math.floor(Math.random() * 900) + 100)}`,
    `${clean}${String(Math.floor(Math.random() * 9000) + 1000)}`,
    `real_${clean}`,
    `${clean}_official`,
  ];

  const rows = await db
    .select({ username: schema.users.username })
    .from(schema.users)
    .where(inArray(schema.users.username, candidates));

  const taken = new Set(rows.map((r) => r.username));
  return candidates.filter((c) => !taken.has(c)).slice(0, 4);
}

export type RegisterResult =
  | { ok: true; sessionToken: string; user: AuthenticatedUser }
  | { ok: false; reason: "invalid_email" | "invalid_username" | "username_taken" | "invalid_invite" };

/**
 * The lean onboarding path: create a usable, fully-functional account
 * immediately from name + username + email, with NO click-a-link step
 * in the way. Email verification becomes a background upgrade the
 * person can complete whenever — see sendVerificationEmail below —
 * not a gate between signing up and using the product.
 *
 * Tabcom is invite-only: a valid invitation code (single-use, or the
 * operator's master code) is required to create a NEW account. People
 * re-registering with an email that already has an account skip the
 * gate — their seat was already claimed, re-entry shouldn't burn a
 * second code.
 */
export async function registerAccount(
  rawEmail: string,
  rawUsername: string,
  displayName: string,
  avatarColor: string,
  rawInviteCode: string
): Promise<RegisterResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, reason: "invalid_email" };
  }

  const username = normalizeUsername(rawUsername);
  if (!USERNAME_RULE.test(username)) {
    return { ok: false, reason: "invalid_username" };
  }

  // Look up the email's existing account FIRST — re-registering with
  // your own already-claimed username must be idempotent, not
  // rejected as "taken" by a check that doesn't know it's you.
  const [existingByEmail] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  // Invite gate — new accounts only. Fail BEFORE creating anything so
  // a rejected registration leaves no trace.
  if (!existingByEmail) {
    const gate = await checkInvite(rawInviteCode);
    if (!gate.ok) return { ok: false, reason: "invalid_invite" };
  }

  const [usernameTaken] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .limit(1);
  if (usernameTaken && usernameTaken.id !== existingByEmail?.id) {
    return { ok: false, reason: "username_taken" };
  }

  const user =
    existingByEmail ??
    (
      await db
        .insert(schema.users)
        .values({ email, username, displayName, avatarColor })
        .returning()
    )[0]!;

  if (!existingByEmail) {
    // Atomic claim — the pre-check above can race, this can't. If the
    // code was snatched between the two, the account row is harmless
    // (registerAccount is idempotent by email) and the person can
    // retry with a fresh code.
    const claimed = await consumeInvite(rawInviteCode, user.id);
    if (!claimed.ok) return { ok: false, reason: "invalid_invite" };
  }

  // Top up the invite allowance if this account has never had one —
  // covers a fresh registration AND an account created before the
  // invite system existed logging back in. A no-op for anyone who
  // already has codes.
  await ensureInviteAllowance(user.id);

  if (existingByEmail && existingByEmail.username !== username) {
    await db
      .update(schema.users)
      .set({ username, displayName, avatarColor })
      .where(eq(schema.users.id, user.id));
  }

  const rawSessionToken = generateToken();
  await db.insert(schema.sessions).values({
    userId: user.id,
    tokenHash: hashToken(rawSessionToken),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });

  return {
    ok: true,
    sessionToken: rawSessionToken,
    user: {
      id: user.id,
      email: user.email,
      username,
      displayName,
      avatarColor,
      verified: !!existingByEmail?.emailVerifiedAt,
    },
  };
}

/**
 * Triggered explicitly from Settings ('Verify your email') rather
 * than blocking onboarding — reuses the exact same loginRequests +
 * dev-mode-logs-instead-of-emails mechanism as the original magic
 * link, because the underlying primitive (prove you control this
 * inbox) hasn't changed, only when it's asked for.
 */
export async function sendVerificationEmail(
  sessionToken: string,
  publicBaseUrl: string
): Promise<{ ok: true } | { ok: false; reason: "invalid_session" | "rate_limited" }> {
  const user = await validateSession(sessionToken);
  if (!user) return { ok: false, reason: "invalid_session" };

  const lastRequest = recentRequestByEmail.get(user.email);
  if (lastRequest && Date.now() - lastRequest < RATE_LIMIT_WINDOW_MS) {
    return { ok: false, reason: "rate_limited" };
  }
  recentRequestByEmail.set(user.email, Date.now());

  const token = generateToken();
  const pollId = generateToken();
  await db.insert(schema.loginRequests).values({
    email: user.email,
    tokenHash: hashToken(token),
    pollId,
    expiresAt: new Date(Date.now() + LOGIN_REQUEST_TTL_MS),
  });

  const verifyUrl = `${publicBaseUrl}/auth/verify?token=${encodeURIComponent(token)}`;
  await sendMagicLinkEmail(user.email, verifyUrl);
  return { ok: true };
}

/** Validates a session bearer token — this is what gates every socket
 *  connection now, replacing the old "hello, trust me" model. */
export async function validateSession(
  rawSessionToken: string
): Promise<AuthenticatedUser | null> {
  const tokenHash = hashToken(rawSessionToken);

  const [row] = await db
    .select({
      userId: schema.sessions.userId,
      expiresAt: schema.sessions.expiresAt,
      revoked: schema.sessions.revoked,
      email: schema.users.email,
      username: schema.users.username,
      displayName: schema.users.displayName,
      avatarColor: schema.users.avatarColor,
      emailVerifiedAt: schema.users.emailVerifiedAt,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(eq(schema.sessions.tokenHash, tokenHash))
    .limit(1);

  if (!row || row.revoked || row.expiresAt < new Date()) return null;

  void db
    .update(schema.sessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(schema.sessions.tokenHash, tokenHash))
    .catch(() => {}); // best-effort, never block auth on this

  return {
    id: row.userId,
    email: row.email,
    username: row.username,
    displayName: row.displayName,
    avatarColor: row.avatarColor,
    verified: !!row.emailVerifiedAt,
  };
}

/** Claims a username for an authenticated user — the FIRST real
 *  uniqueness enforcement this project has ever had. Returns false if
 *  taken by someone else (idempotent if it's already yours). */
export async function claimUsername(
  userId: string,
  username: string,
  displayName: string,
  avatarColor: string
): Promise<{ ok: true } | { ok: false; reason: "taken" }> {
  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .limit(1);

  if (existing && existing.id !== userId) {
    return { ok: false, reason: "taken" };
  }

  await db
    .update(schema.users)
    .set({ username, displayName, avatarColor })
    .where(eq(schema.users.id, userId));

  return { ok: true };
}
