/**
 * Mobile Socket.IO client — mirrors the extension's realtime.ts with
 * two structural differences:
 *
 *   1. No multi-context (background/popup/pip). On mobile there's ONE
 *      socket, ONE lifecycle. disconnectAllContexts() is just
 *      disconnectRealtime() — no browser.runtime.sendMessage.
 *
 *   2. AppState-aware reconnection. Android kills/freezes the JS
 *      thread on background — same family as the MV3 service-worker
 *      restart problem. On AppState "active" we check the socket and
 *      reconnect if needed, with the same identity-takeover semantics
 *      (re-emit "hello" so the server re-associates this socket).
 *
 * Desktop-only emitters (cursor, annotation, pin, area, highlight)
 * are omitted — mobile has no content-script surface to drive them.
 * Everything else (DM, community chat, connections, communities,
 * board read+comment, calls, presence) is kept verbatim.
 */

import { io, type Socket } from "socket.io-client";
import { AppState, type AppStateStatus } from "react-native";
import type {
  WireUser,
  WireMessage,
  WireCommunity,
  WirePresence,
  Visibility,
  ConnectionStatus,
  DmErrorReason,
  CallSignal,
  IncomingCallSignal,
  RealtimeHandlers,
  DeliveryEvidence,
} from "@tabcom/shared";

let socket: Socket | null = null;
let currentMe: WireUser | null = null;
let currentHandlers: RealtimeHandlers | null = null;
let currentSessionToken: string | undefined;
let appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;

// ── Connection state ────────────────────────────────────────────────

export function isRealtimeConnected(): boolean {
  return !!socket?.connected;
}

export function waitForRealtimeConnection(waitMs: number): Promise<boolean> {
  if (socket?.connected) return Promise.resolve(true);
  if (!socket) return Promise.resolve(false);

  return new Promise((resolve) => {
    const target = socket!;
    let settled = false;

    const onConnect = () => settle(true);
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      target.off("connect", onConnect);
      resolve(value);
    };

    const timer = setTimeout(() => settle(false), waitMs);
    target.on("connect", onConnect);
  });
}

// ── Init ────────────────────────────────────────────────────────────

export function initRealtime(
  me: WireUser,
  handlers: RealtimeHandlers,
  baseUrl: string,
  sessionToken?: string
): void {
  if (socket) return;

  currentMe = me;
  currentHandlers = handlers;
  currentSessionToken = sessionToken;

  socket = io(baseUrl, {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000,
    transports: ["websocket"],
    auth: sessionToken ? { sessionToken } : undefined,
  });

  // ── Lifecycle events ──
  socket.on("connect", () => {
    socket?.emit("hello", me, (ack?: { username: string }) => {
      if (ack?.username && ack.username !== me.username) {
        handlers.onUsernameAssigned?.(ack.username);
      }
    });
    handlers.onConnectionChange(true);
  });

  socket.on("disconnect", () => handlers.onConnectionChange(false));
  socket.on("connect_error", () => handlers.onConnectionChange(false));

  // ── Error events ──
  socket.on("connect_request_error", ({ to, reason }: { to: string; reason: string }) =>
    handlers.onConnectRequestError?.(to, reason)
  );
  socket.on("dm_notice", ({ to, reason }: { to: string; reason: string }) =>
    handlers.onDmNotice?.(to, reason)
  );
  socket.on("call_error", ({ to, reason }: { to: string; reason: string }) =>
    handlers.onCallError?.(to, reason)
  );

  // ── Roster & presence ──
  socket.on("roster", (users: WireUser[]) => handlers.onRoster(users));

  // ── DM events ──
  socket.on("dm", ({ from, message }: { from: WireUser; message: WireMessage }) =>
    handlers.onDm(from, message)
  );
  socket.on(
    "dm_edited",
    ({ from, messageId, text, editedAt }: { from: string; messageId: string; text: string; editedAt: number }) =>
      handlers.onDmEdited?.(from, messageId, text, editedAt)
  );
  socket.on(
    "dm_deleted",
    ({ from, messageId }: { from: string; messageId: string }) =>
      handlers.onDmDeleted?.(from, messageId)
  );
  socket.on(
    "dm_reaction",
    ({ from, messageId, emoji }: { from: string; messageId: string; emoji: string }) =>
      handlers.onDmReaction?.(from, messageId, emoji)
  );
  socket.on(
    "dm_read_receipt",
    ({ from, messageId, readAt }: { from: string; messageId: string; readAt: number }) =>
      handlers.onDmReadReceipt?.(from, messageId, readAt)
  );
  socket.on("typing", ({ from }: { from: string }) => handlers.onTyping(from));
  socket.on(
    "dm_error",
    ({ to, reason }: { to: string; reason: DmErrorReason }) =>
      handlers.onDmError(to, reason)
  );

  // ── Connections ──
  socket.on(
    "connections",
    (snapshot: Array<{ username: string; status: ConnectionStatus }>) =>
      handlers.onConnections(snapshot)
  );
  socket.on("connect_request", ({ from }: { from: WireUser }) =>
    handlers.onConnectRequest(from)
  );
  socket.on(
    "connect_update",
    ({ username, status }: { username: string; status: ConnectionStatus }) =>
      handlers.onConnectUpdate(username, status)
  );

  // ── Community events ──
  socket.on("communities", (list: WireCommunity[]) =>
    handlers.onCommunities(list)
  );
  socket.on(
    "community_update",
    ({ community }: { community: WireCommunity }) =>
      handlers.onCommunityUpdate(community)
  );
  socket.on(
    "community_invite",
    ({ community, from, attempt }: { community: WireCommunity; from: WireUser; attempt: number }) =>
      handlers.onCommunityInvite(community, from, attempt)
  );
  socket.on("community_invite_declined", (payload: any) =>
    handlers.onCommunityDeclined(payload)
  );
  socket.on("community_left", ({ communityId }: { communityId: string }) =>
    handlers.onCommunityLeft(communityId)
  );
  socket.on("community_deleted", ({ communityId }: { communityId: string }) =>
    handlers.onCommunityDeleted?.(communityId)
  );
  socket.on(
    "community_invite_cancelled",
    ({ communityId }: { communityId: string }) =>
      handlers.onCommunityInviteCancelled?.(communityId)
  );
  socket.on(
    "community_message",
    ({ communityId, from, message }: { communityId: string; from: WireUser; message: WireMessage }) =>
      handlers.onCommunityMessage(communityId, from, message)
  );
  socket.on(
    "community_message_edited",
    ({ communityId, from, messageId, text, editedAt }: {
      communityId: string; from: string; messageId: string; text: string; editedAt: number;
    }) => handlers.onCommunityMessageEdited?.(communityId, from, messageId, text, editedAt)
  );
  socket.on(
    "community_message_deleted",
    ({ communityId, from, messageId }: { communityId: string; from: string; messageId: string }) =>
      handlers.onCommunityMessageDeleted?.(communityId, from, messageId)
  );
  socket.on(
    "community_reaction",
    ({ communityId, from, messageId, emoji }: {
      communityId: string; from: string; messageId: string; emoji: string;
    }) => handlers.onCommunityReaction?.(communityId, from, messageId, emoji)
  );
  socket.on("community_error", (payload: any) =>
    handlers.onCommunityError(payload)
  );

  // ── Calls ──
  socket.on("presence_sync", ({ presence }: { presence: WirePresence }) => {
    handlers.onPresenceSync?.(presence);
  });

  socket.on(
    "self_media_notice",
    (payload: { peer: string; kind: string; from: "mobile" | "extension" }) => {
      handlers.onSelfMediaNotice?.(payload);
    }
  );

  socket.on("call_signal", (payload: IncomingCallSignal) =>
    handlers.onCallSignal?.(payload)
  );

  // ── AppState reconnection ──
  startAppStateWatcher();
}

// ── AppState watcher ────────────────────────────────────────────────

function startAppStateWatcher(): void {
  if (appStateSubscription) return;

  let lastState: AppStateStatus = AppState.currentState;

  appStateSubscription = AppState.addEventListener("change", (next) => {
    const wasBackground = lastState === "background" || lastState === "inactive";
    lastState = next;

    if (next === "active" && wasBackground && socket && currentMe) {
      // Android may have killed the socket while backgrounded.
      // Socket.IO's built-in reconnection handles most cases, but
      // after a long sleep the transport is dead — force reconnect
      // and re-announce identity (same takeover pattern as MV3
      // service worker restarts).
      if (!socket.connected) {
        socket.connect();
      }
      // Re-announce presence as online on foreground return.
      updatePresence("online");
    }

    if (next === "background" && socket?.connected) {
      // Signal the server that we're going away — peers see our
      // presence change immediately instead of waiting for a
      // socket timeout.
      updatePresence("away");
    }
  });
}

// ── Re-announce ─────────────────────────────────────────────────────

/** Register this device's Expo push token with the server. Called
 *  after every connect so tokens self-heal across server restarts. */
export function announceDeviceKind(): void {
  socket?.emit("device_kind", { kind: "mobile" });
}

export function sendPushToken(token: string): void {
  socket?.emit("register_push_token", { token });
}

export function reannounce(me: WireUser): void {
  currentMe = me;
  socket?.emit("hello", me);
}

// ── DM emitters ─────────────────────────────────────────────────────

export function sendDm(
  toUsername: string,
  message: WireMessage,
  onAck?: (evidence: DeliveryEvidence) => void
): void {
  if (!socket) { onAck?.("rejected"); return; }
  if (onAck) {
    const timeoutMs = message.dataUrl ? 45_000 : 10_000;
    socket
      .timeout(timeoutMs)
      .emit("dm", { to: toUsername, message }, (err: unknown, ack?: { delivered?: boolean }) => {
        if (err) return onAck("unknown");
        onAck(ack?.delivered === true ? "delivered" : "rejected");
      });
  } else {
    socket.emit("dm", { to: toUsername, message });
  }
}

export function editDm(toUsername: string, messageId: string, text: string): void {
  socket?.emit("dm_edit", { to: toUsername, messageId, text });
}

export function deleteDm(toUsername: string, messageId: string): void {
  socket?.emit("dm_delete", { to: toUsername, messageId });
}

export function reactToDm(toUsername: string, messageId: string, emoji: string): void {
  socket?.emit("dm_react", { to: toUsername, messageId, emoji });
}

export function markDmRead(toUsername: string, messageId: string): void {
  socket?.emit("dm_read", { to: toUsername, messageId });
}

export function sendTyping(toUsername: string): void {
  socket?.emit("typing", { to: toUsername });
}

// ── Community emitters ──────────────────────────────────────────────

export function createCommunity(name: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    if (!socket) { resolve(undefined); return; }
    let settled = false;
    const settle = (id: string | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(id);
    };
    socket.emit("community_create", { name }, (ack?: { communityId: string }) => {
      settle(ack?.communityId);
    });
    const timer = setTimeout(() => settle(undefined), 5000);
  });
}

export function setCommunityImage(
  communityId: string, mimeType: string, base64Data: string
): void {
  socket?.emit("community_set_image", { communityId, mimeType, data: base64Data });
}

export function inviteToCommunity(communityId: string, username: string): void {
  socket?.emit("community_invite", { communityId, username });
}

export function respondToCommunityInvite(
  communityId: string, action: "accept" | "decline"
): void {
  socket?.emit("community_invite_response", { communityId, action });
}

export function leaveCommunity(communityId: string): void {
  socket?.emit("community_leave", { communityId });
}

export function removeCommunityMember(communityId: string, username: string): void {
  socket?.emit("community_remove_member", { communityId, username });
}

export function cancelCommunityInvite(communityId: string, username: string): void {
  socket?.emit("community_invite_cancel", { communityId, username });
}

export function renameCommunity(communityId: string, name: string): void {
  socket?.emit("community_rename", { communityId, name });
}

export function transferCommunityAdmin(communityId: string, username: string): void {
  socket?.emit("community_transfer_admin", { communityId, username });
}

export function deleteCommunity(communityId: string): void {
  socket?.emit("community_delete", { communityId });
}

export function sendCommunityMessage(
  communityId: string,
  message: WireMessage,
  onAck?: (evidence: DeliveryEvidence) => void
): void {
  if (!socket) { onAck?.("rejected"); return; }
  if (onAck) {
    const timeoutMs = message.dataUrl ? 45_000 : 10_000;
    socket
      .timeout(timeoutMs)
      .emit("community_message", { communityId, message }, (err: unknown, ack?: { delivered?: boolean }) => {
        if (err) return onAck("unknown");
        onAck(ack?.delivered === true ? "delivered" : "rejected");
      });
    return;
  }
  socket.emit("community_message", { communityId, message });
}

export function editCommunityMessage(
  communityId: string, messageId: string, text: string
): void {
  socket?.emit("community_message_edit", { communityId, messageId, text });
}

export function deleteCommunityMessage(communityId: string, messageId: string): void {
  socket?.emit("community_message_delete", { communityId, messageId });
}

export function reactToCommunityMessage(
  communityId: string, messageId: string, emoji: string
): void {
  socket?.emit("community_message_react", { communityId, messageId, emoji });
}

// ── Board emitters (read + comment only — no pins/areas/highlights) ─

export function commentOnBoardItem(
  communityId: string, itemId: string, text: string
): void {
  socket?.emit("board_comment", { communityId, itemId, text });
}

export function voteOnBoardItem(communityId: string, itemId: string): void {
  socket?.emit("board_vote", { communityId, itemId });
}

// ── Connection emitters ─────────────────────────────────────────────

export function sendConnectRequest(toUsername: string): void {
  socket?.emit("connect_request", { to: toUsername });
}

export function respondToConnectRequest(
  toUsername: string, action: "accept" | "deny"
): void {
  socket?.emit("connect_response", { to: toUsername, action });
}

export function cancelConnectRequest(toUsername: string): void {
  socket?.emit("connect_cancel", { to: toUsername });
}

export function getMyConnections(): Promise<
  Array<{ username: string; displayName: string | null; avatarColor: string | null }>
> {
  return new Promise((resolve) => {
    if (!socket) { resolve([]); return; }
    let settled = false;
    const settle = (value: typeof result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    let result: Array<{ username: string; displayName: string | null; avatarColor: string | null }> = [];
    socket.emit("get_my_connections", {}, (ack?: { connections: typeof result }) => {
      settle(ack?.connections ?? []);
    });
    const timer = setTimeout(() => settle([]), 5000);
  });
}

export function blockUser(username: string): void {
  socket?.emit("block", { username });
}

export function unblockUser(username: string): void {
  socket?.emit("unblock", { username });
}

export function reportUser(username: string, reason?: string): void {
  socket?.emit("report", { username, reason });
}

export function removeConnection(username: string): void {
  socket?.emit("connection_remove", { username });
}

// ── Call emitters ───────────────────────────────────────────────────

export function sendCallSignal(to: string, signal: CallSignal): void {
  socket?.emit("call_signal", { to, signal });
}

// ── Presence & visibility ───────────────────────────────────────────

export function updatePresence(presence: WirePresence): void {
  socket?.emit("presence", presence);
}

export function hidePresenceFrom(username: string, hidden: boolean): void {
  socket?.emit("presence_hide", { username, hidden });
}

export function updateVisibility(visibility: Visibility): void {
  socket?.emit("visibility", visibility);
}

// ── History ─────────────────────────────────────────────────────────

export function clearMyHistory(): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolve) => {
    if (!socket) { resolve({ ok: false, reason: "not_connected" }); return; }
    let settled = false;
    const settle = (value: { ok: boolean; reason?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    socket.emit("clear_my_history", {}, (ack?: { ok: boolean; reason?: string }) => {
      settle(ack ?? { ok: false, reason: "no_response" });
    });
    const timer = setTimeout(() => settle({ ok: false, reason: "timeout" }), 10_000);
  });
}

// ── Disconnect ──────────────────────────────────────────────────────

export function disconnectRealtime(): void {
  if (appStateSubscription) {
    appStateSubscription.remove();
    appStateSubscription = null;
  }
  socket?.disconnect();
  socket = null;
  currentMe = null;
  currentHandlers = null;
  currentSessionToken = undefined;
}

/** On mobile there's only one context — no browser.runtime.sendMessage
 *  needed. This exists so call-sites can use the same name as the
 *  extension for clarity. */
export const disconnectAllContexts = disconnectRealtime;
