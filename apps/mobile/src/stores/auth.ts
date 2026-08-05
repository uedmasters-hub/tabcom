import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import type { AuthenticatedUser } from "@tabcom/shared";
import { auth } from "@/lib/auth-client";
import {
  GUEST_KEY,
  GUEST_SESSION_MS,
  endGuestSessionCompletely,
  isGuestExpired,
  wipeGuestLocalState,
} from "@/lib/guest-session";

const TOKEN_KEY = "tabcom.session-token";
/**
 * Last known account profile. Lets a registered user open the app and
 * see all their local history while the backend is unreachable, instead
 * of being bounced to the welcome screen.
 */
const USER_KEY = "tabcom.session-user";

export { GUEST_SESSION_MS };

export interface GuestSession {
  username: string;
  displayName: string;
  avatarColor: string;
  startedAt: number;
}

type AuthState = {
  hydrated: boolean;
  sessionToken: string | null;
  user: AuthenticatedUser | null;
  /** Set only for guests. Never has a server session token. */
  guest: GuestSession | null;
  hydrate: () => Promise<void>;
  signIn: (sessionToken: string, user: AuthenticatedUser) => Promise<void>;
  startGuestSession: (displayName: string, username: string, avatarColor: string) => Promise<void>;
  /** Ends a live guest session and wipes all local data. */
  endGuestSession: () => Promise<void>;
  signOut: () => Promise<void>;
};

/** Both real accounts and guests present the same shape to the rest of
 *  the app, so nothing downstream needs to branch on session type. */
function guestAsUser(g: GuestSession): AuthenticatedUser {
  return {
    email: "",
    username: g.username,
    displayName: g.displayName,
    avatarColor: g.avatarColor,
    verified: false,
  } as AuthenticatedUser;
}

export const useAuth = create<AuthState>((set, get) => ({
  hydrated: false,
  sessionToken: null,
  user: null,
  guest: null,

  hydrate: async () => {
    try {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      if (token) {
        const cached = await SecureStore.getItemAsync(USER_KEY);

        // Offline-first cold start: paint from the cached profile
        // immediately so the splash isn't held hostage by fetchMe
        // (up to 10s when the backend is slow/unreachable).
        if (cached) {
          const cachedUser = JSON.parse(cached) as AuthenticatedUser;
          // Drop ghost profiles left over from the old magic-link loophole.
          if (!cachedUser?.id || !cachedUser.username?.trim() || !cachedUser.displayName?.trim()) {
            await SecureStore.deleteItemAsync(TOKEN_KEY);
            await SecureStore.deleteItemAsync(USER_KEY);
          } else {
            set({
              hydrated: true,
              sessionToken: token,
              user: cachedUser,
              guest: null,
            });
            void auth.fetchMe(token).then(async (me) => {
              if (me.ok) {
                await SecureStore.setItemAsync(USER_KEY, JSON.stringify(me.user));
                // Only refresh if this token is still the active session.
                if (get().sessionToken === token) {
                  set({ user: me.user });
                }
                return;
              }
              if ((me as { reason?: string }).reason === "unreachable") return;
              // Server rejected the token — genuinely signed out.
              if (get().sessionToken === token) {
                await SecureStore.deleteItemAsync(TOKEN_KEY);
                await SecureStore.deleteItemAsync(USER_KEY);
                set({ sessionToken: null, user: null, guest: null });
              }
            });
            return;
          }
        }

        const me = await auth.fetchMe(token);
        if (me.ok) {
          await SecureStore.setItemAsync(USER_KEY, JSON.stringify(me.user));
          set({ hydrated: true, sessionToken: token, user: me.user, guest: null });
          return;
        }

        // Unreachable and no cache — stay signed out but keep the token
        // so a later online launch can recover it.
        if ((me as { reason?: string }).reason === "unreachable") {
          set({ hydrated: true, sessionToken: null, user: null, guest: null });
          return;
        }

        // The server actively rejected the token — genuinely signed out.
        await SecureStore.deleteItemAsync(TOKEN_KEY);
        await SecureStore.deleteItemAsync(USER_KEY);
      }

      // No account session — check for a live guest session.
      const raw = await SecureStore.getItemAsync(GUEST_KEY);
      if (raw) {
        const g: GuestSession = JSON.parse(raw);
        if (!isGuestExpired(g.startedAt)) {
          set({ hydrated: true, sessionToken: null, user: guestAsUser(g), guest: g });
          return;
        }
        // Expired while the app was closed — full wipe so the next
        // guest cannot inherit this one's conversations/notes/contacts.
        await endGuestSessionCompletely(g.username);
      }

      set({ hydrated: true, sessionToken: null, user: null, guest: null });
    } catch {
      set({ hydrated: true, sessionToken: null, user: null, guest: null });
    }
  },

  signIn: async (sessionToken, user) => {
    // Never persist a ghost / incomplete identity from a stale client.
    if (!user?.id || !user.username?.trim() || !user.displayName?.trim()) {
      if (__DEV__) console.warn("[tabcom:auth] refusing to sign in incomplete user", user);
      return;
    }
    // Leaving a guest session for a real account: wipe guest data so
    // nothing from the disposable identity contaminates the account.
    const g = get().guest;
    if (g) {
      await endGuestSessionCompletely(g.username);
    }
    await SecureStore.setItemAsync(TOKEN_KEY, sessionToken);
    // Cache the profile so a later offline cold start can restore the
    // session instead of dumping the user back to the welcome screen.
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
    set({ sessionToken, user, guest: null });

    if (g) {
      try {
        const { useRealtime } = require("@/stores/realtime") as typeof import("@/stores/realtime");
        useRealtime.getState().connect();
      } catch { /* optional */ }
    }
  },

  startGuestSession: async (displayName, username, avatarColor) => {
    // Never start a new guest until the previous one's cleanup has fully
    // finished. If it was interrupted, this resumes it to completion
    // (idempotent, no UI — the animated run happens on the expired screen).
    try {
      const { isGuestCleanupPending, runGuestCleanup } = require("@/lib/guest-cleanup");
      if (await isGuestCleanupPending()) {
        await runGuestCleanup(undefined, { stepDelayMs: 0 });
      }
    } catch { /* fall through to the eager wipe below */ }

    // Always start from a clean slate — even if a previous guest left
    // residual SQLite rows (e.g. process killed before wipe finished).
    const prior = get().guest;
    if (prior?.username) {
      void auth.endGuestSession(prior.username).catch(() => {});
    }
    try {
      await SecureStore.deleteItemAsync(GUEST_KEY);
    } catch { /* none */ }
    await wipeGuestLocalState();

    const g: GuestSession = {
      username,
      displayName,
      avatarColor,
      startedAt: Date.now(),
    };
    await SecureStore.setItemAsync(GUEST_KEY, JSON.stringify(g));
    // Fire-and-forget: server tracking must never block getting started.
    void auth.registerGuestSession(username);
    set({ sessionToken: null, user: guestAsUser(g), guest: g, hydrated: true });

    // Force a fresh socket identity for this guest (old peer/user maps
    // must not stick to the previous username).
    try {
      const { useRealtime } = require("@/stores/realtime") as typeof import("@/stores/realtime");
      useRealtime.getState().disconnect();
      useRealtime.getState().connect();
    } catch { /* optional */ }
  },

  endGuestSession: async () => {
    const guest = get().guest;
    try {
      const { useNearbyStore } = require("@/stores/nearby") as typeof import("@/stores/nearby");
      await useNearbyStore.getState().disable();
    } catch {
      /* */
    }
    await endGuestSessionCompletely(guest?.username ?? null);
    set({ sessionToken: null, user: null, guest: null });
  },

  signOut: async () => {
    const { sessionToken, guest } = get();
    // Tear down Nearby radios — discovery must never outlive the session.
    try {
      const { useNearbyStore } = require("@/stores/nearby") as typeof import("@/stores/nearby");
      await useNearbyStore.getState().disable();
    } catch {
      /* store may be unavailable in edge cases */
    }
    if (guest) {
      await get().endGuestSession();
      return;
    }
    if (sessionToken) void auth.logout(sessionToken);
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
    // Always wipe user-scoped SQLite + avatar/media caches on sign-out
    // so another account on this device cannot see prior profile photos
    // or messages. Offline cache is rebuilt after the next login.
    try {
      const { useChatStore } = require("@/stores/chat") as typeof import("@/stores/chat");
      useChatStore.getState().resetChat();
    } catch { /* */ }
    try {
      const { clearAllLocalData } = require("@/lib/persistence") as typeof import("@/lib/persistence");
      await clearAllLocalData();
    } catch { /* */ }
    set({ sessionToken: null, user: null, guest: null });
  },
}));
