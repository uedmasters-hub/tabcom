import { browser } from "wxt/browser";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { extensionStorage } from "../lib/extension-storage";
import {
  sendDm,
  type WireMessage,
  type WireUser,
} from "../lib/realtime";
import type { Contact, Conversation, Message } from "../types/chat";

/**
 * Local-first chat data layer.
 *
 * Everything persists to browser.storage.local and is seeded with demo
 * contacts so the product is fully explorable before the backend exists.
 * When apps/backend lands, these actions become API + socket calls and
 * the UI does not change.
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

interface ChatState {
  hasHydrated: boolean;

  /** Connected to the realtime server. */
  live: boolean;

  contacts: Contact[];
  conversations: Conversation[];
  messages: Record<string, Message[]>;

  /** Conversation currently open in the Inbox tab (null = list view). */
  activeConversationId: string | null;
  /** Contact ids currently "typing" (simulated or relayed). */
  typing: string[];

  setHasHydrated: (value: boolean) => void;
  ensureSeeded: () => void;

  setLiveStatus: (live: boolean) => void;
  applyRoster: (users: WireUser[]) => void;
  receiveDm: (from: WireUser, message: WireMessage) => void;
  receiveTyping: (fromUsername: string) => void;
  receiveDmError: (
    toUsername: string,
    reason: "sender_private" | "recipient_unavailable"
  ) => void;

  openConversation: (conversationId: string) => void;
  closeConversation: () => void;

  /** Opens (or creates) the conversation with a contact. */
  startConversation: (contactId: string) => string;

  sendText: (conversationId: string, text: string) => void;
  shareCurrentTab: (conversationId: string) => Promise<void>;

  totalUnread: () => number;
  resetChat: () => void;
}

function appendMessage(
  state: Pick<ChatState, "messages" | "conversations">,
  conversationId: string,
  message: Message,
  incrementUnread: boolean
) {
  return {
    messages: {
      ...state.messages,
      [conversationId]: [...(state.messages[conversationId] ?? []), message],
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
      /** Simulated contact reply with a short typing indicator. */
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

      /** Route an outgoing message: socket for live contacts, canned reply for demo. */
      const deliver = (conversationId: string, message: Message) => {
        if (message.kind === "system") return; // local notices never leave the device
        const conversation = get().conversations.find(
          (item) => item.id === conversationId
        );
        if (!conversation) return;

        const contact = get().contacts.find(
          (item) => item.id === conversation.contactId
        );

        if (contact?.id.startsWith("u-")) {
          sendDm(contact.username, {
            id: message.id,
            kind: message.kind,
            text: message.text,
            url: message.url,
            sentAt: message.sentAt,
          });
        } else {
          scheduleReply(conversationId, conversation.contactId);
        }
      };

      return {
        hasHydrated: false,
        live: false,
        contacts: [],
        conversations: [],
        messages: {},
        activeConversationId: null,
        typing: [],

        setHasHydrated: (value) => set({ hasHydrated: value }),

        setLiveStatus: (live) => set({ live }),

        applyRoster: (users) =>
          set((state) => {
            const rosterUsernames = new Set(users.map((u) => u.username));

            const liveContacts: Contact[] = users.map((user) => ({
              id: `u-${user.username}`,
              name: user.name,
              username: user.username,
              color: user.color,
              presence: "online",
            }));

            // Live contacts who left stay visible (their history remains)
            // but flip to offline. Demo contacts are untouched.
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

            return { contacts: [...liveContacts, ...departed, ...demo] };
          }),

        receiveDm: (from, message) => {
          const contactId = `u-${from.username}`;

          set((state) => {
            const contacts = state.contacts.some(
              (contact) => contact.id === contactId
            )
              ? state.contacts
              : [
                  {
                    id: contactId,
                    name: from.name,
                    username: from.username,
                    color: from.color,
                    presence: "online" as const,
                  },
                  ...state.contacts,
                ];

            let conversation = state.conversations.find(
              (item) => item.contactId === contactId
            );

            const conversations = conversation
              ? state.conversations
              : [
                  (conversation = {
                    id: uid(),
                    contactId,
                    unread: 0,
                    lastMessageAt: message.sentAt,
                  }),
                  ...state.conversations,
                ];

            const incoming: Message = {
              id: message.id,
              authorId: contactId,
              kind: message.kind,
              text: message.text,
              url: message.url,
              sentAt: message.sentAt,
            };

            const isViewing =
              state.activeConversationId === conversation.id;

            return {
              contacts,
              ...appendMessage(
                { messages: state.messages, conversations },
                conversation.id,
                incoming,
                !isViewing
              ),
              typing: state.typing.filter((id) => id !== contactId),
            };
          });
        },

        receiveDmError: (toUsername, reason) => {
          const contactId = `u-${toUsername}`;

          const conversation = get().conversations.find(
            (item) => item.contactId === contactId
          );
          if (!conversation) return;

          const notice: Message = {
            id: uid(),
            authorId: "system",
            kind: "system",
            text:
              reason === "sender_private"
                ? "Not sent — you're in private mode. Switch to public in Settings to message people."
                : `Not delivered — @${toUsername} is unavailable (private or offline).`,
            sentAt: Date.now(),
          };

          set((state) =>
            appendMessage(state, conversation.id, notice, false)
          );
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
          const existing = get().conversations.find(
            (conversation) => conversation.contactId === contactId
          );

          if (existing) {
            get().openConversation(existing.id);
            return existing.id;
          }

          const conversation: Conversation = {
            id: uid(),
            contactId,
            unread: 0,
            lastMessageAt: Date.now(),
          };

          set((state) => ({
            conversations: [conversation, ...state.conversations],
            messages: { ...state.messages, [conversation.id]: [] },
            activeConversationId: conversation.id,
          }));

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

        totalUnread: () =>
          get().conversations.reduce(
            (sum, conversation) => sum + conversation.unread,
            0
          ),

        resetChat: () =>
          set({
            contacts: [],
            conversations: [],
            messages: {},
            activeConversationId: null,
            typing: [],
          }),
      };
    },
    {
      name: "tabcom:chat",
      storage: createJSONStorage(() => extensionStorage),
      partialize: (state) => ({
        contacts: state.contacts,
        conversations: state.conversations,
        messages: state.messages,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
        state?.ensureSeeded();
      },
    }
  )
);
