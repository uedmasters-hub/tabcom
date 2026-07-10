import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { extensionStorage } from "../lib/extension-storage";

export type ProfileVisibility = "public" | "private";

export interface AvatarColor {
  id: string;
  value: string;
}

export const AVATAR_COLORS: AvatarColor[] = [
  { id: "blue", value: "#2563EB" },
  { id: "indigo", value: "#4F46E5" },
  { id: "violet", value: "#7C3AED" },
  { id: "rose", value: "#E11D48" },
  { id: "orange", value: "#EA580C" },
  { id: "amber", value: "#D97706" },
  { id: "emerald", value: "#059669" },
  { id: "slate", value: "#334155" },
];

interface ProfileState {
  /** true once persisted state has been read back from browser.storage */
  hasHydrated: boolean;

  isComplete: boolean;
  /** Set once a magic link is verified — the bearer credential that
   *  authenticates every socket connection from here on. Undefined
   *  means "not signed in", regardless of what isComplete says. */
  sessionToken?: string;
  email?: string;
  verified: boolean;
  visibility: ProfileVisibility;
  displayName: string;
  username: string;
  avatarColor: string;
  /** Optional profile photo (small data URL). */
  photo?: string;
  /** iMessage-style message animations. */
  animations: boolean;
  /** My presence status. */
  presence: "online" | "away" | "busy" | "offline";
  /** Floating picture-in-picture chat. */
  pipEnabled: boolean;

  /** True for the duration of a temporary guest session — never true
   *  at the same time as having a sessionToken (see setSession, which
   *  always clears these: a real session means you're no longer a
   *  guest by definition). */
  isGuest: boolean;
  /** Epoch ms when this guest session should be force-ended. Undefined
   *  when isGuest is false. */
  guestExpiresAt?: number;

  setHasHydrated: (value: boolean) => void;
  setVisibility: (visibility: ProfileVisibility) => void;
  setIdentity: (identity: { displayName: string; username: string }) => void;
  setAvatarColor: (color: string) => void;
  setPhoto: (photo?: string) => void;
  setAnimations: (animations: boolean) => void;
  setPresence: (presence: "online" | "away" | "busy" | "offline") => void;
  setPipEnabled: (pipEnabled: boolean) => void;
  setSession: (sessionToken: string, email: string) => void;
  setVerified: (verified: boolean) => void;
  completeProfile: () => void;
  resetProfile: () => void;

  /** Starts a fresh 30-minute guest session with the given display
   *  name + auto-generated username. */
  startGuestSession: (identity: { displayName: string; username: string }) => void;
  /** True once guestExpiresAt has passed — pure read, no side effect. */
  isGuestSessionExpired: () => boolean;
  /** Ends the guest session (expiry or manual) without touching any
   *  local chat/board data — that storage is device-scoped, not
   *  identity-scoped, so it isn't "guest data" to begin with. */
  endGuestSession: () => void;
}

const GUEST_SESSION_DURATION_MS = 30 * 60 * 1000;

const initialProfile = {
  isComplete: false,
  sessionToken: undefined as string | undefined,
  email: undefined as string | undefined,
  verified: false,
  visibility: "public" as ProfileVisibility,
  displayName: "",
  username: "",
  avatarColor: AVATAR_COLORS[0]!.value,
  photo: undefined as string | undefined,
  animations: true,
  presence: "online" as const,
  pipEnabled: true,
  isGuest: false,
  guestExpiresAt: undefined as number | undefined,
};

export const useProfileStore = create<ProfileState>()(
  persist(
    (set, get) => ({
      hasHydrated: false,
      ...initialProfile,

      setHasHydrated: (value) => set({ hasHydrated: value }),

      setVisibility: (visibility) => set({ visibility }),

      setIdentity: ({ displayName, username }) =>
        set({ displayName, username }),

      setAvatarColor: (avatarColor) => set({ avatarColor }),

      setPhoto: (photo) => set({ photo }),

      setAnimations: (animations) => set({ animations }),

      setPresence: (presence) => set({ presence }),

      setPipEnabled: (pipEnabled) => set({ pipEnabled }),

      // A real session token means this is, by definition, no longer
      // a guest — clearing guest state here means every future caller
      // never has to remember to do it separately (e.g. converting a
      // guest to a permanent account via RegisterScreen).
      setSession: (sessionToken, email) =>
        set({ sessionToken, email, isGuest: false, guestExpiresAt: undefined }),

      setVerified: (verified) => set({ verified }),

      completeProfile: () => set({ isComplete: true }),

      resetProfile: () => set({ ...initialProfile }),

      startGuestSession: ({ displayName, username }) =>
        set({
          displayName,
          username,
          isGuest: true,
          guestExpiresAt: Date.now() + GUEST_SESSION_DURATION_MS,
          sessionToken: undefined,
          email: undefined,
          verified: false,
        }),

      isGuestSessionExpired: () => {
        const { isGuest, guestExpiresAt } = get();
        return !!isGuest && !!guestExpiresAt && Date.now() >= guestExpiresAt;
      },

      endGuestSession: () =>
        set({
          isGuest: false,
          guestExpiresAt: undefined,
          isComplete: false,
          displayName: "",
          username: "",
        }),
    }),
    {
      name: "tabcom:profile",
      storage: createJSONStorage(() => extensionStorage),
      partialize: (state) => ({
        isComplete: state.isComplete,
        sessionToken: state.sessionToken,
        email: state.email,
        verified: state.verified,
        visibility: state.visibility,
        displayName: state.displayName,
        username: state.username,
        avatarColor: state.avatarColor,
        photo: state.photo,
        animations: state.animations,
        presence: state.presence,
        pipEnabled: state.pipEnabled,
        isGuest: state.isGuest,
        guestExpiresAt: state.guestExpiresAt,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
