import { create } from "zustand";

export type AppScreen =
  | "welcome"
  | "signin"
  | "setup"
  | "register"
  | "profile"
  | "done"
  | "guest-setup"
  | "guest-expired"
  | "workspace";

interface AppState {
  screen: AppScreen;
  /**
   * Where to return to if the CURRENT screen is exited without being
   * completed (back/cancel) — set explicitly by whoever navigates in
   * with a "bring me back here" intent (e.g. the guest banner opening
   * Register from Settings). Cleared once consumed by goBack, and
   * also cleared on any navigation that doesn't specify one, so a
   * stale return target can't leak into an unrelated later flow.
   */
  returnTo: AppScreen | null;

  setScreen: (screen: AppScreen, options?: { returnTo?: AppScreen }) => void;
  /** Navigates to whatever returnTo was set to, or to `fallback` if
   *  none was set — the correct behavior for a flow's own cancel/back
   *  action, so cancelling a flow entered from Settings returns to
   *  Settings, while the same flow entered from Welcome falls back to
   *  Welcome instead of losing the person's place either way. */
  goBack: (fallback: AppScreen) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  screen: "welcome",
  returnTo: null,

  setScreen: (screen, options) =>
    set({
      screen,
      returnTo: options?.returnTo ?? null,
    }),

  goBack: (fallback) => {
    const target = get().returnTo ?? fallback;
    set({ screen: target, returnTo: null });
  },
}));
