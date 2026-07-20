import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import type { AuthenticatedUser } from "@tabcom/shared";
import { auth } from "@/lib/auth-client";

const TOKEN_KEY = "tabcom.session-token";
const GUEST_KEY = "tabcom.guest-session";

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
          set({ hydrated: true, sessionToken: token, user: me.user, guest: null });
          return;
        }
        await SecureStore.deleteItemAsync(TOKEN_KEY);
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
    }
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    set({ sessionToken: null, user: null, guest: null });
  },
}));
