import { browser } from "wxt/browser";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { extensionStorage } from "../lib/extension-storage";
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

  contacts: Contact[];
  conversations: Conversation[];
  messages: Record<string, Message[]>;

  /** Conversation currently open in the Inbox tab (null = list view). */
  activeConversationId: string | null;
  /** Contact ids currently "typing" (simulated). */
  typing: string[];

  setHasHydrated: (value: boolean) => void;
  ensureSeeded: () => void;

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

      return {
        hasHydrated: false,
        contacts: [],
        conversations: [],
        messages: {},
        activeConversationId: null,
        typing: [],

        setHasHydrated: (value) => set({ hasHydrated: value }),

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

          const conversation = get().conversations.find(
            (item) => item.id === conversationId
          );
          if (conversation) {
            scheduleReply(conversationId, conversation.contactId);
          }
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

          const conversation = get().conversations.find(
            (item) => item.id === conversationId
          );
          if (conversation) {
            scheduleReply(conversationId, conversation.contactId);
          }
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
