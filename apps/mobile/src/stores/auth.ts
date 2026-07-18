import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import type { AuthenticatedUser } from "@tabcom/shared";
import { auth } from "@/lib/auth-client";

const TOKEN_KEY = "tabcom.session-token";

type AuthState = {
  hydrated: boolean;
  sessionToken: string | null;
  user: AuthenticatedUser | null;
  hydrate: () => Promise<void>;
  signIn: (sessionToken: string, user: AuthenticatedUser) => Promise<void>;
  signOut: () => Promise<void>;
};

export const useAuth = create<AuthState>((set, get) => ({
  hydrated: false,
  sessionToken: null,
  user: null,

  hydrate: async () => {
    try {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      if (!token) {
        set({ hydrated: true, sessionToken: null, user: null });
        return;
      }
      const me = await auth.fetchMe(token);
      if (me.ok) {
        set({ hydrated: true, sessionToken: token, user: me.user });
      } else {
        await SecureStore.deleteItemAsync(TOKEN_KEY);
        set({ hydrated: true, sessionToken: null, user: null });
      }
    } catch {
      set({ hydrated: true, sessionToken: null, user: null });
    }
  },

  signIn: async (sessionToken, user) => {
    await SecureStore.setItemAsync(TOKEN_KEY, sessionToken);
    set({ sessionToken, user });
  },

  signOut: async () => {
    const token = get().sessionToken;
    if (token) void auth.logout(token);
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    set({ sessionToken: null, user: null });
  },
}));
