/**
 * @tabcom/shared — wire protocol types
 *
 * Single source of truth for socket event payload shapes, consumed by:
 *   - apps/extension (Chrome/Brave, WXT)
 *   - apps/mobile (React Native / Expo)
 *   - apps/backend (Node/Express + Socket.IO)
 *
 * Extracted verbatim from apps/extension/src/lib/realtime.ts so the
 * three previously-drifting type files converge here. Do not add
 * platform-specific imports (wxt, react-native, express) to this file.
 */


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
  kind:
    | "text"
    | "link"
    | "voice"
    | "image"
    | "video"
    | "file"
    | "contact"
    | "location";
  text: string;
  url?: string;
  /** Data URL for voice/image messages — relayed and forgotten by the
   *  server exactly like message text (zero retention). Kept small
   *  client-side (voice capped at 60s opus, images downscaled) to stay
   *  under the transport's 1MB frame limit. */
  dataUrl?: string;
  durationMs?: number;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  latitude?: number;
  longitude?: number;
  contactUsername?: string;
  contactName?: string;
  contactColor?: string;
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

/** Delivery evidence, three-valued ON PURPOSE:
 *  - "delivered": the relay POSITIVELY confirmed hand-off.
 *  - "rejected":  the relay POSITIVELY refused (or no socket exists).
 *  - "unknown":   no answer (ack timeout, older server without ack
 *                 support, ack lost across a reconnect). */
export type DeliveryEvidence = "delivered" | "rejected" | "unknown";
