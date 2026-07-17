import { browser } from "wxt/browser";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { extensionStorage } from "../lib/extension-storage";
import { useProfileStore } from "./profile.store";
import {
  addBoardItem,
  blockUser,
  hidePresenceFrom,
  removeConnection,
  createCommunity as rtCreateCommunity,
  setCommunityImage as rtSetCommunityImage,
  inviteToCommunity as rtInviteToCommunity,
  leaveCommunity as rtLeaveCommunity,
  removeCommunityMember as rtRemoveCommunityMember,
  cancelCommunityInvite as rtCancelCommunityInvite,
  renameCommunity as rtRenameCommunity,
  transferCommunityAdmin as rtTransferCommunityAdmin,
  deleteCommunity as rtDeleteCommunity,
  reportUser,
  respondToCommunityInvite,
  respondToConnectRequest,
  cancelConnectRequest,
  getMyConnections,
  sendCommunityMessage,
  removeBoardItem,
  commentOnBoardItem,
  commentOnPin,
  commentOnHighlight,
  commentOnArea,
  voteOnBoardItem,
  decideBoardItem,
  sendConnectRequest,
  sendDm,
  editDm,
  deleteDm,
  reactToDm,
  markDmRead,
  editCommunityMessage,
  deleteCommunityMessage,
  reactToCommunityMessage,
  unblockUser,
  type CommunityErrorReason,
  type ConnectionStatus,
  type WireCommunity,
  type WireMessage,
  type WireUser,
} from "../lib/realtime";
import type {
  Community,
  Contact,
  Conversation,
  Message,
  MessageReaction,
} from "../types/chat";
import { readPageAnchor } from "../lib/anchor";

/**
 * Local-first chat data layer.
 * Messages persist only on this device (the server retains nothing).
 * Connection + community state mirrors the server, which is the authority.
 */

export const ME = "me";

const SEED_CONTACTS: Contact[] = [
  {
    id: "c-priya",
    name: "Priya Sharma",
    username: "priya",
    color: "#7C3AED",
    presence: "online",
  },
  {
    id: "c-arjun",
    name: "Arjun Mehta",
    username: "arjun_m",
    color: "#EA580C",
    presence: "away",
  },
  {
    id: "c-sara",
    name: "Sara Khan",
    username: "sarak",
    color: "#059669",
    presence: "busy",
  },
];

const CANNED_REPLIES = [
  "Nice — taking a look now.",
  "Got it, thanks for sharing!",
  "Interesting. Let's discuss this in our sync.",
  "On it. Will get back to you shortly.",
  "That page is really useful, bookmarking it.",
];

function uid(): string {
  return crypto.randomUUID();
}

interface CommunityInvite {
  community: WireCommunity;
  from: WireUser;
  attempt: number;
}

export type ConnectionPhase = "connecting" | "live" | "offline";

interface ChatState {
  hasHydrated: boolean;
  live: boolean;
  /** UX-facing connection state. "connecting" covers both the initial
   *  attempt and reconnection (incl. Render cold starts, which can take
   *  up to a minute) — only WorkspaceScreen's grace timer demotes it to
   *  "offline", so the UI never flashes an offline/demo state during a
   *  routine slow wake-up. */
  connectionPhase: ConnectionPhase;

  contacts: Contact[];
  conversations: Conversation[];
  messages: Record<string, Message[]>;

  /** username -> connection status. Server snapshot is the authority. */
  connections: Record<string, ConnectionStatus>;

  /** Communities I belong to (server-mirrored). */
  communities: Record<string, Community>;
  /** Pending community invites awaiting my consent. */
  communityInvites: Record<string, CommunityInvite>;

  /** Muted targets (contactId or communityId): no unread badges. */
  muted: string[];

  /** Last community-scoped action error (invite failures etc.) — surfaced
   *  inline in the Community Management page. Deliberately not persisted
   *  and not part of the chat-feed system notices (which still also fire,
   *  for anyone not currently looking at the management page). */
  communityActionError: {
    communityId: string;
    username?: string;
    reason: CommunityErrorReason;
  } | null;
  clearCommunityActionError: () => void;

  /** Usernames in the latest live roster (currently connected). */
  rosterUsernames: string[];
  /** Contacts I appear offline to (presence mask, not blocking). */
  hiddenFrom: string[];

  activeConversationId: string | null;
  typing: string[];

  setHasHydrated: (value: boolean) => void;
  ensureSeeded: () => void;
  setLiveStatus: (live: boolean) => void;
  setConnectionPhase: (phase: ConnectionPhase) => void;

  openConversation: (conversationId: string) => void;
  closeConversation: () => void;
  startConversation: (contactId: string) => string;
  openCommunityConversation: (communityId: string) => string;

  sendText: (conversationId: string, text: string, replyToId?: string) => void;
  sendMedia: (
    conversationId: string,
    media: {
      kind: "voice" | "image" | "video" | "file" | "contact" | "location";
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
    }
  ) => void;
  /** Re-attempt delivery of a failed outgoing message. */
  retryMessage: (conversationId: string, messageId: string) => void;
  editMessage: (conversationId: string, messageId: string, text: string) => void;
  deleteMessage: (conversationId: string, messageId: string) => void;
  reactToMessage: (conversationId: string, messageId: string, emoji: string) => void;
  markMessageRead: (conversationId: string, messageId: string) => void;
  replyTargets: Record<string, string | null>;
  setReplyTarget: (conversationId: string, messageId: string | null) => void;

  receiveDmEdited: (fromUsername: string, messageId: string, text: string, editedAt: number) => void;
  receiveDmDeleted: (fromUsername: string, messageId: string) => void;
  receiveDmReaction: (fromUsername: string, messageId: string, emoji: string) => void;
  receiveDmReadReceipt: (fromUsername: string, messageId: string, readAt: number) => void;
  receiveCommunityMessageEdited: (
    communityId: string,
    fromUsername: string,
    messageId: string,
    text: string,
    editedAt: number
  ) => void;
  receiveCommunityMessageDeleted: (
    communityId: string,
    fromUsername: string,
    messageId: string
  ) => void;
  receiveCommunityReaction: (
    communityId: string,
    fromUsername: string,
    messageId: string,
    emoji: string
  ) => void;
  shareCurrentTab: (conversationId: string) => Promise<void>;

  toggleMute: (targetId: string) => void;
  clearHistory: (conversationId: string) => void;

  // contact management
  addContactByUsername: (username: string) => void;
  receiveConnectRequestError: (username: string, reason: string) => void;
  renameContact: (contactId: string, alias: string) => void;
  removeContact: (contactId: string) => void;
  toggleHidePresence: (contact: Contact) => void;

  // connections
  connectionFor: (contact: Contact) => ConnectionStatus;
  receiveConnections: (
    snapshot: Array<{ username: string; status: ConnectionStatus }>
  ) => void;
  receiveConnectRequest: (from: WireUser) => void;
  receiveConnectUpdate: (username: string, status: ConnectionStatus) => void;
  requestConnect: (contact: Contact) => void;
  respondToRequest: (contact: Contact, action: "accept" | "deny") => void;
  /** Withdraws a request THIS user sent, before the other side acts on
   *  it — the "Revoke" action on an outgoing pending request. */
  revokeConnectRequest: (contact: Contact) => void;
  block: (contact: Contact) => void;
  unblock: (contact: Contact) => void;
  report: (contact: Contact, reason?: string) => void;

  // realtime receive
  applyRoster: (users: WireUser[]) => void;
  receiveDm: (from: WireUser, message: WireMessage) => void;
  receiveTyping: (fromUsername: string) => void;
  receiveDmNotice: (toUsername: string, reason: string) => void;
  receiveCallError: (toUsername: string, reason: string) => void;
  receiveDmError: (
    toUsername: string,
    reason: "sender_private" | "recipient_unavailable" | "not_connected"
  ) => void;

  // communities
  createCommunity: (name: string) => Promise<string | undefined>;
  /** Merges in accepted connections the server remembers durably but
   *  this client's local contacts list might not (a fresh device,
   *  or this one after a reinstall) — see realtime.ts's
   *  getMyConnections for what it does and doesn't cover. Never
   *  overwrites an existing contact entry, only adds ones missing. */
  restoreConnections: () => Promise<void>;
  /** Uploads/replaces a community's logo. base64Data should already
   *  be stripped of the "data:image/...;base64," prefix. */
  uploadCommunityImage: (communityId: string, mimeType: string, base64Data: string) => void;
  inviteToCommunity: (communityId: string, username: string) => void;
  respondToCommunityInvite: (
    communityId: string,
    action: "accept" | "decline"
  ) => void;
  leaveCommunity: (communityId: string) => void;
  removeCommunityMember: (communityId: string, username: string) => void;
  cancelCommunityInvite: (communityId: string, username: string) => void;
  renameCommunity: (communityId: string, name: string) => void;
  transferCommunityAdmin: (communityId: string, username: string) => void;
  deleteCommunity: (communityId: string) => void;
  receiveCommunityDeleted: (communityId: string) => void;

  // boards
  addCurrentTabToBoard: (communityId: string) => Promise<void>;
  removeBoardItem: (communityId: string, itemId: string) => void;
  commentOnBoardItem: (communityId: string, itemId: string, text: string) => void;
  commentOnPin: (communityId: string, itemId: string, pinId: string, text: string) => void;
  commentOnHighlight: (
    communityId: string,
    itemId: string,
    highlightId: string,
    text: string
  ) => void;
  commentOnArea: (
    communityId: string,
    itemId: string,
    areaId: string,
    text: string
  ) => void;
  voteOnBoardItem: (communityId: string, itemId: string) => void;
  decideBoardItem: (communityId: string, itemId: string | null) => void;
  receiveCommunities: (list: WireCommunity[]) => void;
  receiveCommunityUpdate: (community: WireCommunity) => void;
  receiveCommunityInvite: (
    community: WireCommunity,
    from: WireUser,
    attempt: number
  ) => void;
  receiveCommunityDeclined: (payload: {
    communityId: string;
    communityName: string;
    username: string;
    attemptsLeft: number;
    barred: boolean;
  }) => void;
  receiveCommunityLeft: (communityId: string) => void;
  receiveCommunityInviteCancelled: (communityId: string) => void;
  receiveCommunityMessage: (
    communityId: string,
    from: WireUser,
    message: WireMessage
  ) => void;
  receiveCommunityError: (payload: {
    communityId: string;
    username: string;
    reason: CommunityErrorReason;
  }) => void;

  resetChat: () => void;
  /** "Clear history" (the Settings-level, whole-account reset) —
   *  resets messages/conversations/typing state ONLY. Deliberately
   *  preserves contacts, connections, communities, community invites,
   *  and mutes — none of that is "activity", it's identity/
   *  relationship state, and this action must never touch it (see
   *  SettingsView's confirmation copy, which promises exactly this).
   *  Distinct from the per-conversation clearHistory(conversationId)
   *  above, and from resetChat() (full wipe, used for guest expiry). */
  clearAllHistory: () => void;
}

function toCommunity(wire: WireCommunity): Community {
  return {
    id: wire.id,
    name: wire.name,
    admin: wire.admin,
    members: wire.members,
    pendingForMe: wire.pendingForMe,
    pendingInvites: wire.pendingInvites ?? [],
    board: (wire.board ?? []).map((item) => ({
      ...item,
      pins: item.pins ?? [],
      highlights: item.highlights ?? [],
      areas: item.areas ?? [],
    })),
    boardDecidedId: wire.boardDecidedId,
    imageVersion: wire.imageVersion,
  };
}

function appendMessage(
  state: Pick<ChatState, "messages" | "conversations">,
  conversationId: string,
  message: Message,
  incrementUnread: boolean
) {
  const thread = state.messages[conversationId] ?? [];

  // Two windows (panel + float) each hold a socket; dedupe by id.
  if (thread.some((existing) => existing.id === message.id)) {
    return { messages: state.messages, conversations: state.conversations };
  }

  return {
    messages: {
      ...state.messages,
      [conversationId]: [...thread, message],
    },
    conversations: state.conversations
      .map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              lastMessageAt: message.sentAt,
              unread: incrementUnread
                ? conversation.unread + 1
                : conversation.unread,
            }
          : conversation
      )
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt),
  };
}

function messageIdExists(
  messages: Record<string, Message[]>,
  id: string
): boolean {
  for (const thread of Object.values(messages)) {
    // scan from the end — duplicates are always recent
    for (let i = thread.length - 1; i >= 0 && i >= thread.length - 60; i -= 1) {
      if (thread[i].id === id) return true;
    }
  }
  return false;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => {
      /** Find or create a conversation for a dm contact / community. */
      const ensureConversation = (
        target: { contactId?: string; communityId?: string },
        stamp = Date.now()
      ): Conversation => {
        const existing = get().conversations.find((item) =>
          target.contactId
            ? item.contactId === target.contactId
            : item.communityId === target.communityId
        );
        if (existing) return existing;

        const conversation: Conversation = {
          id: uid(),
          kind: target.contactId ? "dm" : "community",
          contactId: target.contactId,
          communityId: target.communityId,
          unread: 0,
          lastMessageAt: stamp,
        };

        set((state) => ({
          conversations: [conversation, ...state.conversations],
          messages: { ...state.messages, [conversation.id]: [] },
        }));

        return conversation;
      };

      /** THE single wire → Message projection. Every receive path (DM,
       *  community, background drain) goes through this so a field
       *  added to the wire can never again be silently dropped on the
       *  receiving side — which is exactly how recipients ended up
       *  with location messages missing their coordinates and file
       *  messages missing their names. */
      const wireToMessage = (
        wire: WireMessage,
        authorId: string,
        extras?: Partial<Message>
      ): Message => ({
        id: wire.id,
        authorId,
        kind: wire.kind,
        text: wire.text,
        url: wire.url,
        dataUrl: wire.dataUrl,
        durationMs: wire.durationMs,
        fileName: wire.fileName,
        fileSize: wire.fileSize,
        mimeType: wire.mimeType,
        latitude: wire.latitude,
        longitude: wire.longitude,
        contactUsername: wire.contactUsername,
        contactName: wire.contactName,
        contactColor: wire.contactColor,
        sentAt: wire.sentAt,
        replyToId: wire.replyToId,
        ...extras,
      });

      const systemNotice = (
        target: { contactId?: string; communityId?: string },
        text: string,
        unread: boolean
      ) => {
        const conversation = ensureConversation(target);

        const notice: Message = {
          id: uid(),
          authorId: "system",
          kind: "system",
          text,
          sentAt: Date.now(),
        };

        set((state) => {
          const isViewing = state.activeConversationId === conversation.id;
          return appendMessage(state, conversation.id, notice, unread && !isViewing);
        });
      };

      const isMuted = (targetId?: string) =>
        !!targetId && get().muted.includes(targetId);

      const scheduleReply = (conversationId: string, contactId: string) => {
        setTimeout(() => {
          set((state) => ({
            typing: state.typing.includes(contactId)
              ? state.typing
              : [...state.typing, contactId],
          }));
        }, 700);

        setTimeout(
          () => {
            set((state) => {
              const reply: Message = {
                id: uid(),
                authorId: contactId,
                kind: "text",
                text: CANNED_REPLIES[
                  Math.floor(Math.random() * CANNED_REPLIES.length)
                ]!,
                sentAt: Date.now(),
              };

              const isViewing = state.activeConversationId === conversationId;

              return {
                ...appendMessage(state, conversationId, reply, !isViewing),
                typing: state.typing.filter((id) => id !== contactId),
              };
            });
          },
          1800 + Math.random() * 1500
        );
      };

      /** Route an outgoing message by conversation kind. */
      const deliver = (conversationId: string, message: Message) => {
        if (message.kind === "system") return;

        const conversation = get().conversations.find(
          (item) => item.id === conversationId
        );
        if (!conversation) return;

        const wire: WireMessage = {
          id: message.id,
          kind: message.kind,
          text: message.text,
          url: message.url,
          dataUrl: message.dataUrl,
          durationMs: message.durationMs,
          fileName: message.fileName,
          fileSize: message.fileSize,
          mimeType: message.mimeType,
          latitude: message.latitude,
          longitude: message.longitude,
          contactUsername: message.contactUsername,
          contactName: message.contactName,
          contactColor: message.contactColor,
          sentAt: message.sentAt,
          replyToId: message.replyToId,
        };

        // THE delivery state machine — every transition for outgoing
        // messages flows through this one function, driven by three-
        // valued transport evidence. Deterministic and forward-only:
        //
        //   sending ──unknown──▶ sent           (relay probably has it)
        //   sending/sent ──delivered──▶ delivered
        //   sending/sent ──rejected──▶ failed   (POSITIVE refusal only)
        //   any + read receipt ▶ read (readAt)  — terminal, heals all
        //
        // "unknown" (ack timeout, an older relay without ack support,
        // an ack lost across a reconnect) NEVER produces "failed":
        // absence of evidence is not evidence of failure, and treating
        // it as such is precisely what stamped "not sent · Retry" onto
        // messages the recipient had already read. "failed" — and
        // therefore Retry — is reserved for genuine refusals: an
        // explicit negative ack or no socket at all. Nothing here can
        // regress delivered/read, and readAt is final.
        const onAck = (evidence: "delivered" | "rejected" | "unknown") => {
          mutateMessage(conversationId, message.id, (m) => {
            if (m.authorId !== ME) return m;
            const progressed =
              m.readAt != null || m.status === "delivered" || m.status === "failed";
            if (progressed) return m;
            switch (evidence) {
              case "delivered":
                return { ...m, status: "delivered" };
              case "rejected":
                return { ...m, status: "failed" };
              case "unknown":
                return m.status === "sending" ? { ...m, status: "sent" } : m;
            }
          });
        };

        if (conversation.kind === "community" && conversation.communityId) {
          sendCommunityMessage(conversation.communityId, wire, onAck);
          return;
        }

        const contact = get().contacts.find(
          (item) => item.id === conversation.contactId
        );
        if (!contact) return;

        if (contact.id.startsWith("u-")) {
          sendDm(contact.username, wire, onAck);
        } else {
          scheduleReply(conversationId, contact.id);
        }
      };

      /** Resolve a conversation to where its mutations (edit/delete/
       *  react/read) should be sent — same routing deliver() uses. */
      const resolveTarget = (
        conversationId: string
      ): { kind: "community"; communityId: string } | { kind: "dm"; username: string } | null => {
        const conversation = get().conversations.find(
          (item) => item.id === conversationId
        );
        if (!conversation) return null;

        if (conversation.kind === "community" && conversation.communityId) {
          return { kind: "community", communityId: conversation.communityId };
        }

        const contact = get().contacts.find(
          (item) => item.id === conversation.contactId
        );
        if (!contact || !contact.id.startsWith("u-")) return null; // demo contacts have no live peer
        return { kind: "dm", username: contact.username };
      };

      /** Apply a mutation to one message across every store update path —
       *  local optimistic edits AND incoming events use the same shape. */
      const mutateMessage = (
        conversationId: string,
        messageId: string,
        mutate: (message: Message) => Message
      ) => {
        set((state) => {
          const thread = state.messages[conversationId];
          if (!thread) return state;
          const index = thread.findIndex((m) => m.id === messageId);
          if (index === -1) return state;

          const nextThread = [...thread];
          nextThread[index] = mutate(nextThread[index]);
          return {
            messages: { ...state.messages, [conversationId]: nextThread },
          };
        });
      };

      /** Toggle one user's reaction — the exact same logic runs whether
       *  it's MY reaction (optimistic, local username) or an incoming
       *  event (their username) so both sides converge identically. */
      const toggleReaction = (
        reactions: MessageReaction[] | undefined,
        username: string,
        emoji: string
      ): MessageReaction[] => {
        const list = reactions ?? [];
        const existing = list.find((r) => r.emoji === emoji);

        if (!existing) {
          return [...list, { emoji, usernames: [username] }];
        }
        if (existing.usernames.includes(username)) {
          const usernames = existing.usernames.filter((u) => u !== username);
          return usernames.length === 0
            ? list.filter((r) => r.emoji !== emoji)
            : list.map((r) => (r.emoji === emoji ? { ...r, usernames } : r));
        }
        return list.map((r) =>
          r.emoji === emoji ? { ...r, usernames: [...r.usernames, username] } : r
        );
      };

      return {
        hasHydrated: false,
        live: false,
        connectionPhase: "connecting",
        contacts: [],
        conversations: [],
        messages: {},
        connections: {},
        communities: {},
        communityInvites: {},
        muted: [],
        communityActionError: null,
        rosterUsernames: [],
        hiddenFrom: [],
        activeConversationId: null,
        typing: [],

        setHasHydrated: (value) => set({ hasHydrated: value }),
        setLiveStatus: (live) =>
          set((state) => ({
            live,
            // Losing the socket goes back to "connecting" (retries are
            // infinite); only the grace timer may declare "offline".
            connectionPhase: live
              ? "live"
              : state.connectionPhase === "live"
                ? "connecting"
                : state.connectionPhase,
          })),
        setConnectionPhase: (phase) => set({ connectionPhase: phase }),

        ensureSeeded: () => {
          if (get().contacts.length > 0) return;

          const now = Date.now();
          const priya = SEED_CONTACTS[0]!;
          const conversationId = uid();

          set({
            contacts: SEED_CONTACTS,
            conversations: [
              {
                id: conversationId,
                kind: "dm",
                contactId: priya.id,
                unread: 1,
                lastMessageAt: now - 5 * 60_000,
              },
            ],
            messages: {
              [conversationId]: [
                {
                  id: uid(),
                  authorId: priya.id,
                  kind: "text",
                  text: "Hey! Welcome to Tabcom 👋 Try sharing the tab you're on — hit the link button in the composer.",
                  sentAt: now - 5 * 60_000,
                },
              ],
            },
          });
        },

        openConversation: (conversationId) =>
          set((state) => ({
            activeConversationId: conversationId,
            conversations: state.conversations.map((conversation) =>
              conversation.id === conversationId
                ? { ...conversation, unread: 0 }
                : conversation
            ),
          })),

        closeConversation: () => set({ activeConversationId: null }),

        startConversation: (contactId) => {
          const conversation = ensureConversation({ contactId });
          get().openConversation(conversation.id);
          return conversation.id;
        },

        openCommunityConversation: (communityId) => {
          const conversation = ensureConversation({ communityId });
          get().openConversation(conversation.id);
          return conversation.id;
        },

        sendText: (conversationId, text, replyToId) => {
          const trimmed = text.trim();
          if (!trimmed) return;

          const message: Message = {
            id: uid(),
            authorId: ME,
            kind: "text",
            text: trimmed,
            sentAt: Date.now(),
            // Deterministic composition: "sending" when a live transport
            // exists, an immediate honest "failed" when it doesn't — and
            // in that case DON'T emit: socket.io buffers emits made
            // while disconnected and flushes them on reconnect, which is
            // how messages labeled "not sent" were reaching recipients.
            status: get().live ? "sending" : "failed",
            replyToId,
          };

          set((state) => appendMessage(state, conversationId, message, false));
          if (get().live) deliver(conversationId, message);
        },

        sendMedia: (conversationId, media) => {
          // Payload-less kinds (contact, location) are valid without a
          // dataUrl; everything else needs one.
          const needsPayload = !["contact", "location"].includes(media.kind);
          if (needsPayload && !media.dataUrl) return;

          // `text` doubles as the conversation-list / notification
          // preview everywhere previews read message.text — so media
          // messages carry a human label there instead of an empty
          // string, and every preview surface works with no changes.
          const previewText =
            media.kind === "voice"
              ? "🎤 Voice message"
              : media.kind === "image"
                ? "📷 Photo"
                : media.kind === "video"
                  ? "🎬 Video"
                  : media.kind === "file"
                    ? `📎 ${media.fileName ?? "File"}`
                    : media.kind === "contact"
                      ? `👤 ${media.contactName ?? media.contactUsername ?? "Contact"}`
                      : "📍 Location";

          const message: Message = {
            id: uid(),
            authorId: ME,
            kind: media.kind,
            text: previewText,
            dataUrl: media.dataUrl,
            durationMs: media.durationMs,
            fileName: media.fileName,
            fileSize: media.fileSize,
            mimeType: media.mimeType,
            latitude: media.latitude,
            longitude: media.longitude,
            contactUsername: media.contactUsername,
            contactName: media.contactName,
            contactColor: media.contactColor,
            sentAt: Date.now(),
            status: get().live ? "sending" : "failed",
          };

          set((state) => appendMessage(state, conversationId, message, false));
          if (get().live) deliver(conversationId, message);
        },

        retryMessage: (conversationId, messageId) => {
          const thread = get().messages[conversationId] ?? [];
          const original = thread.find((m) => m.id === messageId);
          if (!original || original.authorId !== ME || original.status !== "failed") return;
          mutateMessage(conversationId, messageId, (m) => ({ ...m, status: "sending" }));
          deliver(conversationId, { ...original, status: "sending" });
        },

        editMessage: (conversationId, messageId, text) => {
          const trimmed = text.trim();
          if (!trimmed) return;
          const target = resolveTarget(conversationId);
          if (!target) return;

          const editedAt = Date.now();
          mutateMessage(conversationId, messageId, (message) =>
            message.authorId === ME
              ? { ...message, text: trimmed, editedAt }
              : message
          );

          if (target.kind === "community") {
            editCommunityMessage(target.communityId, messageId, trimmed);
          } else {
            editDm(target.username, messageId, trimmed);
          }
        },

        deleteMessage: (conversationId, messageId) => {
          const target = resolveTarget(conversationId);
          if (!target) return;

          mutateMessage(conversationId, messageId, (message) =>
            message.authorId === ME
              ? { ...message, deletedAt: Date.now(), text: "" }
              : message
          );

          if (target.kind === "community") {
            deleteCommunityMessage(target.communityId, messageId);
          } else {
            deleteDm(target.username, messageId);
          }
        },

        reactToMessage: (conversationId, messageId, emoji) => {
          const target = resolveTarget(conversationId);
          if (!target) return;
          const myUsername = useProfileStore.getState().username;
          if (!myUsername) return;

          mutateMessage(conversationId, messageId, (message) => ({
            ...message,
            reactions: toggleReaction(message.reactions, myUsername, emoji),
          }));

          if (target.kind === "community") {
            reactToCommunityMessage(target.communityId, messageId, emoji);
          } else {
            reactToDm(target.username, messageId, emoji);
          }
        },

        markMessageRead: (conversationId, messageId) => {
          const target = resolveTarget(conversationId);
          if (!target || target.kind !== "dm") return; // DM read receipts only, this pass
          markDmRead(target.username, messageId);
        },

        replyTargets: {},
        setReplyTarget: (conversationId, messageId) =>
          set((state) => ({
            replyTargets: { ...state.replyTargets, [conversationId]: messageId },
          })),

        receiveDmEdited: (fromUsername, messageId, text, editedAt) => {
          const conversation = ensureConversation(
            { contactId: `u-${fromUsername}` },
            editedAt
          );
          mutateMessage(conversation.id, messageId, (message) => ({
            ...message,
            text,
            editedAt,
          }));
        },

        receiveDmDeleted: (fromUsername, messageId) => {
          const conversation = ensureConversation(
            { contactId: `u-${fromUsername}` },
            Date.now()
          );
          mutateMessage(conversation.id, messageId, (message) => ({
            ...message,
            deletedAt: Date.now(),
            text: "",
          }));
        },

        receiveDmReaction: (fromUsername, messageId, emoji) => {
          const conversation = ensureConversation(
            { contactId: `u-${fromUsername}` },
            Date.now()
          );
          mutateMessage(conversation.id, messageId, (message) => ({
            ...message,
            reactions: toggleReaction(message.reactions, fromUsername, emoji),
          }));
        },

        receiveDmReadReceipt: (fromUsername, messageId, readAt) => {
          const conversation = ensureConversation(
            { contactId: `u-${fromUsername}` },
            readAt
          );
          mutateMessage(conversation.id, messageId, (message) =>
            message.authorId === ME
              ? {
                  ...message,
                  readAt,
                  // A read receipt is definitive proof of delivery — it
                  // heals any stale "failed"/"sending" the ack race may
                  // have left behind. States only move forward.
                  status: "delivered",
                }
              : message
          );
        },

        receiveCommunityMessageEdited: (communityId, _fromUsername, messageId, text, editedAt) => {
          const conversation = ensureConversation({ communityId }, editedAt);
          mutateMessage(conversation.id, messageId, (message) => ({
            ...message,
            text,
            editedAt,
          }));
        },

        receiveCommunityMessageDeleted: (communityId, _fromUsername, messageId) => {
          const conversation = ensureConversation({ communityId }, Date.now());
          mutateMessage(conversation.id, messageId, (message) => ({
            ...message,
            deletedAt: Date.now(),
            text: "",
          }));
        },

        receiveCommunityReaction: (communityId, fromUsername, messageId, emoji) => {
          const conversation = ensureConversation({ communityId }, Date.now());
          mutateMessage(conversation.id, messageId, (message) => ({
            ...message,
            reactions: toggleReaction(message.reactions, fromUsername, emoji),
          }));
        },

        shareCurrentTab: async (conversationId) => {
          const [tab] = await browser.tabs.query({
            active: true,
            currentWindow: true,
          });
          if (!tab?.url) return;

          const message: Message = {
            id: uid(),
            authorId: ME,
            kind: "link",
            text: tab.title ?? tab.url,
            url: tab.url,
            sentAt: Date.now(),
          };

          set((state) => appendMessage(state, conversationId, message, false));
          deliver(conversationId, message);
        },

        toggleMute: (targetId) =>
          set((state) => ({
            muted: state.muted.includes(targetId)
              ? state.muted.filter((id) => id !== targetId)
              : [...state.muted, targetId],
          })),

        clearHistory: (conversationId) =>
          set((state) => ({
            messages: { ...state.messages, [conversationId]: [] },
          })),

        // ---- contact management --------------------------------------------

        addContactByUsername: (rawUsername) => {
          const username = rawUsername.trim().replace(/^@/, "").toLowerCase();
          if (!username) return;

          const contactId = `u-${username}`;
          const existing = get().contacts.find((c) => c.id === contactId);

          const contact: Contact = existing ?? {
            id: contactId,
            name: username,
            username,
            color: "#334155",
            presence: "offline",
          };

          if (!existing) {
            set((state) => ({ contacts: [contact, ...state.contacts] }));
          }

          get().requestConnect(contact);
          get().startConversation(contactId);
        },

        receiveConnectRequestError: (username, reason) => {
          const contactId = `u-${username}`;
          systemNotice(
            { contactId },
            reason === "unavailable"
              ? `@${username} couldn't be reached — check the username, or they may be offline/private.`
              : `Request to @${username} failed.`,
            false
          );
        },

        renameContact: (contactId, alias) =>
          set((state) => ({
            contacts: state.contacts.map((contact) =>
              contact.id === contactId
                ? { ...contact, alias: alias.trim() || undefined }
                : contact
            ),
          })),

        removeContact: (contactId) => {
          const contact = get().contacts.find((c) => c.id === contactId);
          if (!contact) return;

          if (contact.id.startsWith("u-")) {
            removeConnection(contact.username);
          }

          set((state) => {
            const conversation = state.conversations.find(
              (item) => item.contactId === contactId
            );
            const messages = { ...state.messages };
            if (conversation) delete messages[conversation.id];

            const connections = { ...state.connections };
            delete connections[contact.username];

            return {
              contacts: state.contacts.filter((c) => c.id !== contactId),
              conversations: state.conversations.filter(
                (item) => item.contactId !== contactId
              ),
              messages,
              connections,
              activeConversationId:
                state.activeConversationId === conversation?.id
                  ? null
                  : state.activeConversationId,
            };
          });
        },

        toggleHidePresence: (contact) => {
          if (!contact.id.startsWith("u-")) return;

          const hidden = !get().hiddenFrom.includes(contact.id);
          hidePresenceFrom(contact.username, hidden);

          set((state) => ({
            hiddenFrom: hidden
              ? [...state.hiddenFrom, contact.id]
              : state.hiddenFrom.filter((id) => id !== contact.id),
          }));

          systemNotice(
            { contactId: contact.id },
            hidden
              ? `You now appear offline to @${contact.username}. Messages still send and arrive normally.`
              : `You're visible to @${contact.username} again.`,
            false
          );
        },

        // ---- connections --------------------------------------------------

        connectionFor: (contact) => {
          if (!contact.id.startsWith("u-")) return "accepted";
          return get().connections[contact.username] ?? "none";
        },

        receiveConnections: (snapshot) => {
          const connections: Record<string, ConnectionStatus> = {};
          for (const item of snapshot) connections[item.username] = item.status;
          set({ connections });
        },

        receiveConnectRequest: (from) => {
          // Idempotence: the same request can arrive twice (live socket
          // + background queue drain, or a server re-send on reconnect).
          // A request already pending must not stack duplicate notices
          // or re-mark the thread unread after the user viewed it.
          if (get().connections[from.username] === "pending_in") return;

          const contactId = `u-${from.username}`;

          set((state) => ({
            connections: { ...state.connections, [from.username]: "pending_in" },
            contacts: state.contacts.some((c) => c.id === contactId)
              ? state.contacts
              : [
                  {
                    id: contactId,
                    name: from.name,
                    username: from.username,
                    color: from.color,
                    photo: from.photo,
                    presence: "online" as const,
                  },
                  ...state.contacts,
                ],
          }));

          systemNotice(
            { contactId },
            `@${from.username} wants to connect. Review the request to accept, deny, block or report.`,
            true
          );
        },

        receiveConnectUpdate: (username, status) => {
          set((state) => {
            const connections = { ...state.connections };
            if (status === "none") delete connections[username];
            else connections[username] = status;
            return { connections };
          });

          const contactId = `u-${username}`;
          if (status === "accepted") {
            systemNotice(
              { contactId },
              `You're now connected with @${username}. Say hi!`,
              true
            );
          } else if (status === "declined") {
            systemNotice(
              { contactId },
              `@${username} declined your request. You can send another one later.`,
              false
            );
          }
        },

        requestConnect: (contact) => {
          if (!contact.id.startsWith("u-")) return;
          sendConnectRequest(contact.username);
          set((state) => ({
            connections: { ...state.connections, [contact.username]: "pending_out" },
          }));
          systemNotice(
            { contactId: contact.id },
            `Connection request sent to @${contact.username}. You can chat once they accept.`,
            false
          );
        },

        respondToRequest: (contact, action) => {
          respondToConnectRequest(contact.username, action);
          if (action === "deny") {
            set((state) => {
              const connections = { ...state.connections };
              delete connections[contact.username];
              return { connections };
            });
            systemNotice({ contactId: contact.id }, "Request denied.", false);
          }
        },

        revokeConnectRequest: (contact) => {
          cancelConnectRequest(contact.username);
          set((state) => {
            const connections = { ...state.connections };
            delete connections[contact.username];
            return { connections };
          });
          systemNotice(
            { contactId: contact.id },
            `You withdrew your request to @${contact.username}.`,
            false
          );
        },

        block: (contact) => {
          blockUser(contact.username);
          set((state) => ({
            connections: { ...state.connections, [contact.username]: "blocked" },
          }));
          systemNotice(
            { contactId: contact.id },
            `You blocked @${contact.username}. They can't contact you and won't know they're blocked.`,
            false
          );
        },

        unblock: (contact) => {
          unblockUser(contact.username);
          set((state) => {
            const connections = { ...state.connections };
            delete connections[contact.username];
            return { connections };
          });
          systemNotice(
            { contactId: contact.id },
            `You unblocked @${contact.username}. Connecting again requires a new request.`,
            false
          );
        },

        report: (contact, reason) => {
          reportUser(contact.username, reason);
          set((state) => ({
            connections: { ...state.connections, [contact.username]: "blocked" },
          }));
          systemNotice(
            { contactId: contact.id },
            `You reported @${contact.username}. They've been blocked automatically.`,
            false
          );
        },

        // ---- realtime receive ---------------------------------------------

        applyRoster: (users) =>
          set((state) => {
            const rosterUsernames = new Set(users.map((u) => u.username));
            const aliasById = new Map(
              state.contacts
                .filter((c) => c.alias)
                .map((c) => [c.id, c.alias!])
            );

            const liveContacts: Contact[] = users.map((user) => ({
              id: `u-${user.username}`,
              name: user.name,
              username: user.username,
              color: user.color,
              photo: user.photo,
              presence: user.presence ?? "online",
              alias: aliasById.get(`u-${user.username}`),
            }));

            const departed = state.contacts
              .filter(
                (contact) =>
                  contact.id.startsWith("u-") &&
                  !rosterUsernames.has(contact.username)
              )
              .map((contact) => ({
                ...contact,
                presence: "offline" as const,
              }));

            const demo = state.contacts.filter((contact) =>
              contact.id.startsWith("c-")
            );

            return {
              contacts: [...liveContacts, ...departed, ...demo],
              rosterUsernames: [...rosterUsernames],
            };
          }),

        receiveDm: (from, message) => {
          // Two delivery paths exist (live socket + background buffer
          // drained on panel open) — the same id must never append twice.
          if (messageIdExists(get().messages, message.id)) return;

          const contactId = `u-${from.username}`;

          set((state) => ({
            contacts: state.contacts.some((c) => c.id === contactId)
              ? state.contacts
              : [
                  {
                    id: contactId,
                    name: from.name,
                    username: from.username,
                    color: from.color,
                    photo: from.photo,
                    presence: "online" as const,
                  },
                  ...state.contacts,
                ],
          }));

          const conversation = ensureConversation(
            { contactId },
            message.sentAt
          );

          const incoming: Message = wireToMessage(message, contactId);

          set((state) => {
            const isViewing = state.activeConversationId === conversation.id;
            return {
              ...appendMessage(
                state,
                conversation.id,
                incoming,
                !isViewing && !isMuted(contactId)
              ),
              typing: state.typing.filter((id) => id !== contactId),
            };
          });
        },

        receiveTyping: (fromUsername) => {
          const contactId = `u-${fromUsername}`;

          set((state) => ({
            typing: state.typing.includes(contactId)
              ? state.typing
              : [...state.typing, contactId],
          }));

          setTimeout(() => {
            set((state) => ({
              typing: state.typing.filter((id) => id !== contactId),
            }));
          }, 3000);
        },

        receiveDmError: (toUsername, reason) => {
          const contactId = `u-${toUsername}`;
          const conversation = get().conversations.find(
            (item) => item.contactId === contactId
          );
          if (!conversation) return;

          systemNotice(
            { contactId },
            reason === "sender_private"
              ? "Not sent — you're in private mode. Switch to public in Settings to message people."
              : reason === "not_connected"
                ? `Not sent — you're not connected with @${toUsername}.`
                : `Not delivered — @${toUsername} is unavailable (private or offline).`,
            false
          );
        },

        // ---- communities --------------------------------------------------

        createCommunity: (name) => rtCreateCommunity(name),
        restoreConnections: async () => {
          const connections = await getMyConnections();
          if (connections.length === 0) return;

          set((state) => {
            const existingUsernames = new Set(
              state.contacts.filter((c) => c.id.startsWith("u-")).map((c) => c.username)
            );
            const restored: Contact[] = connections
              .filter((c) => !existingUsernames.has(c.username))
              .map((c) => ({
                id: `u-${c.username}`,
                name: c.displayName || c.username,
                username: c.username,
                color: c.avatarColor || "#334155",
                presence: "offline" as const,
              }));

            if (restored.length === 0) return state;
            return { contacts: [...state.contacts, ...restored] };
          });
        },
        uploadCommunityImage: (communityId, mimeType, base64Data) =>
          rtSetCommunityImage(communityId, mimeType, base64Data),

        inviteToCommunity: (communityId, username) =>
          rtInviteToCommunity(communityId, username),

        respondToCommunityInvite: (communityId, action) => {
          respondToCommunityInvite(communityId, action);
          set((state) => {
            const communityInvites = { ...state.communityInvites };
            delete communityInvites[communityId];
            return { communityInvites };
          });
        },

        leaveCommunity: (communityId) => rtLeaveCommunity(communityId),
        removeCommunityMember: (communityId, username) =>
          rtRemoveCommunityMember(communityId, username),
        cancelCommunityInvite: (communityId, username) =>
          rtCancelCommunityInvite(communityId, username),
        renameCommunity: (communityId, name) =>
          rtRenameCommunity(communityId, name),
        transferCommunityAdmin: (communityId, username) =>
          rtTransferCommunityAdmin(communityId, username),
        deleteCommunity: (communityId) => rtDeleteCommunity(communityId),

        receiveDmNotice: (toUsername, reason) => {
          if (reason !== "recipient_offline") return;
          const contactId = `u-${toUsername}`;
          const conversation = get().conversations.find(
            (c) => c.kind === "dm" && c.contactId === contactId
          );
          const text = `@${toUsername} appears offline right now. Your message was delivered — they'll see it when they're back, so replies (and read receipts) may take a while.`;
          // Say it once per quiet spell, not once per message: skip if
          // this exact notice is already the latest system line.
          if (conversation) {
            const thread = get().messages[conversation.id] ?? [];
            const lastSystem = [...thread].reverse().find((m) => m.kind === "system");
            if (lastSystem?.text === text) return;
          }
          systemNotice({ contactId }, text, false);
        },

        receiveCallError: (toUsername, reason) => {
          const contactId = `u-${toUsername}`;
          const text =
            reason === "recipient_offline"
              ? `@${toUsername} appears offline — calls are unavailable until they're back. Please try again later.`
              : reason === "caller_offline"
                ? "You're appearing offline. Switch your status to Online to start calls."
                : reason === "recipient_unavailable"
                  ? `@${toUsername} isn't reachable right now — the call couldn't start.`
                  : `The call to @${toUsername} couldn't be started.`;
          systemNotice({ contactId }, text, false);
        },

        receiveCommunityDeleted: (communityId) =>
          set((state) => {
            const { [communityId]: _removed, ...rest } = state.communities;
            return {
              communities: rest,
              conversations: state.conversations.filter(
                (c) => c.communityId !== communityId
              ),
            };
          }),

        // ---- boards ---------------------------------------------------

        addCurrentTabToBoard: async (communityId) => {
          const [tab] = await browser.tabs.query({
            active: true,
            currentWindow: true,
          });
          if (!tab?.id) return;

          try {
            const response = await browser.tabs.sendMessage(tab.id, {
              type: "tabcom:read-anchor",
            });

            if (response?.ok) {
              addBoardItem({ communityId, ...response.anchor });
            } else if (tab.url) {
              // Content script unavailable on this page (e.g. chrome://) —
              // fall back to the tab's own url/title, still de-duped by
              // origin+path server-side via the generic strategy.
              addBoardItem({
                communityId,
                url: tab.url,
                canonicalKey: tab.url,
                title: tab.title ?? tab.url,
              });
            }
          } catch {
            if (tab.url) {
              addBoardItem({
                communityId,
                url: tab.url,
                canonicalKey: tab.url,
                title: tab.title ?? tab.url,
              });
            }
          }
        },

        removeBoardItem: (communityId, itemId) =>
          removeBoardItem(communityId, itemId),

        commentOnBoardItem: (communityId, itemId, text) => {
          if (!text.trim()) return;
          commentOnBoardItem(communityId, itemId, text.trim());
        },

        commentOnPin: (communityId, itemId, pinId, text) => {
          if (!text.trim()) return;
          commentOnPin(communityId, itemId, pinId, text.trim());
        },

        commentOnHighlight: (communityId, itemId, highlightId, text) => {
          if (!text.trim()) return;
          commentOnHighlight(communityId, itemId, highlightId, text.trim());
        },

        commentOnArea: (communityId, itemId, areaId, text) => {
          if (!text.trim()) return;
          commentOnArea(communityId, itemId, areaId, text.trim());
        },

        voteOnBoardItem: (communityId, itemId) =>
          voteOnBoardItem(communityId, itemId),

        decideBoardItem: (communityId, itemId) =>
          decideBoardItem(communityId, itemId),

        receiveCommunities: (list) => {
          const communities: Record<string, Community> = {};
          const communityInvites: Record<string, CommunityInvite> = {};

          for (const wire of list) {
            if (wire.pendingForMe) {
              communityInvites[wire.id] = {
                community: wire,
                from: {
                  username: wire.admin,
                  name: wire.admin,
                  color: "#334155",
                  visibility: "public",
                },
                attempt: 0,
              };
            } else {
              communities[wire.id] = toCommunity(wire);
            }
          }

          set({ communities, communityInvites });
        },

        receiveCommunityUpdate: (wire) => {
          set((state) => ({
            communities: { ...state.communities, [wire.id]: toCommunity(wire) },
          }));
        },

        receiveCommunityInvite: (community, from, attempt) => {
          set((state) => ({
            communityInvites: {
              ...state.communityInvites,
              [community.id]: { community, from, attempt },
            },
          }));
        },

        receiveCommunityDeclined: ({
          communityId,
          communityName,
          username,
          attemptsLeft,
          barred,
        }) => {
          systemNotice(
            { communityId },
            barred
              ? `@${username} left/declined "${communityName}". Invite limit reached — they can no longer be added to this community.`
              : `@${username} left/declined "${communityName}". You can invite them ${attemptsLeft} more time${attemptsLeft === 1 ? "" : "s"}.`,
            true
          );
        },

        receiveCommunityLeft: (communityId) => {
          set((state) => {
            const communities = { ...state.communities };
            delete communities[communityId];
            return { communities };
          });
        },

        receiveCommunityInviteCancelled: (communityId) => {
          set((state) => {
            const communityInvites = { ...state.communityInvites };
            delete communityInvites[communityId];
            return { communityInvites };
          });
        },

        receiveCommunityMessage: (communityId, from, message) => {
          if (messageIdExists(get().messages, message.id)) return;

          const community = get().communities[communityId];
          if (!community) return;

          const conversation = ensureConversation(
            { communityId },
            message.sentAt
          );

          const incoming: Message = wireToMessage(message, `u-${from.username}`, {
            authorName: from.name,
            authorColor: from.color,
          });

          set((state) => {
            const isViewing = state.activeConversationId === conversation.id;
            return appendMessage(
              state,
              conversation.id,
              incoming,
              !isViewing && !isMuted(communityId)
            );
          });
        },

        receiveCommunityError: ({ communityId, username, reason }) => {
          systemNotice(
            { communityId },
            reason === "invite_limit"
              ? `Can't invite @${username} — the 3-invite limit for this community has been reached.`
              : reason === "already_pending"
                ? `@${username} already has a pending invite to this community.`
                : `Can't invite @${username} — you can only invite accepted connections.`,
            false
          );
          set({ communityActionError: { communityId, username, reason } });
        },

        clearCommunityActionError: () => set({ communityActionError: null }),

        resetChat: () =>
          set({
            contacts: [],
            conversations: [],
            messages: {},
            connections: {},
            communities: {},
            communityInvites: {},
            muted: [],
            communityActionError: null,
            rosterUsernames: [],
            hiddenFrom: [],
            activeConversationId: null,
            typing: [],
          }),

        clearAllHistory: () =>
          set({
            conversations: [],
            messages: {},
            activeConversationId: null,
            typing: [],
            communityActionError: null,
          }),
      };
    },
    {
      name: "tabcom:chat",
      version: 1,
      storage: createJSONStorage(() => extensionStorage),
      partialize: (state) => ({
        contacts: state.contacts,
        conversations: state.conversations,
        messages: state.messages,
        muted: state.muted,
        // Connection statuses are persisted so a freshly opened panel
        // renders the LAST KNOWN state ("accepted" stays accepted)
        // instead of flashing "none" → Send Request until the server's
        // connections snapshot arrives. The snapshot remains the
        // authority — it fully overwrites this on every connect.
        connections: state.connections,
        // Communities carry board data (items/pins/highlights) which the
        // content script reads passively from storage on page load —
        // without persisting them, on-page annotations cannot render.
        communities: state.communities,
      }),
      migrate: (persisted: unknown, version) => {
        const state = persisted as {
          conversations?: Array<Record<string, unknown>>;
        };
        if (version === 0 && state?.conversations) {
          state.conversations = state.conversations.map((c) => ({
            kind: "dm",
            ...c,
          }));
        }
        return state as never;
      },
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
        state?.ensureSeeded();
      },
    }
  )
);
