import { and, desc, eq, gt, inArray, isNull, lt } from "drizzle-orm";

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
    sessionType: "registered",
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

export async function pollLoginRequest(
  pollId: string,
  deviceId?: string,
  browserInfo?: string
): Promise<PollResult> {
  cleanupHandoffs();

  const handoff = pendingHandoff.get(pollId);
  if (handoff) {
    // Single collection only — delete on read so a leaked pollId
    // can't be replayed to steal a session after the fact.
    pendingHandoff.delete(pollId);

    // The session row was created back in verifyMagicLink, when only
    // the emailed link's browser tab was involved — THIS request is
    // the first point the extension itself (which knows its own
    // device id) is in the loop, so fill it in now rather than leave
    // it permanently null for magic-link sessions.
    if (deviceId) {
      const tokenHash = hashToken(handoff.rawSessionToken);
      // Retire any OTHER active session already sitting on this
      // device before attaching it to the new one. Without this, a
      // still-unexpired leftover (most commonly a guest trial run on
      // this same browser shortly before signing in for real) would
      // remain "active" and — being older — would simply be shadowed
      // by the row we're about to create, only to resurface the
      // moment this new session is later revoked (see revokeSession's
      // doc comment for the full loop this caused).
      await db
        .update(schema.sessions)
        .set({ revoked: true })
        .where(and(eq(schema.sessions.deviceId, deviceId), eq(schema.sessions.revoked, false)));
      await db
        .update(schema.sessions)
        .set({ deviceId, browserInfo: browserInfo ?? null })
        .where(eq(schema.sessions.tokenHash, tokenHash));
    }

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

/**
 * Names that would be actively misleading or confusing if a regular
 * person claimed them — impersonation risk (admin/support/security),
 * platform-identity confusion (tabcom/official), or just reserved for
 * future product surfaces (api/bot/system). Checked on every path that
 * can claim a username: live availability check, registration, and
 * claim-username.
 */
const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "root",
  "system",
  "support",
  "help",
  "helpdesk",
  "security",
  "moderator",
  "mod",
  "staff",
  "team",
  "official",
  "tabcom",
  "tabcomteam",
  "api",
  "bot",
  "null",
  "undefined",
  "anonymous",
  "guest",
  "owner",
  "superadmin",
  "webmaster",
  "noreply",
  "no_reply",
  "everyone",
  "here",
]);

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

  if (RESERVED_USERNAMES.has(username)) {
    // Deliberately no suggestions built off the reserved word itself
    // (nobody should be nudged toward "admin2") — a generic fallback
    // gives the person somewhere to go without echoing the name back.
    return { ok: true, available: false, suggestions: await suggestUsernames("user") };
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
  rawInviteCode: string,
  deviceId?: string,
  browserInfo?: string
): Promise<RegisterResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, reason: "invalid_email" };
  }

  const username = normalizeUsername(rawUsername);
  if (!USERNAME_RULE.test(username) || RESERVED_USERNAMES.has(username)) {
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
  if (deviceId) {
    // Same device-level invariant as pollLoginRequest and
    // registerGuestSession: at most one active session per device.
    await db
      .update(schema.sessions)
      .set({ revoked: true })
      .where(and(eq(schema.sessions.deviceId, deviceId), eq(schema.sessions.revoked, false)));
  }
  await db.insert(schema.sessions).values({
    userId: user.id,
    tokenHash: hashToken(rawSessionToken),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    sessionType: "registered",
    deviceId: deviceId ?? null,
    browserInfo: browserInfo ?? null,
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
    // userId is nullable at the column level now (guest sessions have
    // none), but this specific query INNER JOINs on it matching a real
    // users.id — a guest session (userId: null) can never satisfy that
    // join, so any row reaching this point is guaranteed to have one.
    id: row.userId!,
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
/**
 * Whether a real, registered account already holds this username.
 * Used by the socket layer to stop an unauthenticated (guest) "hello"
 * from claiming a name that belongs to an actual account — the same
 * uniqueness guarantee registration itself already enforces, extended
 * to cover the one path that used to bypass it entirely.
 */
export async function isUsernameRegistered(username: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .limit(1);
  return !!existing;
}

export async function claimUsername(
  userId: string,
  rawUsername: string,
  displayName: string,
  avatarColor: string
): Promise<{ ok: true } | { ok: false; reason: "taken" | "invalid_username" }> {
  const username = normalizeUsername(rawUsername);
  if (!USERNAME_RULE.test(username) || RESERVED_USERNAMES.has(username)) {
    return { ok: false, reason: "invalid_username" };
  }

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

/**
 * Explicit sign-out: revokes THIS session only (not every session on
 * every device — same principle as most real products, and consistent
 * with sessions already being per-device rows rather than a single
 * account-wide flag). Idempotent: revoking an already-revoked or
 * unknown token is not an error, since the end state the caller wants
 * ("this token no longer works") is already true either way.
 */
/**
 * Explicit sign-out: revokes every active session tied to THIS
 * device (not just the token being signed out with).
 *
 * Why "this device" and not "this token" alone: findActiveSessionForDevice
 * resolves the device's most-recently-created active, non-revoked
 * session — singular, by design, since a device is meant to have at
 * most one live session at a time (see registerGuestSession's matching
 * enforcement). If sign-out only revoked the one token, an OLDER
 * still-unexpired row for the same device (e.g. a guest trial run on
 * this browser minutes before registering a real account) would
 * become the "most recent active" row the instant the newer one is
 * revoked — silently resurrecting that stale identity on the very
 * next device-recognition check, which is exactly the loop this was
 * causing: sign out of the real account, bounce straight back into a
 * leftover guest session, "sign out" appearing to do nothing.
 *
 * Revoking by deviceId rather than by a single tokenHash makes
 * sign-out authoritative: this device ends up with zero active
 * sessions, full stop, regardless of how many rows accumulated on it.
 * Idempotent for the same reason the token-scoped version was —
 * revoking rows that are already revoked, or a deviceId with none, is
 * simply a no-op UPDATE.
 */
export async function revokeSession(rawSessionToken: string): Promise<{ ok: true }> {
  const tokenHash = hashToken(rawSessionToken);
  const [target] = await db
    .select({ deviceId: schema.sessions.deviceId })
    .from(schema.sessions)
    .where(eq(schema.sessions.tokenHash, tokenHash))
    .limit(1);

  if (target?.deviceId) {
    await db
      .update(schema.sessions)
      .set({ revoked: true })
      .where(and(eq(schema.sessions.deviceId, target.deviceId), eq(schema.sessions.revoked, false)));
  } else {
    // No deviceId on record for this token (older row predating device
    // tracking, or none was ever sent) — fall back to the narrow,
    // token-only revoke so sign-out still works for that session.
    await db
      .update(schema.sessions)
      .set({ revoked: true })
      .where(eq(schema.sessions.tokenHash, tokenHash));
  }

  return { ok: true };
}

/**
 * Permanently deletes the account and everything that references it.
 * The users row is the single source of truth here — sessions and
 * invites both carry `references(() => users.id, { onDelete: "cascade" })`
 * already (see db/schema.ts), so one DELETE is enough; there is no
 * separate cleanup pass to forget.
 *
 * Deliberately does NOT touch community membership or board data —
 * those live entirely in the realtime server's in-memory/snapshot
 * state (see index.ts's `communities` map), not in this database, and
 * are keyed by username rather than user id. A deleted account's
 * username simply becomes free to re-register, same as if they'd
 * never signed up.
 */
export async function deleteAccount(
  rawSessionToken: string
): Promise<{ ok: true } | { ok: false; reason: "invalid_session" }> {
  const user = await validateSession(rawSessionToken);
  if (!user) return { ok: false, reason: "invalid_session" };

  await db.delete(schema.users).where(eq(schema.users.id, user.id));
  return { ok: true };
}

// ---- Device recognition (Phase 1 of session management) -------------------
//
// "Device fingerprint" here means a random id the extension generates
// once and keeps in a storage key that survives sign-out/guest-expiry
// resets (see the client's device-id.ts) — NOT a hardware/MAC
// fingerprint. Browsers deliberately expose no such thing to any web
// or extension code, for the same privacy reasons this project cares
// about; building a substitute (canvas/audio fingerprinting) would
// actively work against that. This deviceId is a bearer-token-like
// secret in the sense that its SECRECY (not complexity of lookup) is
// what protects it — same trust model as a session token — so it's
// generated with real randomness and never logged or sent anywhere
// except this server.

const GUEST_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes — matches the client's own guest session lifetime

/**
 * Records a NEW guest session server-side. Previously guest identity
 * was purely client-side (a locally-generated username, never known
 * to the server until the socket connects) — this gives the "single
 * source of truth" sessions table real visibility into guest sessions
 * too, and is what makes device recognition for RETURNING guests
 * possible at all.
 */
export async function registerGuestSession(input: {
  guestUsername: string;
  deviceId: string;
  browserInfo?: string;
}): Promise<void> {
  // Same device-level invariant as registerAccount and
  // pollLoginRequest: at most one active session per device, so an
  // older row (registered OR guest) can never be shadowed-then-later-
  // resurrected once the new one is eventually revoked.
  await db
    .update(schema.sessions)
    .set({ revoked: true })
    .where(and(eq(schema.sessions.deviceId, input.deviceId), eq(schema.sessions.revoked, false)));

  await db.insert(schema.sessions).values({
    guestUsername: input.guestUsername,
    deviceId: input.deviceId,
    browserInfo: input.browserInfo ?? null,
    sessionType: "guest",
    status: "active",
    expiresAt: new Date(Date.now() + GUEST_SESSION_TTL_MS),
  });
}

export interface DeviceSessionInfo {
  sessionType: "registered" | "guest";
  expiresAt: Date;
  /** Only set for sessionType "guest". */
  guestUsername?: string;
}

/**
 * The core of "device recognition" — given a deviceId, is there an
 * active, non-expired session for it? Used on app startup so a
 * returning device doesn't have to repeat onboarding.
 *
 * Deliberately does NOT return the session's bearer token, even for a
 * registered session — a device id alone is not proof of anything
 * beyond "the caller knows this device id" (unlike a session token,
 * whose entire purpose IS to prove exactly that). For a registered
 * account, this endpoint is a hint the client already has its own
 * valid sessionToken and can keep using it; the client's own local
 * copy is what actually authenticates every subsequent request, same
 * as it always has. For a guest, there's no bearer token to withhold
 * in the first place — the returned guestUsername/expiresAt IS
 * everything needed to resume, since guests authenticate purely via
 * their live socket identity.
 */
export async function findActiveSessionForDevice(
  deviceId: string
): Promise<DeviceSessionInfo | null> {
  if (!deviceId) return null;

  const [row] = await db
    .select()
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.deviceId, deviceId),
        eq(schema.sessions.status, "active"),
        eq(schema.sessions.revoked, false)
      )
    )
    .orderBy(desc(schema.sessions.createdAt))
    .limit(1);

  if (!row) return null;
  if (row.expiresAt < new Date()) return null;

  return {
    sessionType: (row.sessionType as "registered" | "guest") ?? "registered",
    expiresAt: row.expiresAt,
    guestUsername: row.guestUsername ?? undefined,
  };
}

/**
 * Sweeps every session whose expiresAt has passed but whose status is
 * still "active" into "expired" — an explicit lifecycle transition
 * rather than every reader independently re-deriving "expired" from a
 * timestamp comparison. Cheap and safe to run frequently; called from
 * index.ts on the same kind of interval as the other periodic
 * housekeeping in this project.
 */
/**
 * Registered sessions: marked "expired", never deleted — per the
 * spec's own framing, "only the session should expire, not the
 * user's data," and their data lives in the users/invites tables
 * regardless of session status.
 *
 * Guest sessions: the session row is DELETED outright once expired
 * (not just marked), and — deliberately SCOPED — their own
 * community_activity rows (their personal audit trail: which
 * communities they joined/left, which tabs/pins/areas they added) are
 * deleted alongside it. This is the guest cascading-cleanup the
 * session-management spec asked for, scoped to what's genuinely the
 * guest's OWN data.
 *
 * Explicitly NOT deleted: the pins/tabs/areas/community membership
 * itself. Those are shared community objects other members are
 * actively relying on — deleting a guest's contributions to a shared
 * board out from under everyone else the moment their personal 30
 * minutes run out would reintroduce the exact "pins vanish" failure
 * this project already spent real effort fixing (see boardState's own
 * doc comment), just reframed as an intentional feature. Their pin
 * stays, still attributed to their now-expired guest username — the
 * same way any other historical attribution in this app works once
 * the person behind it has moved on.
 */
export async function sweepExpiredSessions(): Promise<{ expiredGuestUsernames: string[] }> {
  const expiredGuestSessions = await db
    .select({ guestUsername: schema.sessions.guestUsername })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.status, "active"),
        eq(schema.sessions.sessionType, "guest"),
        lt(schema.sessions.expiresAt, new Date())
      )
    );

  const expiredGuestUsernames = expiredGuestSessions
    .map((row) => row.guestUsername)
    .filter((username): username is string => !!username);

  for (const guestUsername of expiredGuestUsernames) {
    await db
      .delete(schema.communityActivity)
      .where(eq(schema.communityActivity.username, guestUsername))
      .catch((error) => {
        console.error("[tabcom] guest activity cleanup failed:", guestUsername, error);
      });
  }

  await db
    .delete(schema.sessions)
    .where(
      and(
        eq(schema.sessions.status, "active"),
        eq(schema.sessions.sessionType, "guest"),
        lt(schema.sessions.expiresAt, new Date())
      )
    );

  await db
    .update(schema.sessions)
    .set({ status: "expired" })
    .where(
      and(
        eq(schema.sessions.status, "active"),
        eq(schema.sessions.sessionType, "registered"),
        lt(schema.sessions.expiresAt, new Date())
      )
    );

  return { expiredGuestUsernames };
}

// ---- Registered-user settings sync (Phase 2 of session management) --------
//
// Guests are deliberately excluded — validateSession only ever
// resolves a userId for a registered account (see its INNER JOIN doc
// comment), and there's no guest equivalent here on purpose: a guest
// identity has nothing durable to sync settings against once its
// session ends, which is the whole point of it being disposable.

export async function getUserSettings(
  rawSessionToken: string
): Promise<{ ok: true; settings: unknown } | { ok: false; reason: "invalid_session" }> {
  const user = await validateSession(rawSessionToken);
  if (!user) return { ok: false, reason: "invalid_session" };

  const [row] = await db
    .select()
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, user.id))
    .limit(1);

  return { ok: true, settings: row?.data ?? null };
}

export async function saveUserSettings(
  rawSessionToken: string,
  settings: unknown
): Promise<{ ok: true } | { ok: false; reason: "invalid_session" }> {
  const user = await validateSession(rawSessionToken);
  if (!user) return { ok: false, reason: "invalid_session" };

  await db
    .insert(schema.userSettings)
    .values({ userId: user.id, data: settings, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.userSettings.userId,
      set: { data: settings, updatedAt: new Date() },
    });

  return { ok: true };
}