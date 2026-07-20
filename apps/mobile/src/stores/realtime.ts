import { create } from "zustand";
import type {
  WireUser,
  WireMessage,
  WireCommunity,
  ConnectionStatus,
  IncomingCallSignal,
  RealtimeHandlers,
} from "@tabcom/shared";
import { useAuth } from "./auth";
import { useChatStore } from "./chat";
import { usePresence } from "./presence";
import { REALTIME_URL } from "@/lib/config";
import {
  initRealtime,
  disconnectRealtime,
  isRealtimeConnected,
} from "@/lib/realtime";


type RealtimeState = {
  connected: boolean;
  connect: () => void;
  disconnect: () => void;
};

export const useRealtime = create<RealtimeState>((set, get) => ({
  connected: false,

  connect: () => {
    if (isRealtimeConnected()) return;

    const auth = useAuth.getState();
    // Guests connect without a session token.
    if (!auth.user) return;

    const me: WireUser = {
      username: auth.user.username ?? "",
      name: auth.user.displayName ?? "",
      color: auth.user.avatarColor ?? "#7C6CF6",
      presence: "online",
      visibility: "public",
    };

    const handlers: RealtimeHandlers = {
      onConnectionChange: (connected) => {
        set({ connected });
        useChatStore.getState().setConnected(connected);
      },
      onRoster: (users) => useChatStore.getState().applyRoster(users),

      onDm: (from, msg) => useChatStore.getState().receiveDm(from, msg),
      onDmEdited: (from, id, text, at) => useChatStore.getState().receiveDmEdited(from, id, text, at),
      onDmDeleted: (from, id) => useChatStore.getState().receiveDmDeleted(from, id),
      onDmReaction: (from, id, emoji) => useChatStore.getState().receiveDmReaction(from, id, emoji),
      onDmReadReceipt: (from, id, at) => useChatStore.getState().receiveDmReadReceipt(from, id, at),
      onTyping: (from) => useChatStore.getState().receiveTyping(from),
      onDmError: (to, reason) => useChatStore.getState().receiveDmError(to, reason),

      onConnections: (snapshot) => useChatStore.getState().receiveConnections(snapshot),
      onConnectRequest: (from) => useChatStore.getState().receiveConnectRequest(from),
      onConnectUpdate: (username, status) => useChatStore.getState().receiveConnectUpdate(username, status),

      onCommunities: (list) => useChatStore.getState().receiveCommunities(list),
      onCommunityUpdate: (c) => useChatStore.getState().receiveCommunityUpdate(c),
      onCommunityInvite: (c, from, attempt) => useChatStore.getState().receiveCommunityInvite(c, from, attempt),
      onCommunityDeclined: () => {},
      onCommunityLeft: (id) => useChatStore.getState().receiveCommunityLeft(id),
      onCommunityDeleted: (id) => useChatStore.getState().receiveCommunityDeleted(id),
      onCommunityInviteCancelled: () => {},
      onCommunityMessage: (cid, from, msg) => useChatStore.getState().receiveCommunityMessage(cid, from, msg),
      onCommunityMessageEdited: (cid, from, id, text, at) => useChatStore.getState().receiveCommunityMessageEdited(cid, from, id, text, at),
      onCommunityMessageDeleted: (cid, from, id) => useChatStore.getState().receiveCommunityMessageDeleted(cid, from, id),
      onCommunityReaction: (cid, from, id, emoji) => useChatStore.getState().receiveCommunityReaction(cid, from, id, emoji),
      onCommunityError: () => {},

      // Calls — routed directly into the call manager
    };

    initRealtime(me, handlers, REALTIME_URL, auth.sessionToken ?? undefined);

    // Tell the server this is the mobile device so cross-device media
    // notices can be worded correctly on the other end.
    import("@/lib/realtime").then(({ announceDeviceKind }) => announceDeviceKind());

    // Register push token once the socket is live (and on every
    // reconnect, so a restarted server re-learns it immediately).
    import("@/lib/notifications").then(({ registerForPush }) => {
      registerForPush().then((token) => {
        if (token) {
          import("@/lib/realtime").then(({ sendPushToken }) => sendPushToken(token));
        }
      });
    });
    setTimeout(() => useChatStore.getState().restoreConnections(), 2000);
  },

  disconnect: () => {
    disconnectRealtime();
    set({ connected: false });
  },
}));
