import { create } from "zustand";

export type WorkspaceTab = "inbox" | "contacts" | "communities" | "settings";

interface WorkspaceState {
  tab: WorkspaceTab;
  setTab: (tab: WorkspaceTab) => void;
}

/** Ephemeral workspace navigation. Intentionally not persisted. */
export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  tab: "inbox",
  setTab: (tab) => set({ tab }),
}));
