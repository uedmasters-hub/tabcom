import { io, type Socket } from "socket.io-client";
import { browser } from "wxt/browser";

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

// NOTE: this fallback is intentionally a portable "localhost" default,
// not any particular person's machine. For LAN testing across devices
// (phone + laptop, two laptops, etc.), set WXT_REALTIME_URL in
// apps/extension/.env — see apps/extension/.env.example. A previous
// version of this fallback was literally the string
// "WXT_REALTIME_URL=http://rameshs-macbook-pro.local:3001" (the whole
// .env LINE, not just the URL) — not a valid URL at all, so whenever
// the env var wasn't actually picked up at build time, socket.io was
// silently handed garbage and never connected. That's almost certainly
// why "other people online" wasn't showing up: the socket never
// connected in the first place, not a presence/roster bug.
export const REALTIME_URL =
  (import.meta.env.WXT_REALTIME_URL as string | undefined) ?? "http://localhost:3001";

if (!import.meta.env.WXT_REALTIME_URL) {
  console.warn(
    "[tabcom] WXT_REALTIME_URL is not set — falling back to",
    REALTIME_URL,
    ". For LAN testing across devices, set it in apps/extension/.env and rebuild (this is baked in at build time, not read at runtime)."
  );
}

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
  /** Bumped by the server on every logo upload — undefined if the
   *  community has never had one. Append as a ?v= query param when
   *  building the image URL so the browser doesn't keep showing a
   *  cached older logo after a re-upload. */
  imageVersion?: number;
}

export type CommunityErrorReason =
  | "not_connected"
  | "invite_limit"
  | "already_pending";

export interface WireMessage {
  id: string;
  kind: "text" | "link" | "voice" | "image";
  text: string;
  url?: string;
  /** Data URL for voice/image messages — relayed and forgotten by the
   *  server exactly like message text (zero retention). Kept small
   *  client-side (voice capped at 60s opus, images downscaled) to stay
   *  under the transport's 1MB frame limit. */
  dataUrl?: string;
  durationMs?: number;
  sentAt: number;
  replyToId?: string;
}

/** One leg of WebRTC call negotiation, relayed (never stored) through
 *  the server between accepted contacts. Media itself is P2P. */
export interface CallSignal {
  kind: "offer" | "answer" | "ice" | "end" | "reject" | "busy";
  /** Caller sets this on the offer: video call vs voice-only. */
  video?: boolean;
  sdp?: string;
  candidate?: unknown;
}

export interface IncomingCallSignal {
  from: { username: string; name: string; color: string };
  signal: CallSignal;
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
  /** Server heads-up that a just-sent DM went to an appear-offline
   *  recipient — delivered, but expect no receipts and possibly no
   *  reply until they're back. */
  onDmNotice?: (toUsername: string, reason: string) => void;
  /** Call setup failed server-side (not connected, unavailable, or an
   *  appear-offline gate in either direction). */
  onCallError?: (toUsername: string, reason: string) => void;
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
  onAnnotationPeer?: (peer: AnnotationPeer) => void;
  onCallSignal?: (payload: IncomingCallSignal) => void;
  /** Fired after every "hello" ack — the username the server actually
   *  registered this socket under, which can differ from what was sent
   *  if it collided with someone else (guests only; see index.ts's
   *  ensureUniqueGuestUsername). The caller should persist this if it
   *  differs from local state, or outgoing actions will keep signing
   *  with an identity the server no longer recognizes for this socket. */
  onUsernameAssigned?: (username: string) => void;
}

let socket: Socket | null = null;

/** True while the socket is live. Exported so callers can gate
 *  fire-and-forget emits without owning connection state themselves. */
export function isRealtimeConnected(): boolean {
  return !!socket?.connected;
}

/**
 * Resolve true as soon as the socket is connected, or false after
 * waitMs. This is the ONLY correct way to answer "can I write now?":
 * the old pattern resolved false on the first connect_error, which
 * against a cold-started server (Render free instances sleep and take
 * 30-60s to wake) rejected every write in the wake-up window even
 * though the connection was seconds away from succeeding.
 */
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

export function initRealtime(
  me: WireUser,
  handlers: RealtimeHandlers,
  sessionToken?: string,
  guestInstanceId?: string
): void {
  if (socket) return;

  socket = io(REALTIME_URL, {
    // NEVER stop retrying. The previous reconnectionAttempts: 5 meant
    // one cold-start window (server asleep on Render) permanently
    // killed the socket for the rest of the service worker's life —
    // every subsequent write failed with "unreachable" even after the
    // server was long since awake. Infinite attempts with a capped
    // delay costs one lightweight probe every few seconds while
    // disconnected, and removes the permanent-death failure mode.
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    // 10s per attempt: a waking server can be slow to accept the
    // handshake; 4s was routinely too short for Render cold starts.
    timeout: 10000,
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
    // guestInstanceId rides alongside the WireUser fields but is
    // deliberately never PART of WireUser — it's a server-side-only
    // signal for disambiguating this browser's own multiple
    // connections (panel/background/pip) from a genuine stranger, and
    // has no reason to be broadcast to peers via the roster.
    const helloPayload = guestInstanceId ? { ...me, guestInstanceId } : me;
    socket?.emit("hello", helloPayload, (ack?: { username: string }) => {
      if (ack?.username && ack.username !== me.username) {
        handlers.onUsernameAssigned?.(ack.username);
      }
    });
    handlers.onConnectionChange(true);
  });

  socket.on("disconnect", () => handlers.onConnectionChange(false));
  socket.on("connect_error", () => handlers.onConnectionChange(false));

  socket.on("connect_request_error", ({ to, reason }: { to: string; reason: string }) =>
    handlers.onConnectRequestError?.(to, reason)
  );

  socket.on("dm_notice", ({ to, reason }: { to: string; reason: string }) =>
    handlers.onDmNotice?.(to, reason)
  );

  socket.on("call_error", ({ to, reason }: { to: string; reason: string }) =>
    handlers.onCallError?.(to, reason)
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

  socket.on("annotation_peer", (peer: AnnotationPeer) =>
    handlers.onAnnotationPeer?.(peer)
  );

  socket.on("call_signal", (payload: IncomingCallSignal) =>
    handlers.onCallSignal?.(payload)
  );

  socket.on(
    "cursor_peer_leave",
    (payload: { communityId: string; canonicalKey: string; from: string }) =>
      handlers.onCursorPeerLeave?.(payload)
  );
}

/** Re-announce profile changes (name, color, photo) mid-session. No ack
 *  handling needed here — the username collision this guards against
 *  can only happen on the FIRST hello of a session (see initRealtime),
 *  since by definition nothing else could have taken this socket's
 *  already-established username in the meantime. */
export function reannounce(me: WireUser): void {
  socket?.emit("hello", me);
}

/** Resolves with the new community's id once the server confirms
 *  creation — lets the caller immediately follow up with
 *  setCommunityImage without needing to correlate against the
 *  community_update broadcast. Resolves undefined if the socket isn't
 *  connected or the server never acks (e.g. private visibility). */
export function createCommunity(name: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    if (!socket) {
      resolve(undefined);
      return;
    }
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
    // The server silently no-ops on some rejections (private
    // visibility) rather than nak'ing — don't hang forever waiting
    // for an ack that will never come.
    const timer = setTimeout(() => settle(undefined), 5000);
  });
}

/** Upload/replace a community's logo. Admin-only server-side. Caller
 *  is responsible for keeping the upload within a sane size — this
 *  just relays whatever it's given; the server enforces the real
 *  limit (~2MB decoded) and mime-type allowlist. */
export function setCommunityImage(
  communityId: string,
  mimeType: string,
  base64Data: string
): void {
  socket?.emit("community_set_image", { communityId, mimeType, data: base64Data });
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
  /** Absolute document pixels at capture time — preferred fallback over
   *  xPercent/yPercent when the element anchor doesn't resolve, since
   *  percents drift between peers whose pages have loaded different
   *  amounts of content (infinite scroll). Same reasoning as BoardPin. */
  pageX?: number;
  pageY?: number;
  anchorSelector?: string;
  elXPercent?: number;
  elYPercent?: number;
}

/**
 * A quick, ephemeral annotation from a peer — the "speech bubble" kind,
 * never stored. See annotation_ephemeral (server) / pin_add (persistent,
 * unrelated path) for the two ways a `/`-opened annotation can go.
 */
export interface AnnotationPeer {
  communityId: string;
  canonicalKey: string;
  id: string;
  from: { username: string; name: string; color: string };
  text: string;
  xPercent: number;
  yPercent: number;
  /** Absolute document pixels — see CursorPeer.pageX for why. */
  pageX?: number;
  pageY?: number;
  anchorSelector?: string;
  elXPercent?: number;
  elYPercent?: number;
}

export interface CursorMovePayload {
  xPercent: number;
  yPercent: number;
  pageX?: number;
  pageY?: number;
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

export function sendCallSignal(to: string, signal: CallSignal): void {
  socket?.emit("call_signal", { to, signal });
}

export function sendAnnotationEphemeral(
  communityId: string,
  canonicalKey: string,
  payload: {
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
  socket?.emit("annotation_ephemeral", { communityId, canonicalKey, ...payload });
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

/** Withdraw a request THIS user sent, before the other side has acted
 *  on it — the "Revoke" action on an outgoing pending request. */
/** Restores a registered user's accepted connections list from the
 *  server's durable pairs state — see the backend handler's doc
 *  comment for why this only ever returns OTHER registered accounts,
 *  never guest contacts. */
export function getMyConnections(): Promise<
  Array<{ username: string; displayName: string | null; avatarColor: string | null }>
> {
  return new Promise((resolve) => {
    if (!socket) {
      resolve([]);
      return;
    }
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

/**
 * Resets a registered user's own activity — messages/conversations are
 * purely client-side already (this project's zero-message-retention
 * guarantee means there's nothing server-side to clear for those); the
 * server side of this only ever touches this user's OWN pins/areas/
 * votes and their activity log/settings rows, never anyone else's
 * contributions to a shared community board, and never contacts,
 * communities, or the account/session itself.
 */
export function clearMyHistory(): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolve) => {
    if (!socket) {
      resolve({ ok: false, reason: "not_connected" });
      return;
    }
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

export function cancelConnectRequest(toUsername: string): void {
  socket?.emit("connect_cancel", { to: toUsername });
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

/**
 * The ONLY correct way to end a session from any UI code — never call
 * bare disconnectRealtime() directly for a real session-end (sign out,
 * end guest session, delete account, guest expiry). That only tears
 * down THIS context's own socket; background (and the pip window, if
 * open) each hold a completely separate connection with zero built-in
 * awareness that a session ended anywhere else, and just keep running
 * indefinitely. That's exactly the mechanism behind guest identities
 * that had already "ended" still showing up as online — this file has
 * that exact bug fixed twice already, in two different call sites,
 * because the fix lived at each call site instead of here. Putting it
 * in one place is what actually closes it for every current AND
 * future call site.
 */
export function disconnectAllContexts(): void {
  disconnectRealtime();
  void browser.runtime.sendMessage({ type: "tabcom:session-ended" }).catch(() => {});
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
