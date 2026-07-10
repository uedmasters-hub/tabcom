import { REALTIME_URL } from "./realtime";

/**
 * HTTP client for the magic-link auth flow. Deliberately plain fetch
 * calls, not socket events — this happens BEFORE the person has a
 * session to authenticate a socket connection with at all.
 *
 * Every call goes through authFetch, which bounds how long we'll ever
 * wait and normalizes failure into a real return value instead of a
 * thrown exception a caller might forget to catch. Two genuinely
 * different things can make these calls fail — the local dev server
 * not running at all (fails fast), or a serverless Postgres provider
 * like Neon waking up from auto-suspend (can legitimately take a few
 * seconds) — and a caller shouldn't need to know which one to give a
 * correct UI. It just needs a bounded wait and an honest "couldn't
 * reach it" result either way.
 */

const TIMEOUT_MS = 10_000;

async function authFetch<T>(path: string, init?: RequestInit): Promise<T | { ok: false; reason: "unreachable" }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${REALTIME_URL}${path}`, { ...init, signal: controller.signal });
    return (await res.json()) as T;
  } catch {
    // Covers both cases: nothing listening at all (fails in
    // milliseconds) and something listening but too slow to answer
    // within TIMEOUT_MS (e.g. a cold-starting database) — same
    // observable outcome from here, same honest message either way.
    return { ok: false, reason: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

export interface RequestLinkResult {
  ok: boolean;
  pollId?: string;
  reason?: "rate_limited" | "invalid_email" | "unreachable";
}

export async function requestMagicLink(email: string): Promise<RequestLinkResult> {
  return authFetch<RequestLinkResult>("/auth/request-link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  username: string | null;
  displayName: string | null;
  avatarColor: string | null;
  verified: boolean;
}

export type PollResult =
  | { status: "waiting" }
  | { status: "verified"; sessionToken: string; user: AuthenticatedUser }
  | { status: "expired" }
  | { status: "unreachable" };

export async function pollLoginRequest(pollId: string): Promise<PollResult> {
  const result = await authFetch<PollResult>(`/auth/poll?pollId=${encodeURIComponent(pollId)}`);
  if ("reason" in result && result.reason === "unreachable") {
    return { status: "unreachable" };
  }
  return result as PollResult;
}

export type ClaimUsernameResult =
  | { ok: true }
  | { ok: false; reason: "taken" | "invalid_username" | "invalid_session" | "unreachable" };

export async function claimUsername(
  sessionToken: string,
  username: string,
  displayName: string,
  avatarColor: string
): Promise<ClaimUsernameResult> {
  return authFetch<ClaimUsernameResult>("/auth/claim-username", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionToken, username, displayName, avatarColor }),
  });
}

/**
 * Polls until the person clicks the link in their email, or gives up
 * after the login request expires. Returns null on expiry/cancel/
 * sustained unreachability (a handful of consecutive failed polls,
 * not just one blip).
 */
export async function waitForLogin(
  pollId: string,
  options: { intervalMs?: number; signal?: AbortSignal } = {}
): Promise<{ sessionToken: string; user: AuthenticatedUser } | null> {
  const intervalMs = options.intervalMs ?? 2000;
  let consecutiveUnreachable = 0;

  while (!options.signal?.aborted) {
    const result = await pollLoginRequest(pollId);
    if (result.status === "verified") {
      return { sessionToken: result.sessionToken, user: result.user };
    }
    if (result.status === "expired") return null;
    if (result.status === "unreachable") {
      consecutiveUnreachable += 1;
      if (consecutiveUnreachable >= 15) return null; // ~30s of nothing but failures
    } else {
      consecutiveUnreachable = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

export type UsernameCheckResult =
  | { ok: true; available: true }
  | { ok: true; available: false; suggestions: string[] }
  | { ok: false; reason: "invalid_format" | "unreachable" };

export async function checkUsernameAvailable(username: string): Promise<UsernameCheckResult> {
  return authFetch<UsernameCheckResult>(`/auth/check-username?username=${encodeURIComponent(username)}`);
}

export type RegisterResult =
  | { ok: true; sessionToken: string; user: AuthenticatedUser }
  | { ok: false; reason: "invalid_email" | "invalid_username" | "username_taken" | "invalid_invite" | "unreachable" };

/** The lean onboarding path — creates a fully usable account and
 *  session in one call, no click-a-link wait. Invite-gated: a valid
 *  invitation code is required for new accounts. */
export async function registerAccount(
  email: string,
  username: string,
  displayName: string,
  avatarColor: string,
  inviteCode: string
): Promise<RegisterResult> {
  return authFetch<RegisterResult>("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, username, displayName, avatarColor, inviteCode }),
  });
}

export type InviteCheckResult =
  | { ok: true }
  | { ok: false; reason: "invalid_invite" | "unreachable" };

/** Non-consuming pre-check for the register gate's live feedback. */
export async function checkInvite(code: string): Promise<InviteCheckResult> {
  return authFetch<InviteCheckResult>("/auth/check-invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
}

export interface InviteSummary {
  code: string;
  used: boolean;
  usedAt: string | null;
}

/** The 5 codes this account can hand out, with redemption status. */
export async function fetchInvites(
  sessionToken: string
): Promise<{ ok: true; invites: InviteSummary[] } | { ok: false; reason?: string }> {
  return authFetch<{ ok: true; invites: InviteSummary[] } | { ok: false; reason?: string }>(
    `/auth/invites?sessionToken=${encodeURIComponent(sessionToken)}`
  );
}

export async function sendVerificationEmail(
  sessionToken: string
): Promise<{ ok: true } | { ok: false; reason?: string }> {
  return authFetch<{ ok: true } | { ok: false; reason?: string }>("/auth/send-verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionToken }),
  });
}

export async function fetchMe(
  sessionToken: string
): Promise<{ ok: true; user: AuthenticatedUser } | { ok: false }> {
  return authFetch<{ ok: true; user: AuthenticatedUser } | { ok: false }>(
    `/auth/me?sessionToken=${encodeURIComponent(sessionToken)}`
  );
}

/** Revokes this session server-side. Best-effort by design — if the
 *  server can't be reached, the caller should still clear local state
 *  and treat the person as signed out on this device either way. */
export async function logout(
  sessionToken: string
): Promise<{ ok: true } | { ok: false; reason?: string }> {
  return authFetch<{ ok: true } | { ok: false; reason?: string }>("/auth/logout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionToken }),
  });
}

export type DeleteAccountResult =
  | { ok: true }
  | { ok: false; reason: "invalid_session" | "unreachable" | "server_error" };

export async function deleteAccount(sessionToken: string): Promise<DeleteAccountResult> {
  return authFetch<DeleteAccountResult>("/auth/delete-account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionToken }),
  });
}
