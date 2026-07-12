export type Presence = "online" | "away" | "busy" | "offline";

export interface Contact {
  id: string;
  name: string;
  username: string;
  color: string;
  presence: Presence;
  photo?: string;
  /** Local nickname — never leaves this device. */
  alias?: string;
}

/** Display name honoring the local alias. */
export function contactLabel(contact: Contact): string {
  return contact.alias?.trim() || contact.name;
}

export type MessageKind = "text" | "link" | "system" | "voice" | "image";

/** Only meaningful for messages authored by "me" — a fire-and-forget
 *  socket emit doesn't give a real delivery guarantee, so this is a
 *  best-effort signal: sending while offline is the one case we can
 *  detect for certain. */
export type MessageStatus = "sending" | "sent" | "failed";

export interface MessageReaction {
  emoji: string;
  usernames: string[];
}

export interface Message {
  id: string;
  authorId: string; // "me", "system", or a contact id
  kind: MessageKind;
  text: string;
  url?: string;
  /** Media payload for kind "voice" (audio) or "image" — a data URL,
   *  stored only in each participant's local client (never on the
   *  server, which relays the message and forgets it like all others). */
  dataUrl?: string;
  /** Recorded length for kind "voice", in milliseconds. */
  durationMs?: number;
  sentAt: number;
  /** Community messages carry author display info. */
  authorName?: string;
  authorColor?: string;
  status?: MessageStatus;
  editedAt?: number;
  /** Tombstone — the message is gone, but we keep the row so the
   *  conversation doesn't jump and the other person isn't confused by
   *  a message vanishing with no explanation. */
  deletedAt?: number;
  /** Inline reply reference — the id of the message being replied to. */
  replyToId?: string;
  reactions?: MessageReaction[];
  /** DM read receipts only for this pass — when the OTHER person read
   *  this message (only ever set on messages authored by "me"). */
  readAt?: number;
}

export interface CommunityMember {
  username: string;
  name: string;
  color: string;
}

export interface BoardComment {
  id: string;
  author: string;
  text: string;
  sentAt: number;
}

export interface BoardPin {
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
  comments: BoardComment[];
}

export interface BoardHighlight {
  id: string;
  author: string;
  sentAt: number;
  quote: string;
  prefix: string;
  suffix: string;
  comments: BoardComment[];
}

export interface BoardArea {
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
  comments: BoardComment[];
}

export interface BoardItem {
  id: string;
  url: string;
  canonicalKey: string;
  title: string;
  image?: string;
  siteName?: string;
  addedBy: string;
  addedAt: number;
  comments: BoardComment[];
  pins: BoardPin[];
  highlights: BoardHighlight[];
  areas: BoardArea[];
  votes: string[];
  decided: boolean;
}

export interface PendingInvite {
  username: string;
  attemptsLeft: number;
}

export interface Community {
  id: string;
  name: string;
  admin: string;
  members: CommunityMember[];
  pendingForMe: boolean;
  invitedBy?: string;
  /** Admin-only visibility — empty array for everyone else. */
  pendingInvites: PendingInvite[];
  board: BoardItem[];
  boardDecidedId?: string;
  imageVersion?: number;
}

export type ConversationKind = "dm" | "community";

export interface Conversation {
  id: string;
  kind: ConversationKind;
  /** Set when kind === "dm". */
  contactId?: string;
  /** Set when kind === "community". */
  communityId?: string;
  unread: number;
  lastMessageAt: number;
}
