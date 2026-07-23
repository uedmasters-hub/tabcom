import { create } from "zustand";
import * as SecureStore from "expo-secure-store";

const SEEN_KEY = "tabcom.onboarding-seen";

/**
 * Whether the onboarding pager has been completed.
 *
 * This is a STORE, not a one-shot read, and that matters: the routing
 * gate in app/_layout.tsx subscribes to it. When onboarding finishes it
 * writes here, the gate re-renders with the new value, and navigation
 * away sticks. Reading the flag into local state instead caused the
 * gate to keep its stale `false` and bounce the user straight back to
 * onboarding the moment they left it.
 *
 * SecureStore is used purely for consistency with the app's other
 * persistence — the flag isn't sensitive, but one storage mechanism is
 * better than adding AsyncStorage for a single boolean.
 */
type OnboardingState = {
  /** null until resolved from storage — the gate waits on this. */
  seen: boolean | null;
  hydrate: () => Promise<void>;
  markSeen: () => Promise<void>;
};

export const useOnboarding = create<OnboardingState>((set) => ({
  seen: null,

  hydrate: async () => {
    try {
      set({ seen: (await SecureStore.getItemAsync(SEEN_KEY)) === "1" });
    } catch {
      // Storage unavailable: show onboarding rather than blocking entry.
      set({ seen: false });
    }
  },

  markSeen: async () => {
    // Set state FIRST so navigation is unblocked immediately; the disk
    // write is not something the user should wait on.
    set({ seen: true });
    try {
      await SecureStore.setItemAsync(SEEN_KEY, "1");
    } catch {
      /* non-fatal: worst case it shows once more next launch */
    }
  },
}));
