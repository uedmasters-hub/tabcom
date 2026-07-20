/**
 * Platform-agnostic HTTP client for the magic-link auth flow.
 *
 * Ported from apps/extension/src/lib/auth-client.ts with the two
 * platform couplings inverted into an injected environment:
 *   - baseUrl        (extension: WXT_REALTIME_URL / mobile: EXPO_PUBLIC_REALTIME_URL)
 *   - getDeviceId    (extension: browser.storage.local / mobile: expo-secure-store)
 *   - getDeviceInfo  (extension: navigator UA / mobile: expo-constants model name)
 */

export interface AuthEnv {
  baseUrl: string;
  getDeviceId: () => Promise<string>;
  getDeviceInfo: () => string;
}

const TIMEOUT_MS = 10_000;

export interface AuthenticatedUser {
  id: string;
  email: string;
  username: string | null;
  displayName: string | null;
  avatarColor: string | null;
  verified: boolean;
}

export interface RequestLinkResult {
  ok: boolean;
  pollId?: string;
  reason?: "rate_limited" | "invalid_email" | "unreachable";
}

export type PollResult =
  | { status: "waiting" }
  | { status: "verified"; sessionToken: string; user: AuthenticatedUser }
  | { status: "expired" }
  | { status: "unreachable" };

export type ClaimUsernameResult =
  | { ok: true }
  | { ok: false; reason: "taken" | "invalid_username" | "invalid_session" | "unreachable" };

export type UsernameCheckResult =
  | { ok: true; available: true }
  | { ok: true; available: false; suggestions: string[] }
  | { ok: false; reason: "invalid_format" | "unreachable" };

export type RegisterResult =
  | { ok: true; sessionToken: string; user: AuthenticatedUser }
  | {
      ok: false;
      reason:
        | "invalid_email"
        | "invalid_username"
        | "username_taken"
        | "invalid_invite"
        | "unreachable";
    };

export type InviteCheckResult =
  | { ok: true }
  | { ok: false; reason: "invalid_invite" | "unreachable" };

export interface InviteSummary {
  code: string;
  used: boolean;
  usedAt: string | null;
}

export type DeleteAccountResult =
  | { ok: true }
  | { ok: false; reason: "invalid_session" | "unreachable" | "server_error" };

export type DeviceRecognition =
  | {
      ok: true;
      session: {
        sessionType: "registered" | "guest";
        expiresAt: string;
        guestUsername?: string;
      } | null;
    }
  | { ok: false; reason: "unreachable" | "server_error" };

export function createAuthClient(env: AuthEnv) {
  async function authFetch<T>(
    path: string,
    init?: RequestInit
  ): Promise<T | { ok: false; reason: "unreachable" }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${env.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
      return (await res.json()) as T;
    } catch {
      return { ok: false, reason: "unreachable" };
    } finally {
      clearTimeout(timer);
    }
  }

  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return {
    requestMagicLink(email: string): Promise<RequestLinkResult> {
      return authFetch<RequestLinkResult>("/auth/request-link", json({ email }));
    },

    async pollLoginRequest(pollId: string): Promise<PollResult> {
      const deviceId = await env.getDeviceId();
      const params = new URLSearchParams({
        pollId,
        deviceId,
        browserInfo: env.getDeviceInfo(),
      });
      const result = await authFetch<PollResult>(`/auth/poll?${params.toString()}`);
      if ("reason" in result && result.reason === "unreachable") {
        return { status: "unreachable" };
      }
      return result as PollResult;
    },

    async waitForLogin(
      pollId: string,
      options: { intervalMs?: number; signal?: AbortSignal } = {}
    ): Promise<{ sessionToken: string; user: AuthenticatedUser } | null> {
      const intervalMs = options.intervalMs ?? 2000;
      let consecutiveUnreachable = 0;
      while (!options.signal?.aborted) {
        const result = await this.pollLoginRequest(pollId);
        if (result.status === "verified") {
          return { sessionToken: result.sessionToken, user: result.user };
        }
        if (result.status === "expired") return null;
        if (result.status === "unreachable") {
          consecutiveUnreachable += 1;
          if (consecutiveUnreachable >= 15) return null;
        } else {
          consecutiveUnreachable = 0;
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
      return null;
    },

    claimUsername(
      sessionToken: string,
      username: string,
      displayName: string,
      avatarColor: string
    ): Promise<ClaimUsernameResult> {
      return authFetch<ClaimUsernameResult>(
        "/auth/claim-username",
        json({ sessionToken, username, displayName, avatarColor })
      );
    },

    checkUsernameAvailable(username: string): Promise<UsernameCheckResult> {
      return authFetch<UsernameCheckResult>(
        `/auth/check-username?username=${encodeURIComponent(username)}`
      );
    },

    /** Best-effort server-side tracking of a guest session. Never
     *  blocks the guest flow — the guest experience is fully local, so
     *  an unreachable server must not stop someone getting started. */
    async registerGuestSession(guestUsername: string): Promise<void> {
      const deviceId = await env.getDeviceId();
      try {
        await authFetch<unknown>("/session/register-guest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            guestUsername,
            deviceId,
            browserInfo: env.getDeviceInfo(),
          }),
        });
      } catch {
        /* offline — local session still valid */
      }
    },

    /** Ends this device's guest session server-side. Must be called on
     *  every guest-ending path or stale state survives on the server. */
    async endGuestSession(guestUsername: string): Promise<void> {
      const deviceId = await env.getDeviceId();
      try {
        await authFetch<unknown>("/session/end-guest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ guestUsername, deviceId }),
        });
      } catch {
        /* best effort */
      }
    },

    async registerAccount(
      email: string,
      username: string,
      displayName: string,
      avatarColor: string,
      inviteCode: string
    ): Promise<RegisterResult> {
      const deviceId = await env.getDeviceId();
      return authFetch<RegisterResult>(
        "/auth/register",
        json({
          email,
          username,
          displayName,
          avatarColor,
          inviteCode,
          deviceId,
          browserInfo: env.getDeviceInfo(),
        })
      );
    },

    checkInvite(code: string): Promise<InviteCheckResult> {
      return authFetch<InviteCheckResult>("/auth/check-invite", json({ code }));
    },

    fetchInvites(
      sessionToken: string
    ): Promise<{ ok: true; invites: InviteSummary[] } | { ok: false; reason?: string }> {
      return authFetch(`/auth/invites?sessionToken=${encodeURIComponent(sessionToken)}`);
    },

    sendVerificationEmail(
      sessionToken: string
    ): Promise<{ ok: true } | { ok: false; reason?: string }> {
      return authFetch("/auth/send-verification", json({ sessionToken }));
    },

    fetchMe(
      sessionToken: string
    ): Promise<{ ok: true; user: AuthenticatedUser } | { ok: false }> {
      return authFetch(`/auth/me?sessionToken=${encodeURIComponent(sessionToken)}`);
    },

    logout(sessionToken: string): Promise<{ ok: true } | { ok: false; reason?: string }> {
      return authFetch("/auth/logout", json({ sessionToken }));
    },

    deleteAccount(sessionToken: string): Promise<DeleteAccountResult> {
      return authFetch<DeleteAccountResult>("/auth/delete-account", json({ sessionToken }));
    },

    async recognizeDevice(): Promise<DeviceRecognition> {
      const deviceId = await env.getDeviceId();
      return authFetch<DeviceRecognition>(
        `/session/recognize?deviceId=${encodeURIComponent(deviceId)}`
      );
    },
  };
}

export type AuthClient = ReturnType<typeof createAuthClient>;
