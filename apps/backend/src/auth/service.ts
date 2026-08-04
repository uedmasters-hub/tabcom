import { and, desc, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";

import { db, schema } from "../db/client";
import { TERMINATED_IDENTITY_GRACE_MS, assertNotEssentialMutation } from "../db/lifecycle";
import { checkInvite, consumeInvite, ensureInviteAllowance } from "./invites";
import { sendInviteRequestConfirmationEmail, sendMagicLinkEmail } from "./mailer";
import { generateToken, hashToken } from "./tokens";

const LOGIN_REQUEST_TTL_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // one request per email per minute
const HANDOFF_TTL_MS = 5 * 60 * 1000; // how long a verified session waits to be polled

export interface AuthenticatedUser {
  id: string;
  email: string;
  username: string | null;
  displayName: string | null;
  avatarColor: string | null;
  verified: boolean;
}

/** In-memory handoff from "link was clicked" to "extension's next poll
 *  picks it up" — the raw bearer token is generated at verify time and
 *  lives here just long enough to be collected once. It is never
 *  written to the database in any form, hashed or otherwise. */
const pendingHandoff = new Map<
  string,
  { rawSessionToken: string; user: AuthenticatedUser; expiresAt: number }
>();

function cleanupHandoffs() {
  const now = Date.now();
  for (const [pollId, entry] of pendingHandoff) {
    if (entry.expiresAt < now) pendingHandoff.delete(pollId);
  }
}

const recentRequestByEmail = new Map<string, number>();

const EMAIL_RULE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A fully registered account has durable identity fields — never
 *  null/empty username or display name. Ghost rows fail this check. */
export function isFullyRegisteredUser(user: {
  id?: string | null;
  username?: string | null;
  displayName?: string | null;
}): boolean {
  return (
    !!user.id &&
    !!user.username?.trim() &&
    !!user.displayName?.trim()
  );
}

export type RequestLinkResult =
  | { ok: true; pollId: string }
  | { ok: false; reason: "rate_limited" | "invalid_email" | "not_registered" };

/**
 * Record an early-access request and send the confirmation email.
 * Idempotent on email — re-submits refresh updatedAt / optional fields
 * without creating duplicates.
 */
export async function recordInviteRequest(input: {
  email: string;
  displayName?: string | null;
  reason?: string | null;
  source?: string;
  /** When false, skip the confirmation email (sign-in auto-waitlist).
   *  Explicit Settings → Request invite keeps the confirmation. */
  sendConfirmation?: boolean;
}): Promise<{ ok: true; created: boolean } | { ok: false; reason: "invalid_email" }> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RULE.test(email)) {
    return { ok: false, reason: "invalid_email" };
  }

  const [existing] = await db
    .select({ id: schema.inviteRequests.id })
    .from(schema.inviteRequests)
    .where(eq(schema.inviteRequests.email, email))
    .limit(1);

  if (existing) {
    await db
      .update(schema.inviteRequests)
      .set({
        displayName: input.displayName?.trim() || null,
        reason: input.reason?.trim() || null,
        source: input.source ?? "sign_in",
        updatedAt: new Date(),
      })
      .where(eq(schema.inviteRequests.id, existing.id));
    // Don't spam confirmation on every re-submit — only notify once
    // for brand-new waitlist entries.
    return { ok: true, created: false };
  }

  await db.insert(schema.inviteRequests).values({
    email,
    displayName: input.displayName?.trim() || null,
    reason: input.reason?.trim() || null,
    source: input.source ?? "sign_in",
  });

  // Sign-in's blocked path must not fire an email — users already saw
  // "no account found". Confirmation is for the deliberate request form.
  if (input.sendConfirmation !== false) {
    try {
      await sendInviteRequestConfirmationEmail(email);
    } catch (err) {
      console.error("[tabcom:auth] invite-request confirmation email failed:", err);
    }
  }

  return { ok: true, created: true };
}

/**
 * Sign-in is for EXISTING, fully registered accounts only.
 * Unregistered emails never get a magic link, never create a users
 * row, and are diverted into the invite-request waitlist instead.
 */
export async function requestMagicLink(
  rawEmail: string,
  publicBaseUrl: string
): Promise<RequestLinkResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_RULE.test(email)) {
    return { ok: false, reason: "invalid_email" };
  }

  // Eligibility FIRST — never rate-limit (or mint tokens for) an
  // address that isn't allowed to sign in. Unregistered emails must
  // always get a deterministic not_registered response.
  const [existingUser] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  if (
    !existingUser ||
    !isFullyRegisteredUser(existingUser) ||
    !EMAIL_RULE.test(existingUser.email ?? "")
  ) {
    // Waitlist is best-effort — a storage failure must NOT change the
    // auth decision or accidentally fall through into link minting.
    try {
      await recordInviteRequest({
        email,
        source: "sign_in",
        sendConfirmation: false,
      });
    } catch (err) {
      console.error("[tabcom:auth] invite-request record failed:", err);
    }
    console.info(
      `[tabcom:auth] sign-in blocked for unregistered/incomplete email=${email}`
    );
    return { ok: false, reason: "not_registered" };
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

/**
 * Read-only eligibility check — used by clients as a preflight so the
 * "check your email" UI can never appear for an ineligible address,
 * even if a later request-link call is mishandled.
 */
export async function checkEmailEligibleForSignIn(
  rawEmail: string
): Promise<
  | { ok: true; eligible: true }
  | { ok: true; eligible: false; reason: "not_registered" }
  | { ok: false; reason: "invalid_email" }
> {
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_RULE.test(email)) {
    return { ok: false, reason: "invalid_email" };
  }

  const [existingUser] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      username: schema.users.username,
      displayName: schema.users.displayName,
    })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  if (
    !existingUser ||
    !isFullyRegisteredUser(existingUser) ||
    !EMAIL_RULE.test(existingUser.email ?? "")
  ) {
    return { ok: true, eligible: false, reason: "not_registered" };
  }

  return { ok: true, eligible: true };
}

export type VerifyResult =
  | { ok: true; email: string }
  | { ok: false; reason: "invalid_or_expired" | "not_registered" };

/** Called when the person clicks the link in their email. Authenticates
 *  an EXISTING fully registered user only — never creates a users row.
 *  Issues a session and hands it off for the client's poll to collect. */
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

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, request.email))
    .limit(1);

  // Defense in depth: even if a login_request somehow exists for an
  // unregistered/incomplete email, never mint a session or create a row.
  if (!user || !isFullyRegisteredUser(user)) {
    console.warn(
      `[tabcom:auth] verify rejected incomplete/missing user for email=${request.email}`
    );
    return { ok: false, reason: "not_registered" };
  }

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
      username: user.username!,
      displayName: user.displayName!,
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
  if (!EMAIL_RULE.test(email)) {
    return { ok: false, reason: "invalid_email" };
  }

  const username = normalizeUsername(rawUsername);
  if (!USERNAME_RULE.test(username) || RESERVED_USERNAMES.has(username)) {
    return { ok: false, reason: "invalid_username" };
  }

  const name = displayName.trim();
  if (!name || name.length > 80) {
    return { ok: false, reason: "invalid_username" };
  }

  const color = (avatarColor || "").trim() || "#2563EB";

  // Look up the email's existing account FIRST — re-registering with
  // your own already-claimed username must be idempotent, not
  // rejected as "taken" by a check that doesn't know it's you.
  const [existingByEmail] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  const alreadyComplete = !!existingByEmail && isFullyRegisteredUser(existingByEmail);

  // Invite gate — new accounts AND incomplete/ghost rows only.
  // A fully registered account re-entering skips the gate (their seat
  // was already claimed). Ghost rows must NOT skip it — that was the
  // loophole that let magic-link orphans become real accounts without
  // an invite.
  if (!alreadyComplete) {
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

  let user = existingByEmail;
  if (!user) {
    const inserted = await db
      .insert(schema.users)
      .values({ email, username, displayName: name, avatarColor: color })
      .returning();
    user = inserted[0]!;
  } else if (!alreadyComplete) {
    // Heal a leftover incomplete row instead of leaving it orphaned.
    const [updated] = await db
      .update(schema.users)
      .set({ username, displayName: name, avatarColor: color })
      .where(eq(schema.users.id, user.id))
      .returning();
    user = updated ?? user;
  }

  if (!isFullyRegisteredUser(user)) {
    console.error("[tabcom:auth] register refused to persist incomplete user", {
      email,
      userId: user?.id,
    });
    return { ok: false, reason: "invalid_username" };
  }

  if (!alreadyComplete) {
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

  if (alreadyComplete && existingByEmail && existingByEmail.username !== username) {
    await db
      .update(schema.users)
      .set({ username, displayName: name, avatarColor: color })
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
      displayName: name,
      avatarColor: color,
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
): Promise<
  | { ok: true }
  | { ok: false; reason: "invalid_session" | "rate_limited" | "not_registered" }
> {
  const user = await validateSession(sessionToken);
  if (!user) return { ok: false, reason: "invalid_session" };

  // Defense in depth — validateSession already rejects incomplete
  // rows, but never mint a verification link without a full identity.
  if (!isFullyRegisteredUser(user) || !EMAIL_RULE.test(user.email ?? "")) {
    return { ok: false, reason: "not_registered" };
  }

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

  // Never authenticate incomplete / ghost accounts — mandatory identity
  // fields must be present or the session is treated as invalid.
  if (!row.userId || !row.username?.trim() || !row.displayName?.trim()) {
    console.warn(
      `[tabcom:auth] rejecting session for incomplete user id=${row.userId ?? "null"} email=${row.email}`
    );
    return null;
  }

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

  const name = displayName.trim();
  if (!name || name.length > 80) {
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
    .set({ username, displayName: name, avatarColor: avatarColor || "#2563EB" })
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
 * Ends a guest's session on THIS device.
 *
 * Permanent relationship purge + tombstone require `localCleared: true`
 * (client confirmed SQLite wipe). Without it we only soft-expire the
 * session row so device recognition stops, but graph purge waits.
 *
 * Expiry sweep calls the permanent path with `confirmed: true`.
 *
 * Returns guest usernames that were fully purged so the realtime layer
 * can strip pairs/communities and notify peers.
 */
export async function endGuestSessionNow(
  deviceId: string,
  opts?: { localCleared?: boolean; confirmed?: boolean }
): Promise<{ purgedUsernames: string[] }> {
  if (!deviceId) return { purgedUsernames: [] };

  const permanent = opts?.localCleared === true || opts?.confirmed === true;

  const guestRows = await db
    .select({ guestUsername: schema.sessions.guestUsername })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.deviceId, deviceId),
        eq(schema.sessions.sessionType, "guest"),
        eq(schema.sessions.status, "active")
      )
    );

  const guestUsernames = guestRows
    .map((row) => row.guestUsername)
    .filter((username): username is string => !!username);

  if (!permanent) {
    await db
      .update(schema.sessions)
      .set({ status: "expired", revoked: true })
      .where(
        and(
          eq(schema.sessions.deviceId, deviceId),
          eq(schema.sessions.sessionType, "guest"),
          eq(schema.sessions.status, "active")
        )
      );
    return { purgedUsernames: [] };
  }

  for (const guestUsername of guestUsernames) {
    await purgeGuestSqlArtifacts(guestUsername);
  }

  await db
    .delete(schema.sessions)
    .where(
      and(
        eq(schema.sessions.deviceId, deviceId),
        eq(schema.sessions.sessionType, "guest")
      )
    );

  return { purgedUsernames: guestUsernames };
}

/** SQL-only guest artifacts (never touches users / invites / board_state DDL). */
async function purgeGuestSqlArtifacts(guestUsername: string): Promise<void> {
  // Dev guard: refuse accidental essential-table destruction from this path.
  assertNotEssentialMutation("users", "delete_all");
  assertNotEssentialMutation("board_state", "drop");

  await db
    .delete(schema.communityActivity)
    .where(eq(schema.communityActivity.username, guestUsername))
    .catch((error) => {
      console.error("[tabcom] guest activity cleanup failed:", guestUsername, error);
    });

  const purgeAfter = new Date(Date.now() + TERMINATED_IDENTITY_GRACE_MS);
  await db
    .insert(schema.terminatedIdentities)
    .values({
      username: guestUsername,
      kind: "guest",
      terminatedAt: new Date(),
      purgeAfter,
    })
    .onConflictDoUpdate({
      target: schema.terminatedIdentities.username,
      set: {
        kind: "guest",
        terminatedAt: new Date(),
        purgeAfter,
      },
    })
    .catch((error) => {
      console.error("[tabcom] tombstone insert failed:", guestUsername, error);
    });
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
    await purgeGuestSqlArtifacts(guestUsername);
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

  // Soft-expired guests that never got localCleared: promote once TTL passes.
  const softExpired = await db
    .select({ guestUsername: schema.sessions.guestUsername })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.sessionType, "guest"),
        eq(schema.sessions.status, "expired"),
        lt(schema.sessions.expiresAt, new Date())
      )
    );

  for (const row of softExpired) {
    if (!row.guestUsername) continue;
    if (!expiredGuestUsernames.includes(row.guestUsername)) {
      expiredGuestUsernames.push(row.guestUsername);
    }
    await purgeGuestSqlArtifacts(row.guestUsername);
  }

  await db
    .delete(schema.sessions)
    .where(
      and(
        eq(schema.sessions.sessionType, "guest"),
        eq(schema.sessions.status, "expired"),
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

/** Active tombstones still inside the 24h grace window. */
export async function listActiveTerminatedIdentities(): Promise<string[]> {
  const rows = await db
    .select({ username: schema.terminatedIdentities.username })
    .from(schema.terminatedIdentities)
    .where(gt(schema.terminatedIdentities.purgeAfter, new Date()))
    .catch(() => [] as { username: string }[]);
  return rows.map((r) => r.username);
}

export async function isIdentityTerminated(username: string): Promise<boolean> {
  const [row] = await db
    .select({ username: schema.terminatedIdentities.username })
    .from(schema.terminatedIdentities)
    .where(eq(schema.terminatedIdentities.username, username))
    .limit(1)
    .catch(() => [] as { username: string }[]);
  return !!row;
}

/**
 * Remove tombstones past purgeAfter. Returns usernames fully gone so
 * peers can drop local stubs.
 */
export async function sweepTerminatedIdentityTombstones(): Promise<string[]> {
  const due = await db
    .select({ username: schema.terminatedIdentities.username })
    .from(schema.terminatedIdentities)
    .where(lt(schema.terminatedIdentities.purgeAfter, new Date()))
    .catch(() => [] as { username: string }[]);

  const usernames = due.map((r) => r.username);
  if (usernames.length === 0) return [];

  await db
    .delete(schema.terminatedIdentities)
    .where(lt(schema.terminatedIdentities.purgeAfter, new Date()))
    .catch((error) => {
      console.error("[tabcom] tombstone GC failed:", error);
    });

  return usernames;
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

/**
 * One-time (safe to re-run) cleanup of ghost / orphaned user rows —
 * accounts that were created by the old magic-link path with only an
 * email and never completed registration (null/empty username or
 * display name). Cascades wipe their sessions, invites, and settings
 * via FK onDelete. Valid fully-registered users are untouched.
 */
export async function purgeIncompleteUsers(): Promise<{ deleted: number }> {
  const ghosts = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      username: schema.users.username,
      displayName: schema.users.displayName,
    })
    .from(schema.users)
    .where(
      or(
        isNull(schema.users.username),
        eq(schema.users.username, ""),
        isNull(schema.users.displayName),
        eq(schema.users.displayName, "")
      )
    );

  if (ghosts.length === 0) {
    return { deleted: 0 };
  }

  const ids = ghosts.map((g) => g.id);

  // Explicitly revoke sessions first so any in-flight auth fails closed
  // even before the cascade delete lands.
  await db
    .update(schema.sessions)
    .set({ revoked: true, status: "revoked" })
    .where(inArray(schema.sessions.userId, ids));

  // Drop outstanding login requests for these emails so a stale link
  // can't be clicked after cleanup.
  const emails = ghosts.map((g) => g.email);
  await db
    .delete(schema.loginRequests)
    .where(inArray(schema.loginRequests.email, emails));

  await db.delete(schema.users).where(inArray(schema.users.id, ids));

  console.info(
    `[tabcom:auth] purged ${ids.length} incomplete user(s):`,
    ghosts.map((g) => g.email).join(", ")
  );

  return { deleted: ids.length };
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