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
import { router } from "expo-router";
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
        void import("@/lib/call-manager").then((cm) => {
          if (connected) cm.onNetworkRestored();
          else cm.onNetworkLost();
        });
        if (connected) {
          void import("@/stores/call-history").then(({ useCallHistory }) => {
            useCallHistory.getState().notifyUnseenMissed();
          });
        }
      },
      onRoster: (users) => useChatStore.getState().applyRoster(users),

      onDm: (from, msg) => useChatStore.getState().receiveDm(from, msg),
      onPrivacyUpdate: (from, payload) =>
        useChatStore.getState().receivePrivacyUpdate(from, payload),
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

      // ── Calls ──
      // Every incoming offer/answer/ice/reject/end goes straight into
      // the call manager, which owns the RTCPeerConnection lifecycle.
      // Without this the callee never learns a call exists and the
      // caller rings forever.
      onCallSignal: (payload) => {
        import("@/lib/call-manager").then(({ handleCallSignal }) => {
          handleCallSignal(payload);

          // An incoming OFFER must also bring the call screen up —
          // the manager only tracks state, it can't navigate.
          if (payload.signal.kind === "offer") {
            const name = encodeURIComponent(payload.from.name || payload.from.username);
            const color = encodeURIComponent(payload.from.color || "#2563eb");
            const video = payload.signal.video ? "true" : "false";
            router.push(
              `/call/${payload.from.username}?peerName=${name}&peerColor=${color}&role=callee&video=${video}` as never
            );
          }
        });
      },
      onCallError: (_to, reason) => {
        import("@/lib/call-manager").then(({ handleCallError }) => {
          handleCallError(reason);
        });
      },
    };

    initRealtime(me, handlers, REALTIME_URL, auth.sessionToken ?? undefined);

    // Push token registration and device_kind announcement are now
    // handled inside realtime.ts's connect handler (inside the hello
    // ack callback), so they fire at the right time on every connect
    // and reconnect. No need to duplicate here.
    setTimeout(() => useChatStore.getState().restoreConnections(), 2000);
  },

  disconnect: () => {
    disconnectRealtime();
    set({ connected: false });
  },
}));
