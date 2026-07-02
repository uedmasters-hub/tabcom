export type Presence = "online" | "away" | "busy" | "offline";

export interface Contact {
  id: string;
  name: string;
  username: string;
  color: string;
  presence: Presence;
}

export type MessageKind = "text" | "link" | "system";

export interface Message {
  id: string;
  authorId: string; // "me" or a contact id
  kind: MessageKind;
  text: string;
  url?: string;
  sentAt: number;
}

export interface Conversation {
  id: string;
  contactId: string;
  unread: number;
  lastMessageAt: number;
}
