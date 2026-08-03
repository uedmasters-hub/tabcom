import { create } from "zustand";

import {
  nearbyEngine,
  type NearbyEngineSnapshot,
  type NearbyIncomingRequest,
  type NearbyPeer,
  type NearbyStatus,
  type RecoveryAction,
} from "@/lib/nearby";
import { useAuth } from "@/stores/auth";
import { usePresence } from "@/stores/presence";
import { useChatStore } from "@/stores/chat";

interface NearbyState extends NearbyEngineSnapshot {
  hydrate: () => () => void;
  enable: () => Promise<{ ok: true } | { ok: false; reason: string }>;
  disable: () => Promise<void>;
  connect: (peerId: string) => Promise<void>;
  acceptIncoming: () => Promise<void>;
  declineIncoming: () => Promise<void>;
  ignoreIncoming: () => Promise<void>;
  retry: () => Promise<void>;
  openInstall: () => void;
  openSettings: () => void;
}

const empty: NearbyEngineSnapshot = {
  enabled: false,
  status: "idle",
  statusDetail: null,
  recovery: { kind: "none", label: "" },
  peers: [],
  incoming: null,
  outgoingPeerId: null,
};

function applyPairing(peer: NearbyPeer) {
  if (!peer.username) return;
  const store = useChatStore.getState();
  // Land in the same connection graph as online invite-based connects.
  store.addContactByUsername(peer.username);
  // If we already have a richer display name from the handshake, patch it.
  const contactId = `u-${peer.username}`;
  const contact = store.contacts.find((c) => c.id === contactId);
  if (contact && peer.displayName) {
    useChatStore.setState((state) => ({
      contacts: state.contacts.map((c) =>
        c.id === contactId
          ? {
              ...c,
              name: peer.displayName!,
              color: peer.avatarColor ?? c.color,
              presence: peer.presence ?? c.presence,
            }
          : c
      ),
    }));
  }
}

export const useNearbyStore = create<NearbyState>((set, get) => ({
  ...empty,

  hydrate: () => {
    nearbyEngine.setOnPaired((peer) => applyPairing(peer));
    return nearbyEngine.subscribe((snap) => set({ ...snap }));
  },

  enable: async () => {
    const { user, sessionToken, guest } = useAuth.getState();
    if (guest || !sessionToken || !user?.username) {
      return { ok: false, reason: "registered_only" };
    }
    const presence = usePresence.getState().presence;
    await nearbyEngine.enable({
      username: user.username,
      displayName: user.displayName ?? user.username,
      avatarColor: user.avatarColor ?? "#2563eb",
      presence: presence === "offline" ? "online" : presence,
    });
    return { ok: true };
  },

  disable: async () => {
    await nearbyEngine.disable();
  },

  connect: async (peerId) => {
    await nearbyEngine.connect(peerId);
  },

  acceptIncoming: async () => {
    await nearbyEngine.acceptIncoming();
  },

  declineIncoming: async () => {
    await nearbyEngine.declineIncoming();
  },

  ignoreIncoming: async () => {
    await nearbyEngine.ignoreIncoming();
  },

  retry: async () => {
    await nearbyEngine.retry();
  },

  openInstall: () => nearbyEngine.openInstallLink(),
  openSettings: () => nearbyEngine.openSystemSettings(),
}));

export type {
  NearbyStatus,
  NearbyPeer,
  NearbyIncomingRequest,
  RecoveryAction,
};
