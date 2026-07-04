import { browser } from "wxt/browser";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { extensionStorage } from "../lib/extension-storage";
import {
  addBoardItem,
  blockUser,
  hidePresenceFrom,
  removeConnection,
  createCommunity as rtCreateCommunity,
  inviteToCommunity as rtInviteToCommunity,
  leaveCommunity as rtLeaveCommunity,
  reportUser,
  respondToCommunityInvite,
  respondToConnectRequest,
  sendCommunityMessage,
  removeBoardItem,
  commentOnBoardItem,
  voteOnBoardItem,
  decideBoardItem,
  sendConnectRequest,
  sendDm,
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

interface ChatState {
  hasHydrated: boolean;
  live: boolean;

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

  /** Usernames in the latest live roster (currently connected). */
  rosterUsernames: string[];
  /** Contacts I appear offline to (presence mask, not blocking). */
  hiddenFrom: string[];

  activeConversationId: string | null;
  typing: string[];

  setHasHydrated: (value: boolean) => void;
  ensureSeeded: () => void;
  setLiveStatus: (live: boolean) => void;

  openConversation: (conversationId: string) => void;
  closeConversation: () => void;
  startConversation: (contactId: string) => string;
  openCommunityConversation: (communityId: string) => string;

  sendText: (conversationId: string, text: string) => void;
  shareCurrentTab: (conversationId: string) => Promise<void>;

  toggleMute: (targetId: string) => void;
  clearHistory: (conversationId: string) => void;

  // contact management
  addContactByUsername: (username: string) => void;
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
  block: (contact: Contact) => void;
  unblock: (contact: Contact) => void;
  report: (contact: Contact, reason?: string) => void;

  // realtime receive
  applyRoster: (users: WireUser[]) => void;
  receiveDm: (from: WireUser, message: WireMessage) => void;
  receiveTyping: (fromUsername: string) => void;
  receiveDmError: (
    toUsername: string,
    reason: "sender_private" | "recipient_unavailable" | "not_connected"
  ) => void;

  // communities
  createCommunity: (name: string) => void;
  inviteToCommunity: (communityId: string, username: string) => void;
  respondToCommunityInvite: (
    communityId: string,
    action: "accept" | "decline"
  ) => void;
  leaveCommunity: (communityId: string) => void;

  // boards
  addCurrentTabToBoard: (communityId: string) => Promise<void>;
  removeBoardItem: (communityId: string, itemId: string) => void;
  commentOnBoardItem: (communityId: string, itemId: string, text: string) => void;
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
}

function toCommunity(wire: WireCommunity): Community {
  return {
    id: wire.id,
    name: wire.name,
    admin: wire.admin,
    members: wire.members,
    pendingForMe: wire.pendingForMe,
    board: (wire.board ?? []).map((item) => ({
      ...item,
      pins: item.pins ?? [],
      highlights: item.highlights ?? [],
    })),
    boardDecidedId: wire.boardDecidedId,
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
          sentAt: message.sentAt,
        };

        if (conversation.kind === "community" && conversation.communityId) {
          sendCommunityMessage(conversation.communityId, wire);
          return;
        }

        const contact = get().contacts.find(
          (item) => item.id === conversation.contactId
        );
        if (!contact) return;

        if (contact.id.startsWith("u-")) {
          sendDm(contact.username, wire);
        } else {
          scheduleReply(conversationId, contact.id);
        }
      };

      return {
        hasHydrated: false,
        live: false,
        contacts: [],
        conversations: [],
        messages: {},
        connections: {},
        communities: {},
        communityInvites: {},
        muted: [],
        rosterUsernames: [],
        hiddenFrom: [],
        activeConversationId: null,
        typing: [],

        setHasHydrated: (value) => set({ hasHydrated: value }),
        setLiveStatus: (live) => set({ live }),

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

        sendText: (conversationId, text) => {
          const trimmed = text.trim();
          if (!trimmed) return;

          const message: Message = {
            id: uid(),
            authorId: ME,
            kind: "text",
            text: trimmed,
            sentAt: Date.now(),
          };

          set((state) => appendMessage(state, conversationId, message, false));
          deliver(conversationId, message);
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

          const incoming: Message = {
            id: message.id,
            authorId: contactId,
            kind: message.kind,
            text: message.text,
            url: message.url,
            sentAt: message.sentAt,
          };

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

        receiveCommunityMessage: (communityId, from, message) => {
          const community = get().communities[communityId];
          if (!community) return;

          const conversation = ensureConversation(
            { communityId },
            message.sentAt
          );

          const incoming: Message = {
            id: message.id,
            authorId: `u-${from.username}`,
            authorName: from.name,
            authorColor: from.color,
            kind: message.kind,
            text: message.text,
            url: message.url,
            sentAt: message.sentAt,
          };

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
        },

        resetChat: () =>
          set({
            contacts: [],
            conversations: [],
            messages: {},
            connections: {},
            communities: {},
            communityInvites: {},
            muted: [],
            rosterUsernames: [],
            hiddenFrom: [],
            activeConversationId: null,
            typing: [],
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
