import { create } from "zustand";

export type AppScreen =
  | "welcome"
  | "signin"
  | "visibility"
  | "identity"
  | "avatar"
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