#!/bin/bash
set -euo pipefail

# ─── Build 5: Chat ───────────────────────────────────────────────────
# Run from: tabcom root
# Creates/overwrites:
#   apps/mobile/src/stores/chat.ts              (new — chat data store)
#   apps/mobile/app/(tabs)/index.tsx            (overwrite — conversation list)
#   apps/mobile/app/conversation/[id].tsx       (new — message thread screen)
#   apps/mobile/src/components/MessageBubble.tsx (new — message renderer)
# ──────────────────────────────────────────────────────────────────────

echo "🔧 Build 5: applying chat..."

if [ ! -f "package.json" ] || ! grep -q '"tabcom"' package.json; then
  echo "❌ Run this from the tabcom monorepo root."
  exit 1
fi

mkdir -p apps/mobile/src/stores apps/mobile/src/components apps/mobile/app/conversation

# ── 1. Chat store ──
cat > apps/mobile/src/stores/chat.ts << 'CHATSTORE'
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
CHATSTORE

# ── 2. Wire chat store into realtime store handlers ──
cat > apps/mobile/src/stores/realtime.ts << 'RSEOF'
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
import { REALTIME_URL } from "@/lib/config";
import {
  initRealtime,
  disconnectRealtime,
  isRealtimeConnected,
} from "@/lib/realtime";

type RealtimeState = {
  connected: boolean;
  callSignalListeners: Array<(payload: IncomingCallSignal) => void>;
  connect: () => void;
  disconnect: () => void;
};

export const useRealtime = create<RealtimeState>((set, get) => ({
  connected: false,
  callSignalListeners: [],

  connect: () => {
    if (isRealtimeConnected()) return;

    const auth = useAuth.getState();
    if (!auth.sessionToken || !auth.user) return;

    const chat = useChatStore.getState();

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
      },
      onRoster: (users) => useChatStore.getState().applyRoster(users),

      // DM
      onDm: (from, msg) => useChatStore.getState().receiveDm(from, msg),
      onDmEdited: (from, id, text, at) => useChatStore.getState().receiveDmEdited(from, id, text, at),
      onDmDeleted: (from, id) => useChatStore.getState().receiveDmDeleted(from, id),
      onDmReaction: (from, id, emoji) => useChatStore.getState().receiveDmReaction(from, id, emoji),
      onDmReadReceipt: (from, id, at) => useChatStore.getState().receiveDmReadReceipt(from, id, at),
      onTyping: (from) => useChatStore.getState().receiveTyping(from),
      onDmError: (to, reason) => useChatStore.getState().receiveDmError(to, reason),

      // Connections
      onConnections: (snapshot) => useChatStore.getState().receiveConnections(snapshot),
      onConnectRequest: (from) => useChatStore.getState().receiveConnectRequest(from),
      onConnectUpdate: (username, status) => useChatStore.getState().receiveConnectUpdate(username, status),

      // Communities
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

      // Calls
      onCallSignal: (payload) => {
        get().callSignalListeners.forEach((fn) => fn(payload));
      },
    };

    initRealtime(me, handlers, REALTIME_URL, auth.sessionToken);

    // Restore durable connections from server after socket connects
    setTimeout(() => useChatStore.getState().restoreConnections(), 2000);
  },

  disconnect: () => {
    disconnectRealtime();
    set({ connected: false });
  },
}));
RSEOF

# ── 3. MessageBubble component ──
cat > apps/mobile/src/components/MessageBubble.tsx << 'MBEOF'
import { Text, View, Pressable } from "react-native";
import type { Message } from "@tabcom/shared";

const ME = "me";

interface Props {
  message: Message;
  onRetry?: () => void;
}

export function MessageBubble({ message, onRetry }: Props) {
  const isMe = message.authorId === ME;
  const isSystem = message.kind === "system";
  const isDeleted = !!message.deletedAt;

  if (isSystem) {
    return (
      <View className="px-8 py-2">
        <Text className="text-neutral-600 text-xs text-center">{message.text}</Text>
      </View>
    );
  }

  return (
    <View className={`px-4 py-1 ${isMe ? "items-end" : "items-start"}`}>
      {!isMe && message.authorName && (
        <Text style={{ color: message.authorColor ?? "#7C6CF6" }} className="text-xs mb-0.5 ml-2">
          {message.authorName}
        </Text>
      )}
      <View
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
          isMe ? "bg-accent" : "bg-card border border-line"
        }`}
      >
        {isDeleted ? (
          <Text className="text-neutral-500 italic text-sm">Message deleted</Text>
        ) : (
          <>
            <Text className={`text-sm ${isMe ? "text-white" : "text-neutral-200"}`}>
              {message.text}
            </Text>
            {message.url && (
              <Text className="text-blue-400 text-xs mt-1" numberOfLines={1}>
                {message.url}
              </Text>
            )}
          </>
        )}
        <View className="flex-row items-center justify-end gap-2 mt-1">
          {message.editedAt && (
            <Text className="text-neutral-500 text-[10px]">edited</Text>
          )}
          <Text className="text-neutral-500 text-[10px]">
            {new Date(message.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </Text>
          {isMe && message.status === "failed" && (
            <Pressable onPress={onRetry}>
              <Text className="text-red-400 text-[10px]">Not sent · Retry</Text>
            </Pressable>
          )}
          {isMe && message.status === "delivered" && (
            <Text className="text-green-400 text-[10px]">✓✓</Text>
          )}
          {isMe && message.readAt && (
            <Text className="text-blue-400 text-[10px]">read</Text>
          )}
        </View>
      </View>
      {message.reactions && message.reactions.length > 0 && (
        <View className="flex-row gap-1 mt-0.5 ml-2">
          {message.reactions.map((r) => (
            <View key={r.emoji} className="bg-card border border-line rounded-full px-2 py-0.5 flex-row items-center">
              <Text className="text-xs">{r.emoji}</Text>
              <Text className="text-neutral-500 text-[10px] ml-1">{r.usernames.length}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
MBEOF

# ── 4. Conversation list (Chats tab) ──
cat > "apps/mobile/app/(tabs)/index.tsx" << 'IDXEOF'
import { Text, View, Pressable, FlatList } from "react-native";
import { useRouter } from "expo-router";
import { useChatStore } from "@/stores/chat";
import { useRealtime } from "@/stores/realtime";
import { useAuth } from "@/stores/auth";
import type { Conversation, Contact, Community } from "@tabcom/shared";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`;
  return `${Math.floor(diff / 86400_000)}d`;
}

export default function ChatsScreen() {
  const router = useRouter();
  const { connected } = useRealtime();
  const conversations = useChatStore((s) => s.conversations);
  const contacts = useChatStore((s) => s.contacts);
  const communities = useChatStore((s) => s.communities);
  const messages = useChatStore((s) => s.messages);

  const getTitle = (c: Conversation): string => {
    if (c.kind === "community" && c.communityId) {
      return communities[c.communityId]?.name ?? "Community";
    }
    const contact = contacts.find((x) => x.id === c.contactId);
    return contact?.alias ?? contact?.name ?? "Unknown";
  };

  const getPresenceColor = (c: Conversation): string | null => {
    if (c.kind !== "dm") return null;
    const contact = contacts.find((x) => x.id === c.contactId);
    if (!contact) return null;
    return contact.presence === "online" ? "#4ade80" : contact.presence === "away" ? "#facc15" : null;
  };

  const getLastMessage = (c: Conversation): string => {
    const thread = messages[c.id] ?? [];
    const last = thread[thread.length - 1];
    if (!last) return "No messages yet";
    return last.text || "Media";
  };

  const openConversation = (c: Conversation) => {
    useChatStore.getState().openConversation(c.id);
    router.push(`/conversation/${c.id}` as any);
  };

  return (
    <View className="flex-1 bg-ink">
      <View className="flex-row items-center gap-2 px-4 py-2">
        <View className={`w-2 h-2 rounded-full ${connected ? "bg-green-400" : "bg-red-400"}`} />
        <Text className="text-neutral-500 text-xs">
          {connected ? "Connected" : "Connecting…"}
        </Text>
      </View>

      {conversations.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-white text-lg font-semibold mb-2">No conversations yet</Text>
          <Text className="text-neutral-500 text-center">
            Start a chat from the Contacts tab, or wait for someone to message you.
          </Text>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          renderItem={({ item: c }) => {
            const presenceColor = getPresenceColor(c);
            return (
              <Pressable
                onPress={() => openConversation(c)}
                className="flex-row items-center px-4 py-3 active:bg-card"
              >
                <View className="w-11 h-11 rounded-full bg-card items-center justify-center mr-3">
                  <Text className="text-white font-bold">
                    {getTitle(c).slice(0, 1).toUpperCase()}
                  </Text>
                  {presenceColor && (
                    <View
                      style={{ backgroundColor: presenceColor }}
                      className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-ink"
                    />
                  )}
                </View>
                <View className="flex-1 mr-2">
                  <Text className="text-white font-medium" numberOfLines={1}>
                    {getTitle(c)}
                  </Text>
                  <Text className="text-neutral-500 text-sm" numberOfLines={1}>
                    {getLastMessage(c)}
                  </Text>
                </View>
                <View className="items-end">
                  <Text className="text-neutral-600 text-xs">{timeAgo(c.lastMessageAt)}</Text>
                  {c.unread > 0 && (
                    <View className="bg-accent rounded-full px-1.5 py-0.5 mt-1 min-w-[20px] items-center">
                      <Text className="text-white text-[10px] font-bold">{c.unread}</Text>
                    </View>
                  )}
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}
IDXEOF

# ── 5. Conversation screen ──
cat > apps/mobile/app/conversation/\[id\].tsx << 'CONVEOF'
import { useEffect, useRef, useState } from "react";
import {
  Text, View, TextInput, Pressable, FlatList,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useChatStore } from "@/stores/chat";
import { MessageBubble } from "@/components/MessageBubble";

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [text, setText] = useState("");
  const listRef = useRef<FlatList>(null);

  const conversation = useChatStore((s) => s.conversations.find((c) => c.id === id));
  const messages = useChatStore((s) => s.messages[id ?? ""] ?? []);
  const contacts = useChatStore((s) => s.contacts);
  const communities = useChatStore((s) => s.communities);
  const typing = useChatStore((s) => s.typing);

  useEffect(() => {
    if (id) useChatStore.getState().openConversation(id);
    return () => useChatStore.getState().closeConversation();
  }, [id]);

  if (!conversation || !id) {
    return (
      <SafeAreaView className="flex-1 bg-ink items-center justify-center">
        <Text className="text-neutral-500">Conversation not found</Text>
      </SafeAreaView>
    );
  }

  const title =
    conversation.kind === "community" && conversation.communityId
      ? communities[conversation.communityId]?.name ?? "Community"
      : contacts.find((c) => c.id === conversation.contactId)?.alias ??
        contacts.find((c) => c.id === conversation.contactId)?.name ??
        "Unknown";

  const contact = conversation.kind === "dm"
    ? contacts.find((c) => c.id === conversation.contactId)
    : null;

  const isTyping = contact ? typing.includes(contact.id) : false;

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    useChatStore.getState().sendText(id, trimmed);
    setText("");
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const visibleMessages = messages.filter((m) => m.kind !== "system" || m.text);

  return (
    <SafeAreaView className="flex-1 bg-ink" edges={["top"]}>
      <View className="flex-row items-center px-4 py-3 border-b border-line">
        <Pressable onPress={() => router.back()} className="mr-3">
          <Text className="text-neutral-400 text-lg">←</Text>
        </Pressable>
        <View className="flex-1">
          <Text className="text-white font-semibold text-base" numberOfLines={1}>
            {title}
          </Text>
          {isTyping && (
            <Text className="text-accent text-xs">typing…</Text>
          )}
        </View>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={listRef}
          data={visibleMessages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              onRetry={() => useChatStore.getState().retryMessage(id, item.id)}
            />
          )}
          contentContainerStyle={{ paddingVertical: 8 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        />

        <View className="flex-row items-end px-3 py-2 border-t border-line bg-surface">
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Message…"
            placeholderTextColor="#5A5A68"
            multiline
            className="flex-1 bg-card border border-line rounded-2xl px-4 py-3 text-white text-sm max-h-24 mr-2"
          />
          <Pressable
            onPress={send}
            disabled={!text.trim()}
            className={`w-10 h-10 rounded-full items-center justify-center ${
              text.trim() ? "bg-accent" : "bg-accent/40"
            }`}
          >
            <Text className="text-white font-bold">↑</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
CONVEOF

echo ""
echo "✅ Build 5 files written. Running typecheck..."
echo ""

cd apps/mobile && npx tsc --noEmit && echo "" && echo "✅ Build 5 applied. Run: npx expo start --android --clear"
