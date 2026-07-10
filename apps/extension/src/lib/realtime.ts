import { io, type Socket } from "socket.io-client";

/**
 * Realtime transport (Socket.IO).
 *
 * Dependency direction: stores/components import this module; this module
 * never imports stores. Incoming events are delivered through handlers
 * wired up by WorkspaceScreen.
 *
 * Privacy note: visibility is enforced server-side. Client-side gating
 * here and in the UI is UX only — the server is the authority.
 */

export const REALTIME_URL =
  (import.meta.env.WXT_REALTIME_URL as string | undefined) ??
  "WXT_REALTIME_URL=http://rameshs-macbook-pro.local:3001";

export type Visibility = "public" | "private";

export type WirePresence = "online" | "away" | "busy" | "offline";

export interface WireUser {
  username: string;
  name: string;
  color: string;
  visibility: Visibility;
  presence?: WirePresence;
  photo?: string;
  verified?: boolean;
}

export interface WireBoardComment {
  id: string;
  author: string;
  text: string;
  sentAt: number;
}

export interface WireBoardPin {
  id: string;
  author: string;
  text: string;
  sentAt: number;
  xPercent: number;
  yPercent: number;
  pageX?: number;
  pageY?: number;
  anchorSelector?: string;
  elXPercent?: number;
  elYPercent?: number;
  comments: WireBoardComment[];
}

export interface WireBoardHighlight {
  id: string;
  author: string;
  sentAt: number;
  quote: string;
  prefix: string;
  suffix: string;
  comments: WireBoardComment[];
}

export interface WireBoardArea {
  id: string;
  author: string;
  sentAt: number;
  text: string;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  pageX?: number;
  pageY?: number;
  pageWidth?: number;
  pageHeight?: number;
  anchorSelector?: string;
  elXPercent?: number;
  elYPercent?: number;
  comments: WireBoardComment[];
}

export interface WireBoardItem {
  id: string;
  url: string;
  canonicalKey: string;
  title: string;
  image?: string;
  siteName?: string;
  addedBy: string;
  addedAt: number;
  comments: WireBoardComment[];
  pins: WireBoardPin[];
  highlights: WireBoardHighlight[];
  areas: WireBoardArea[];
  votes: string[];
  decided: boolean;
}

export interface WireCommunity {
  id: string;
  name: string;
  admin: string;
  members: Array<{ username: string; name: string; color: string }>;
  pendingForMe: boolean;
  pendingInvites: Array<{ username: string; attemptsLeft: number }>;
  board: WireBoardItem[];
  boardDecidedId?: string;
}

export type CommunityErrorReason =
  | "not_connected"
  | "invite_limit"
  | "already_pending";

export interface WireMessage {
  id: string;
  kind: "text" | "link";
  text: string;
  url?: string;
  sentAt: number;
  replyToId?: string;
}

export type DmErrorReason =
  | "sender_private"
  | "recipient_unavailable"
  | "not_connected";

export type ConnectionStatus =
  | "none"
  | "pending_out"
  | "pending_in"
  | "accepted"
  | "declined"
  | "blocked";

export interface RealtimeHandlers {
  onConnectionChange: (live: boolean) => void;
  onRoster: (users: WireUser[]) => void;
  onDm: (from: WireUser, message: WireMessage) => void;
  onDmEdited?: (from: string, messageId: string, text: string, editedAt: number) => void;
  onDmDeleted?: (from: string, messageId: string) => void;
  onDmReaction?: (from: string, messageId: string, emoji: string) => void;
  onDmReadReceipt?: (from: string, messageId: string, readAt: number) => void;
  onCommunityMessageEdited?: (
    communityId: string,
    from: string,
    messageId: string,
    text: string,
    editedAt: number
  ) => void;
  onCommunityMessageDeleted?: (
    communityId: string,
    from: string,
    messageId: string
  ) => void;
  onCommunityReaction?: (
    communityId: string,
    from: string,
    messageId: string,
    emoji: string
  ) => void;
  onTyping: (fromUsername: string) => void;
  onDmError: (toUsername: string, reason: DmErrorReason) => void;
  onConnections: (
    snapshot: Array<{ username: string; status: ConnectionStatus }>
  ) => void;
  onConnectRequest: (from: WireUser) => void;
  onConnectUpdate: (username: string, status: ConnectionStatus) => void;
  onConnectRequestError?: (username: string, reason: string) => void;
  onCommunities: (communities: WireCommunity[]) => void;
  onCommunityUpdate: (community: WireCommunity) => void;
  onCommunityInvite: (
    community: WireCommunity,
    from: WireUser,
    attempt: number
  ) => void;
  onCommunityDeclined: (payload: {
    communityId: string;
    communityName: string;
    username: string;
    attemptsLeft: number;
    barred: boolean;
  }) => void;
  onCommunityLeft: (communityId: string) => void;
  onCommunityDeleted?: (communityId: string) => void;
  onCommunityInviteCancelled?: (communityId: string) => void;
  onCommunityMessage: (
    communityId: string,
    from: WireUser,
    message: WireMessage
  ) => void;
  onCommunityError: (payload: {
    communityId: string;
    username: string;
    reason: CommunityErrorReason;
  }) => void;
  onCursorPeer?: (peer: CursorPeer) => void;
  onCursorPeerLeave?: (payload: {
    communityId: string;
    canonicalKey: string;
    from: string;
  }) => void;
}

let socket: Socket | null = null;

export function initRealtime(
  me: WireUser,
  handlers: RealtimeHandlers,
  sessionToken?: string
): void {
  if (socket) return;

  socket = io(REALTIME_URL, {
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
    timeout: 4000,
    // Polling (the default first transport) uses XMLHttpRequest, which
    // does not exist in MV3 service workers — the background relay
    // could never connect. WebSocket works in every context we run in.
    transports: ["websocket"],
    // Read by the server BEFORE any "hello" arrives — if this is a
    // valid, non-expired session for an account with a claimed
    // username, the server uses THAT username, no matter what the
    // "hello" payload below claims. See index.ts's connection handler.
    auth: sessionToken ? { sessionToken } : undefined,
  });

  socket.on("connect", () => {
    socket?.emit("hello", me);
    handlers.onConnectionChange(true);
  });

  socket.on("disconnect", () => handlers.onConnectionChange(false));
  socket.on("connect_error", () => handlers.onConnectionChange(false));

  socket.on("connect_request_error", ({ to, reason }: { to: string; reason: string }) =>
    handlers.onConnectRequestError?.(to, reason)
  );

  socket.on("roster", (users: WireUser[]) => handlers.onRoster(users));

  socket.on(
    "dm",
    ({ from, message }: { from: WireUser; message: WireMessage }) =>
      handlers.onDm(from, message)
  );

  socket.on(
    "dm_edited",
    ({
      from,
      messageId,
      text,
      editedAt,
    }: {
      from: string;
      messageId: string;
      text: string;
      editedAt: number;
    }) => handlers.onDmEdited?.(from, messageId, text, editedAt)
  );

  socket.on(
    "dm_deleted",
    ({ from, messageId }: { from: string; messageId: string }) =>
      handlers.onDmDeleted?.(from, messageId)
  );

  socket.on(
    "dm_reaction",
    ({
      from,
      messageId,
      emoji,
    }: {
      from: string;
      messageId: string;
      emoji: string;
    }) => handlers.onDmReaction?.(from, messageId, emoji)
  );

  socket.on(
    "dm_read_receipt",
    ({
      from,
      messageId,
      readAt,
    }: {
      from: string;
      messageId: string;
      readAt: number;
    }) => handlers.onDmReadReceipt?.(from, messageId, readAt)
  );

  socket.on(
    "community_message_edited",
    ({
      communityId,
      from,
      messageId,
      text,
      editedAt,
    }: {
      communityId: string;
      from: string;
      messageId: string;
      text: string;
      editedAt: number;
    }) => handlers.onCommunityMessageEdited?.(communityId, from, messageId, text, editedAt)
  );

  socket.on(
    "community_message_deleted",
    ({
      communityId,
      from,
      messageId,
    }: {
      communityId: string;
      from: string;
      messageId: string;
    }) => handlers.onCommunityMessageDeleted?.(communityId, from, messageId)
  );

  socket.on(
    "community_reaction",
    ({
      communityId,
      from,
      messageId,
      emoji,
    }: {
      communityId: string;
      from: string;
      messageId: string;
      emoji: string;
    }) => handlers.onCommunityReaction?.(communityId, from, messageId, emoji)
  );

  socket.on("typing", ({ from }: { from: string }) =>
    handlers.onTyping(from)
  );

  socket.on(
    "dm_error",
    ({ to, reason }: { to: string; reason: DmErrorReason }) =>
      handlers.onDmError(to, reason)
  );

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
    ({
      community,
      from,
      attempt,
    }: {
      community: WireCommunity;
      from: WireUser;
      attempt: number;
    }) => handlers.onCommunityInvite(community, from, attempt)
  );

  socket.on("community_invite_declined", (payload) =>
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
    ({
      communityId,
      from,
      message,
    }: {
      communityId: string;
      from: WireUser;
      message: WireMessage;
    }) => handlers.onCommunityMessage(communityId, from, message)
  );

  socket.on("community_error", (payload) =>
    handlers.onCommunityError(payload)
  );

  socket.on("cursor_peer", (peer: CursorPeer) =>
    handlers.onCursorPeer?.(peer)
  );

  socket.on(
    "cursor_peer_leave",
    (payload: { communityId: string; canonicalKey: string; from: string }) =>
      handlers.onCursorPeerLeave?.(payload)
  );
}

/** Re-announce profile changes (name, color, photo) mid-session. */
export function reannounce(me: WireUser): void {
  socket?.emit("hello", me);
}

export function createCommunity(name: string): void {
  socket?.emit("community_create", { name });
}

export function inviteToCommunity(communityId: string, username: string): void {
  socket?.emit("community_invite", { communityId, username });
}

export function respondToCommunityInvite(
  communityId: string,
  action: "accept" | "decline"
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
  message: WireMessage
): void {
  socket?.emit("community_message", { communityId, message });
}

export interface BoardAddItemInput {
  communityId: string;
  url: string;
  canonicalKey: string;
  title: string;
  image?: string;
  siteName?: string;
}

export function addBoardItem(input: BoardAddItemInput): void {
  socket?.emit("board_add_item", input);
}

export function removeBoardItem(communityId: string, itemId: string): void {
  socket?.emit("board_remove_item", { communityId, itemId });
}

export function commentOnBoardItem(
  communityId: string,
  itemId: string,
  text: string
): void {
  socket?.emit("board_comment", { communityId, itemId, text });
}

export function commentOnPin(
  communityId: string,
  itemId: string,
  pinId: string,
  text: string
): void {
  socket?.emit("board_pin_comment", { communityId, itemId, pinId, text });
}

export function commentOnHighlight(
  communityId: string,
  itemId: string,
  highlightId: string,
  text: string
): void {
  socket?.emit("board_highlight_comment", { communityId, itemId, highlightId, text });
}

export function voteOnBoardItem(communityId: string, itemId: string): void {
  socket?.emit("board_vote", { communityId, itemId });
}

export function decideBoardItem(
  communityId: string,
  itemId: string | null
): void {
  socket?.emit("board_decide", { communityId, itemId });
}

export interface CursorPeer {
  communityId: string;
  canonicalKey: string;
  from: { username: string; name: string; color: string };
  xPercent: number;
  yPercent: number;
  anchorSelector?: string;
  elXPercent?: number;
  elYPercent?: number;
}

export interface CursorMovePayload {
  xPercent: number;
  yPercent: number;
  anchorSelector?: string;
  elXPercent?: number;
  elYPercent?: number;
}

export function sendCursorMove(
  communityId: string,
  canonicalKey: string,
  payload: CursorMovePayload
): void {
  socket?.emit("cursor_move", { communityId, canonicalKey, ...payload });
}

export function sendCursorLeave(communityId: string, canonicalKey: string): void {
  socket?.emit("cursor_leave", { communityId, canonicalKey });
}

export interface BoardAnchorInput {
  communityId: string;
  url: string;
  canonicalKey: string;
  title: string;
  image?: string;
  siteName?: string;
}

export function addBoardPin(
  input: BoardAnchorInput & {
    text: string;
    xPercent: number;
    yPercent: number;
    pageX?: number;
    pageY?: number;
    anchorSelector?: string;
    elXPercent?: number;
    elYPercent?: number;
  }
): void {
  socket?.emit("board_pin_add", input);
}

export function removeBoardPin(
  communityId: string,
  itemId: string,
  pinId: string
): void {
  socket?.emit("board_pin_remove", { communityId, itemId, pinId });
}

export function addBoardArea(
  input: BoardAnchorInput & {
    text: string;
    xPercent: number;
    yPercent: number;
    widthPercent: number;
    heightPercent: number;
    pageX?: number;
    pageY?: number;
    pageWidth?: number;
    pageHeight?: number;
    anchorSelector?: string;
    elXPercent?: number;
    elYPercent?: number;
  }
): void {
  socket?.emit("board_area_add", input);
}

export function removeBoardArea(
  communityId: string,
  itemId: string,
  areaId: string
): void {
  socket?.emit("board_area_remove", { communityId, itemId, areaId });
}

export function commentOnArea(
  communityId: string,
  itemId: string,
  areaId: string,
  text: string
): void {
  socket?.emit("board_area_comment", { communityId, itemId, areaId, text });
}

export function addBoardHighlight(
  input: BoardAnchorInput & {
    quote: string;
    prefix: string;
    suffix: string;
    comment?: string;
  }
): void {
  socket?.emit("board_highlight_add", input);
}

export function removeBoardHighlight(
  communityId: string,
  itemId: string,
  highlightId: string
): void {
  socket?.emit("board_highlight_remove", { communityId, itemId, highlightId });
}

/** Ask to connect with someone. Consent gate: no chat until they accept. */
export function sendConnectRequest(toUsername: string): void {
  socket?.emit("connect_request", { to: toUsername });
}

export function respondToConnectRequest(
  toUsername: string,
  action: "accept" | "deny"
): void {
  socket?.emit("connect_response", { to: toUsername, action });
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

export function disconnectRealtime(): void {
  socket?.disconnect();
  socket = null;
}

/** Push a visibility change to the server (takes effect immediately). */
export function updateVisibility(visibility: Visibility): void {
  socket?.emit("visibility", visibility);
}

export function sendDm(toUsername: string, message: WireMessage): void {
  socket?.emit("dm", { to: toUsername, message });
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

export function editCommunityMessage(
  communityId: string,
  messageId: string,
  text: string
): void {
  socket?.emit("community_message_edit", { communityId, messageId, text });
}

export function deleteCommunityMessage(communityId: string, messageId: string): void {
  socket?.emit("community_message_delete", { communityId, messageId });
}

export function reactToCommunityMessage(
  communityId: string,
  messageId: string,
  emoji: string
): void {
  socket?.emit("community_message_react", { communityId, messageId, emoji });
}

export function sendTyping(toUsername: string): void {
  socket?.emit("typing", { to: toUsername });
}

/** Set my presence status (online/away/busy/appear-offline). */
export function updatePresence(presence: WirePresence): void {
  socket?.emit("presence", presence);
}

/** Mask my presence (as offline) toward one user. Messages still flow. */
export function hidePresenceFrom(username: string, hidden: boolean): void {
  socket?.emit("presence_hide", { username, hidden });
}

/** Silently sever a connection (the other side is not notified). */
export function removeConnection(username: string): void {
  socket?.emit("connection_remove", { username });
}
