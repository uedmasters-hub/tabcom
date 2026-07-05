import { create } from "zustand";

type AppScreen =
  | "welcome"
  | "signin"
  | "setup"
  | "register"
  | "profile"
  | "done"
  | "workspace";

interface AppState {
  screen: AppScreen;
  setScreen: (screen: AppScreen) => void;
}

export const useAppStore = create<AppState>((set) => ({
  screen: "welcome",

  setScreen: (screen) =>
    set({
      screen,
    }),
}));