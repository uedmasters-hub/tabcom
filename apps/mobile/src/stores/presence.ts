import { create } from "zustand";
import type { WirePresence } from "@tabcom/shared";
import { updatePresence } from "@/lib/realtime";

interface PresenceState {
  presence: WirePresence;
  /** Applied when another device of this account changes presence. */
  setPresence: (p: WirePresence) => void;
  /** Applied when THIS device changes presence — pushes to the server,
   *  which fans the change out to the account's other devices. */
  changePresence: (p: WirePresence) => void;
}

export const usePresence = create<PresenceState>((set) => ({
  presence: "online",
  setPresence: (presence) => set({ presence }),
  changePresence: (presence) => {
    set({ presence });
    updatePresence(presence);
  },
}));
