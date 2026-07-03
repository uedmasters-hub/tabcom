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

export type MessageKind = "text" | "link" | "system";

export interface Message {
  id: string;
  authorId: string; // "me", "system", or a contact id
  kind: MessageKind;
  text: string;
  url?: string;
  sentAt: number;
  /** Community messages carry author display info. */
  authorName?: string;
  authorColor?: string;
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
  votes: string[];
  decided: boolean;
}

export interface Community {
  id: string;
  name: string;
  admin: string;
  members: CommunityMember[];
  pendingForMe: boolean;
  invitedBy?: string;
  board: BoardItem[];
  boardDecidedId?: string;
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
