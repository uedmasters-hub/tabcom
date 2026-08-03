import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { clearAllLocalData } from "@/lib/persistence";
import type { AuthenticatedUser } from "@tabcom/shared";
import { auth } from "@/lib/auth-client";

const TOKEN_KEY = "tabcom.session-token";
const GUEST_KEY = "tabcom.guest-session";
/**
 * Last known account profile. Lets a registered user open the app and
 * see all their local history while the backend is unreachable, instead
 * of being bounced to the welcome screen.
 */
const USER_KEY = "tabcom.session-user";

/** Guest sessions last 30 minutes, matching the extension. */
export const GUEST_SESSION_MS = 30 * 60 * 1000;

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
        const me = await auth.fetchMe(token);
        if (me.ok) {
          // Cache the profile so the next cold start works offline.
          await SecureStore.setItemAsync(USER_KEY, JSON.stringify(me.user));
          set({ hydrated: true, sessionToken: token, user: me.user, guest: null });
          return;
        }

        // OFFLINE-FIRST: `unreachable` means the network/backend failed,
        // NOT that the session is invalid. Signing the user out here
        // would throw away a perfectly good session and make all their
        // local history look erased — which is exactly what happens on
        // the first launch after a reinstall, before the socket is up.
        // Keep the token and hydrate from the cached profile; the next
        // successful fetchMe reconciles it.
        if ((me as { reason?: string }).reason === "unreachable") {
          const cached = await SecureStore.getItemAsync(USER_KEY);
          if (cached) {
            set({
              hydrated: true,
              sessionToken: token,
              user: JSON.parse(cached),
              guest: null,
            });
            return;
          }
          // No cached profile (first ever launch) — stay signed out but
          // KEEP the token so a later launch online can recover it.
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
        if (Date.now() - g.startedAt < GUEST_SESSION_MS) {
          set({ hydrated: true, sessionToken: null, user: guestAsUser(g), guest: g });
          return;
        }
        // Expired — clear locally and tell the server, or device
        // recognition can resurrect it on next launch.
        await SecureStore.deleteItemAsync(GUEST_KEY);
        void auth.endGuestSession(g.username);
      }

      set({ hydrated: true, sessionToken: null, user: null, guest: null });
    } catch {
      set({ hydrated: true, sessionToken: null, user: null, guest: null });
    }
  },

  signIn: async (sessionToken, user) => {
    // Signing into a real account supersedes any guest session.
    const g = get().guest;
    if (g) {
      await SecureStore.deleteItemAsync(GUEST_KEY);
      void auth.endGuestSession(g.username);
    }
    await SecureStore.setItemAsync(TOKEN_KEY, sessionToken);
    // Cache the profile so a later offline cold start can restore the
    // session instead of dumping the user back to the welcome screen.
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
    set({ sessionToken, user, guest: null });
  },

  startGuestSession: async (displayName, username, avatarColor) => {
    const g: GuestSession = {
      username,
      displayName,
      avatarColor,
      startedAt: Date.now(),
    };
    await SecureStore.setItemAsync(GUEST_KEY, JSON.stringify(g));
    // Fire-and-forget: server tracking must never block getting started.
    void auth.registerGuestSession(username);
    set({ sessionToken: null, user: guestAsUser(g), guest: g });
  },

  signOut: async () => {
    const { sessionToken, guest } = get();
    if (sessionToken) void auth.logout(sessionToken);
    if (guest) {
      void auth.endGuestSession(guest.username);
      await SecureStore.deleteItemAsync(GUEST_KEY);
      // Guests: wipe ALL local data — nothing should survive session end.
      // The note wall is in-memory as well as on disk, so clear both.
      await import("@/stores/notes")
        .then(({ useNotesStore }) => useNotesStore.getState().clear())
        .catch(() => { /* nothing to clear */ });
      // Registered users' data about this guest stays in THEIR local
      // storage (messages, media, etc.) until they manually clear it.
      await clearAllLocalData();
    }
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
    // Registered users: keep local storage (messages, media, communities).
    // They can manually clear via Settings → Storage → Clear cache.
    // Only wipe for guests (handled above).
    set({ sessionToken: null, user: null, guest: null });
  },
}));
