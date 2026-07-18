import { create } from "zustand";
import type {
  Contact,
  Conversation,
  Message,
  MessageReaction,
  WireMessage,
  WireUser,
  Community,
  WireCommunity,
  ConnectionStatus,
} from "@tabcom/shared";
import {
  sendDm,
  editDm,
  deleteDm,
  reactToDm,
  markDmRead,
  sendTyping,
  sendConnectRequest,
  respondToConnectRequest,
  cancelConnectRequest,
  getMyConnections,
  blockUser,
  unblockUser,
  reportUser,
  removeConnection,
  sendCommunityMessage,
  editCommunityMessage,
  deleteCommunityMessage,
  reactToCommunityMessage,
  commentOnBoardItem as rtCommentOnBoardItem,
  voteOnBoardItem as rtVoteOnBoardItem,
  createCommunity as rtCreateCommunity,
  inviteToCommunity as rtInviteToCommunity,
  respondToCommunityInvite as rtRespondToCommunityInvite,
  leaveCommunity as rtLeaveCommunity,
  removeCommunityMember as rtRemoveCommunityMember,
  cancelCommunityInvite as rtCancelCommunityInvite,
  renameCommunity as rtRenameCommunity,
  transferCommunityAdmin as rtTransferCommunityAdmin,
  deleteCommunity as rtDeleteCommunity,
  hidePresenceFrom,
} from "@/lib/realtime";
import { useAuth } from "./auth";

/**
 * Mobile chat store — adapted from the extension's chat.store.ts.
 *
 * Key differences:
 *   - No seed contacts (mobile is live-only, no demo data)
 *   - No browser.tabs (no tab sharing — mobile adds URL sharing later)
 *   - No extension storage persistence (uses in-memory for now;
 *     AsyncStorage persistence can be added when needed)
 *   - Simplified: no floating chat, no board add-current-tab
 */

const ME = "me";

function uid(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
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

function wireToMessage(
  wire: WireMessage,
  authorId: string,
  extras?: Partial<Message>
): Message {
  return {
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
  };
}

interface CommunityInvite {
  community: WireCommunity;
  from: WireUser;
  attempt: number;
}

interface ChatState {
  contacts: Contact[];
  conversations: Conversation[];
  messages: Record<string, Message[]>;
  connections: Record<string, ConnectionStatus>;
  communities: Record<string, Community>;
  communityInvites: Record<string, CommunityInvite>;
  muted: string[];
  rosterUsernames: string[];
  activeConversationId: string | null;
  typing: string[];
  connected: boolean;

  // actions
  setConnected: (v: boolean) => void;
  openConversation: (id: string) => void;
  closeConversation: () => void;
  startConversation: (contactId: string) => string;
  openCommunityConversation: (communityId: string) => string;

  sendText: (conversationId: string, text: string, replyToId?: string) => void;
  editMessage: (conversationId: string, messageId: string, text: string) => void;
  deleteMessage: (conversationId: string, messageId: string) => void;
  reactToMessage: (conversationId: string, messageId: string, emoji: string) => void;
  markMessageRead: (conversationId: string, messageId: string) => void;
  retryMessage: (conversationId: string, messageId: string) => void;
  emitTyping: (toUsername: string) => void;

  // receive
  applyRoster: (users: WireUser[]) => void;
  receiveDm: (from: WireUser, message: WireMessage) => void;
  receiveTyping: (fromUsername: string) => void;
  receiveDmEdited: (from: string, messageId: string, text: string, editedAt: number) => void;
  receiveDmDeleted: (from: string, messageId: string) => void;
  receiveDmReaction: (from: string, messageId: string, emoji: string) => void;
  receiveDmReadReceipt: (from: string, messageId: string, readAt: number) => void;
  receiveDmError: (to: string, reason: string) => void;

  // connections
  receiveConnections: (snapshot: Array<{ username: string; status: ConnectionStatus }>) => void;
  receiveConnectRequest: (from: WireUser) => void;
  receiveConnectUpdate: (username: string, status: ConnectionStatus) => void;
  addContactByUsername: (username: string) => void;
  respondToRequest: (contact: Contact, action: "accept" | "deny") => void;
  removeContact: (contactId: string) => void;
  block: (contact: Contact) => void;
  unblock: (contact: Contact) => void;

  // communities
  receiveCommunities: (list: WireCommunity[]) => void;
  receiveCommunityUpdate: (community: WireCommunity) => void;
  receiveCommunityInvite: (community: WireCommunity, from: WireUser, attempt: number) => void;
  receiveCommunityMessage: (communityId: string, from: WireUser, message: WireMessage) => void;
  receiveCommunityMessageEdited: (communityId: string, from: string, messageId: string, text: string, editedAt: number) => void;
  receiveCommunityMessageDeleted: (communityId: string, from: string, messageId: string) => void;
  receiveCommunityReaction: (communityId: string, from: string, messageId: string, emoji: string) => void;
  receiveCommunityLeft: (communityId: string) => void;
  receiveCommunityDeleted: (communityId: string) => void;

  restoreConnections: () => Promise<void>;
  resetChat: () => void;
}

function appendMessage(
  state: Pick<ChatState, "messages" | "conversations">,
  conversationId: string,
  message: Message,
  incrementUnread: boolean
) {
  const thread = state.messages[conversationId] ?? [];
  if (thread.some((m) => m.id === message.id)) {
    return { messages: state.messages, conversations: state.conversations };
  }
  return {
    messages: {
      ...state.messages,
      [conversationId]: [...thread, message],
    },
    conversations: state.conversations
      .map((c) =>
        c.id === conversationId
          ? {
              ...c,
              lastMessageAt: message.sentAt,
              unread: incrementUnread ? c.unread + 1 : c.unread,
            }
          : c
      )
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt),
  };
}

function toggleReaction(
  reactions: MessageReaction[] | undefined,
  username: string,
  emoji: string
): MessageReaction[] {
  const list = reactions ?? [];
  const existing = list.find((r) => r.emoji === emoji);
  if (!existing) return [...list, { emoji, usernames: [username] }];
  if (existing.usernames.includes(username)) {
    const usernames = existing.usernames.filter((u) => u !== username);
    return usernames.length === 0
      ? list.filter((r) => r.emoji !== emoji)
      : list.map((r) => (r.emoji === emoji ? { ...r, usernames } : r));
  }
  return list.map((r) =>
    r.emoji === emoji ? { ...r, usernames: [...r.usernames, username] } : r
  );
}

export const useChatStore = create<ChatState>()((set, get) => {
  const ensureConversation = (
    target: { contactId?: string; communityId?: string },
    stamp = Date.now()
  ): Conversation => {
    const existing = get().conversations.find((c) =>
      target.contactId
        ? c.contactId === target.contactId
        : c.communityId === target.communityId
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

  const mutateMessage = (
    conversationId: string,
    messageId: string,
    mutate: (m: Message) => Message
  ) => {
    set((state) => {
      const thread = state.messages[conversationId];
      if (!thread) return state;
      const idx = thread.findIndex((m) => m.id === messageId);
      if (idx === -1) return state;
      const next = [...thread];
      next[idx] = mutate(next[idx]);
      return { messages: { ...state.messages, [conversationId]: next } };
    });
  };

  const resolveTarget = (
    conversationId: string
  ): { kind: "community"; communityId: string } | { kind: "dm"; username: string } | null => {
    const c = get().conversations.find((x) => x.id === conversationId);
    if (!c) return null;
    if (c.kind === "community" && c.communityId) return { kind: "community", communityId: c.communityId };
    const contact = get().contacts.find((x) => x.id === c.contactId);
    if (!contact) return null;
    return { kind: "dm", username: contact.username };
  };

  const systemNotice = (
    target: { contactId?: string; communityId?: string },
    text: string,
    unread: boolean
  ) => {
    const c = ensureConversation(target);
    const notice: Message = { id: uid(), authorId: "system", kind: "system", text, sentAt: Date.now() };
    set((state) => {
      const isViewing = state.activeConversationId === c.id;
      return appendMessage(state, c.id, notice, unread && !isViewing);
    });
  };

  const deliver = (conversationId: string, message: Message) => {
    if (message.kind === "system") return;
    const c = get().conversations.find((x) => x.id === conversationId);
    if (!c) return;

    const wire: WireMessage = {
      id: message.id, kind: message.kind, text: message.text,
      url: message.url, dataUrl: message.dataUrl, durationMs: message.durationMs,
      fileName: message.fileName, fileSize: message.fileSize, mimeType: message.mimeType,
      latitude: message.latitude, longitude: message.longitude,
      contactUsername: message.contactUsername, contactName: message.contactName,
      contactColor: message.contactColor, sentAt: message.sentAt, replyToId: message.replyToId,
    };

    const onAck = (evidence: "delivered" | "rejected" | "unknown") => {
      mutateMessage(conversationId, message.id, (m) => {
        if (m.authorId !== ME) return m;
        if (m.readAt != null || m.status === "delivered" || m.status === "failed") return m;
        switch (evidence) {
          case "delivered": return { ...m, status: "delivered" };
          case "rejected": return { ...m, status: "failed" };
          case "unknown": return m.status === "sending" ? { ...m, status: "sent" } : m;
        }
      });
    };

    if (c.kind === "community" && c.communityId) {
      sendCommunityMessage(c.communityId, wire, onAck);
      return;
    }
    const contact = get().contacts.find((x) => x.id === c.contactId);
    if (contact) sendDm(contact.username, wire, onAck);
  };

  return {
    contacts: [],
    conversations: [],
    messages: {},
    connections: {},
    communities: {},
    communityInvites: {},
    muted: [],
    rosterUsernames: [],
    activeConversationId: null,
    typing: [],
    connected: false,

    setConnected: (v) => set({ connected: v }),

    openConversation: (id) =>
      set((state) => ({
        activeConversationId: id,
        conversations: state.conversations.map((c) =>
          c.id === id ? { ...c, unread: 0 } : c
        ),
      })),

    closeConversation: () => set({ activeConversationId: null }),

    startConversation: (contactId) => {
      const c = ensureConversation({ contactId });
      get().openConversation(c.id);
      return c.id;
    },

    openCommunityConversation: (communityId) => {
      const c = ensureConversation({ communityId });
      get().openConversation(c.id);
      return c.id;
    },

    sendText: (conversationId, text, replyToId) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const message: Message = {
        id: uid(), authorId: ME, kind: "text", text: trimmed,
        sentAt: Date.now(), status: get().connected ? "sending" : "failed",
        replyToId,
      };
      set((state) => appendMessage(state, conversationId, message, false));
      if (get().connected) deliver(conversationId, message);
    },

    editMessage: (conversationId, messageId, text) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const target = resolveTarget(conversationId);
      if (!target) return;
      const editedAt = Date.now();
      mutateMessage(conversationId, messageId, (m) =>
        m.authorId === ME ? { ...m, text: trimmed, editedAt } : m
      );
      if (target.kind === "community") editCommunityMessage(target.communityId, messageId, trimmed);
      else editDm(target.username, messageId, trimmed);
    },

    deleteMessage: (conversationId, messageId) => {
      const target = resolveTarget(conversationId);
      if (!target) return;
      mutateMessage(conversationId, messageId, (m) =>
        m.authorId === ME ? { ...m, deletedAt: Date.now(), text: "" } : m
      );
      if (target.kind === "community") deleteCommunityMessage(target.communityId, messageId);
      else deleteDm(target.username, messageId);
    },

    reactToMessage: (conversationId, messageId, emoji) => {
      const target = resolveTarget(conversationId);
      if (!target) return;
      const myUsername = useAuth.getState().user?.username;
      if (!myUsername) return;
      mutateMessage(conversationId, messageId, (m) => ({
        ...m, reactions: toggleReaction(m.reactions, myUsername, emoji),
      }));
      if (target.kind === "community") reactToCommunityMessage(target.communityId, messageId, emoji);
      else reactToDm(target.username, messageId, emoji);
    },

    markMessageRead: (conversationId, messageId) => {
      const target = resolveTarget(conversationId);
      if (!target || target.kind !== "dm") return;
      markDmRead(target.username, messageId);
    },

    retryMessage: (conversationId, messageId) => {
      const thread = get().messages[conversationId] ?? [];
      const original = thread.find((m) => m.id === messageId);
      if (!original || original.authorId !== ME || original.status !== "failed") return;
      mutateMessage(conversationId, messageId, (m) => ({ ...m, status: "sending" }));
      deliver(conversationId, { ...original, status: "sending" });
    },

    emitTyping: (toUsername) => sendTyping(toUsername),

    // ── Receive handlers ──
    applyRoster: (users) =>
      set((state) => {
        const rosterUsernames = new Set(users.map((u) => u.username));
        const aliasById = new Map(
          state.contacts.filter((c) => c.alias).map((c) => [c.id, c.alias!])
        );
        const liveContacts: Contact[] = users.map((u) => ({
          id: `u-${u.username}`, name: u.name, username: u.username,
          color: u.color, photo: u.photo, presence: u.presence ?? "online",
          alias: aliasById.get(`u-${u.username}`),
        }));
        const departed = state.contacts
          .filter((c) => c.id.startsWith("u-") && !rosterUsernames.has(c.username))
          .map((c) => ({ ...c, presence: "offline" as const }));
        return {
          contacts: [...liveContacts, ...departed],
          rosterUsernames: [...rosterUsernames],
        };
      }),

    receiveDm: (from, message) => {
      const contactId = `u-${from.username}`;
      set((state) => ({
        contacts: state.contacts.some((c) => c.id === contactId)
          ? state.contacts
          : [{ id: contactId, name: from.name, username: from.username, color: from.color, photo: from.photo, presence: "online" as const }, ...state.contacts],
      }));
      const c = ensureConversation({ contactId }, message.sentAt);
      const incoming = wireToMessage(message, contactId);
      set((state) => {
        const isViewing = state.activeConversationId === c.id;
        return {
          ...appendMessage(state, c.id, incoming, !isViewing),
          typing: state.typing.filter((id) => id !== contactId),
        };
      });
    },

    receiveTyping: (fromUsername) => {
      const contactId = `u-${fromUsername}`;
      set((state) => ({
        typing: state.typing.includes(contactId) ? state.typing : [...state.typing, contactId],
      }));
      setTimeout(() => {
        set((state) => ({ typing: state.typing.filter((id) => id !== contactId) }));
      }, 3000);
    },

    receiveDmEdited: (from, messageId, text, editedAt) => {
      const c = ensureConversation({ contactId: `u-${from}` }, editedAt);
      mutateMessage(c.id, messageId, (m) => ({ ...m, text, editedAt }));
    },
    receiveDmDeleted: (from, messageId) => {
      const c = ensureConversation({ contactId: `u-${from}` });
      mutateMessage(c.id, messageId, (m) => ({ ...m, deletedAt: Date.now(), text: "" }));
    },
    receiveDmReaction: (from, messageId, emoji) => {
      const c = ensureConversation({ contactId: `u-${from}` });
      mutateMessage(c.id, messageId, (m) => ({
        ...m, reactions: toggleReaction(m.reactions, from, emoji),
      }));
    },
    receiveDmReadReceipt: (from, messageId, readAt) => {
      const c = ensureConversation({ contactId: `u-${from}` }, readAt);
      mutateMessage(c.id, messageId, (m) =>
        m.authorId === ME ? { ...m, readAt, status: "delivered" } : m
      );
    },
    receiveDmError: (toUsername, reason) => {
      systemNotice(
        { contactId: `u-${toUsername}` },
        reason === "not_connected"
          ? `Not sent — you're not connected with @${toUsername}.`
          : `Not delivered — @${toUsername} is unavailable.`,
        false
      );
    },

    // ── Connections ──
    receiveConnections: (snapshot) => {
      const connections: Record<string, ConnectionStatus> = {};
      for (const item of snapshot) connections[item.username] = item.status;
      set({ connections });
    },

    receiveConnectRequest: (from) => {
      if (get().connections[from.username] === "pending_in") return;
      const contactId = `u-${from.username}`;
      set((state) => ({
        connections: { ...state.connections, [from.username]: "pending_in" },
        contacts: state.contacts.some((c) => c.id === contactId)
          ? state.contacts
          : [{ id: contactId, name: from.name, username: from.username, color: from.color, photo: from.photo, presence: "online" as const }, ...state.contacts],
      }));
      systemNotice({ contactId }, `@${from.username} wants to connect.`, true);
    },

    receiveConnectUpdate: (username, status) => {
      set((state) => {
        const connections = { ...state.connections };
        if (status === "none") delete connections[username];
        else connections[username] = status;
        return { connections };
      });
      if (status === "accepted") {
        systemNotice({ contactId: `u-${username}` }, `You're now connected with @${username}!`, true);
      }
    },

    addContactByUsername: (rawUsername) => {
      const username = rawUsername.trim().replace(/^@/, "").toLowerCase();
      if (!username) return;
      const contactId = `u-${username}`;
      if (!get().contacts.some((c) => c.id === contactId)) {
        set((state) => ({
          contacts: [{ id: contactId, name: username, username, color: "#334155", presence: "offline" as const }, ...state.contacts],
        }));
      }
      sendConnectRequest(username);
      get().startConversation(contactId);
    },

    respondToRequest: (contact, action) => {
      respondToConnectRequest(contact.username, action);
      if (action === "deny") {
        set((state) => {
          const connections = { ...state.connections };
          delete connections[contact.username];
          return { connections };
        });
      }
    },

    removeContact: (contactId) => {
      const contact = get().contacts.find((c) => c.id === contactId);
      if (!contact) return;
      removeConnection(contact.username);
      set((state) => {
        const conversation = state.conversations.find((c) => c.contactId === contactId);
        const messages = { ...state.messages };
        if (conversation) delete messages[conversation.id];
        const connections = { ...state.connections };
        delete connections[contact.username];
        return {
          contacts: state.contacts.filter((c) => c.id !== contactId),
          conversations: state.conversations.filter((c) => c.contactId !== contactId),
          messages, connections,
        };
      });
    },

    block: (contact) => {
      blockUser(contact.username);
      set((state) => ({ connections: { ...state.connections, [contact.username]: "blocked" } }));
    },

    unblock: (contact) => {
      unblockUser(contact.username);
      set((state) => {
        const connections = { ...state.connections };
        delete connections[contact.username];
        return { connections };
      });
    },

    // ── Communities ──
    receiveCommunities: (list) => {
      const communities: Record<string, Community> = {};
      const communityInvites: Record<string, CommunityInvite> = {};
      for (const wire of list) {
        if (wire.pendingForMe) {
          communityInvites[wire.id] = {
            community: wire,
            from: { username: wire.admin, name: wire.admin, color: "#334155", visibility: "public" },
            attempt: 0,
          };
        } else {
          communities[wire.id] = toCommunity(wire);
        }
      }
      set({ communities, communityInvites });
    },

    receiveCommunityUpdate: (wire) =>
      set((state) => ({ communities: { ...state.communities, [wire.id]: toCommunity(wire) } })),

    receiveCommunityInvite: (community, from, attempt) =>
      set((state) => ({
        communityInvites: { ...state.communityInvites, [community.id]: { community, from, attempt } },
      })),

    receiveCommunityMessage: (communityId, from, message) => {
      const community = get().communities[communityId];
      if (!community) return;
      const c = ensureConversation({ communityId }, message.sentAt);
      const incoming = wireToMessage(message, `u-${from.username}`, {
        authorName: from.name, authorColor: from.color,
      });
      set((state) => {
        const isViewing = state.activeConversationId === c.id;
        return appendMessage(state, c.id, incoming, !isViewing);
      });
    },

    receiveCommunityMessageEdited: (communityId, _from, messageId, text, editedAt) => {
      const c = ensureConversation({ communityId }, editedAt);
      mutateMessage(c.id, messageId, (m) => ({ ...m, text, editedAt }));
    },
    receiveCommunityMessageDeleted: (communityId, _from, messageId) => {
      const c = ensureConversation({ communityId });
      mutateMessage(c.id, messageId, (m) => ({ ...m, deletedAt: Date.now(), text: "" }));
    },
    receiveCommunityReaction: (communityId, from, messageId, emoji) => {
      const c = ensureConversation({ communityId });
      mutateMessage(c.id, messageId, (m) => ({
        ...m, reactions: toggleReaction(m.reactions, from, emoji),
      }));
    },

    receiveCommunityLeft: (communityId) =>
      set((state) => {
        const { [communityId]: _, ...rest } = state.communities;
        return { communities: rest };
      }),
    receiveCommunityDeleted: (communityId) =>
      set((state) => {
        const { [communityId]: _, ...rest } = state.communities;
        return {
          communities: rest,
          conversations: state.conversations.filter((c) => c.communityId !== communityId),
        };
      }),

    restoreConnections: async () => {
      const connections = await getMyConnections();
      if (connections.length === 0) return;
      set((state) => {
        const existing = new Set(state.contacts.filter((c) => c.id.startsWith("u-")).map((c) => c.username));
        const restored: Contact[] = connections
          .filter((c) => !existing.has(c.username))
          .map((c) => ({
            id: `u-${c.username}`, name: c.displayName || c.username,
            username: c.username, color: c.avatarColor || "#334155", presence: "offline" as const,
          }));
        if (restored.length === 0) return state;
        return { contacts: [...state.contacts, ...restored] };
      });
    },

    resetChat: () =>
      set({
        contacts: [], conversations: [], messages: {}, connections: {},
        communities: {}, communityInvites: {}, muted: [], rosterUsernames: [],
        activeConversationId: null, typing: [],
      }),
  };
});
