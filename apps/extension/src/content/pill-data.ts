import { useEffect, useState } from "react";
import { browser } from "wxt/browser";

import { extensionAlive, notifyInvalidated } from "./extension-alive";
export { onInvalidated } from "./extension-alive";

import type { Community, Contact, Conversation, Message } from "../types/chat";

/**
 * The pill's data layer.
 *
 * No local socket, no zustand store instance — the background holds
 * the one persistent connection (see M18's presence-follows-pill
 * design). This layer just:
 *   1. reads the same "tabcom:chat"/"tabcom:profile" storage the
 *      popup's zustand persist already writes to, live via
 *      storage.onChanged (React state updates, diffed rendering —
 *      this is what eliminates the old manual-DOM-rebuild jitter)
 *   2. sends writes through the existing background relay
 *      ("tabcom:board-write" and friends), exactly as the vanilla
 *      pill did — same wire protocol, same server, same guarantees
 */

interface ChatState {
  contacts: Contact[];
  conversations: Conversation[];
  communities: Record<string, Community>;
  messages: Record<string, Message[]>;
}

const EMPTY_CHAT_STATE: ChatState = {
  contacts: [],
  conversations: [],
  communities: {},
  messages: {},
};

async function readJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const result = await browser.storage.local.get(key);
    const raw = result[key] as string | undefined;
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return (parsed.state ?? parsed) as T;
  } catch {
    return fallback;
  }
}

/** Subscribe to live state from one or more storage keys. */
function useStorageState<T>(keys: string[], read: () => Promise<T>, initial: T): T {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    let cancelled = false;

    const refresh = () => {
      void read().then((next) => {
        if (!cancelled) setValue(next);
      });
    };

    refresh();

    const listener = (changes: Record<string, unknown>, area: string) => {
      if (area !== "local") return;
      if (keys.some((key) => key in changes)) refresh();
    };
    browser.storage.onChanged.addListener(listener);

    return () => {
      cancelled = true;
      browser.storage.onChanged.removeListener(listener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys.join(",")]);

  return value;
}

export function useUsername(): string | null {
  return useStorageState(
    ["tabcom:profile"],
    () => readJSON<{ username?: string }>("tabcom:profile", {}).then((p) => p.username ?? null),
    null
  );
}

export function useChatState(): ChatState {
  return useStorageState(
    ["tabcom:chat"],
    async () => {
      const state = await readJSON<Partial<ChatState>>("tabcom:chat", {});
      return {
        contacts: state.contacts ?? [],
        conversations: state.conversations ?? [],
        communities: state.communities ?? {},
        messages: state.messages ?? {},
      };
    },
    EMPTY_CHAT_STATE
  );
}

export interface BufferedEntry {
  kind: "dm" | "community";
  communityId?: string;
  from?: { username: string; name: string; color: string };
  message: Message & { id: string; text: string };
  receivedAt: number;
}

export function useInboxBuffer(): BufferedEntry[] {
  return useStorageState(
    ["tabcom:inbox-buffer"],
    async () => {
      try {
        const result = await browser.storage.local.get("tabcom:inbox-buffer");
        const raw = result["tabcom:inbox-buffer"] as string | undefined;
        return raw ? (JSON.parse(raw) as BufferedEntry[]) : [];
      } catch {
        return [];
      }
    },
    []
  );
}

// ---- Mutations: local optimistic writes + relay ---------------------------

export async function markConversationRead(conversationId: string | null, peerKey: string): Promise<void> {
  try {
    const result = await browser.storage.local.get(["tabcom:chat", "tabcom:inbox-buffer"]);

    const rawChat = result["tabcom:chat"] as string | undefined;
    if (rawChat && conversationId) {
      const parsed = JSON.parse(rawChat);
      const state = parsed.state ?? parsed;
      state.conversations = (state.conversations ?? []).map(
        (c: { id: string; unread?: number }) =>
          c.id === conversationId ? { ...c, unread: 0 } : c
      );
      if (parsed.state) parsed.state = state;
      await browser.storage.local.set({
        "tabcom:chat": JSON.stringify(parsed.state ? parsed : state),
      });
    }

    const rawBuffer = result["tabcom:inbox-buffer"] as string | undefined;
    if (rawBuffer) {
      const buffer = JSON.parse(rawBuffer) as BufferedEntry[];
      const remaining = buffer.filter((item) => {
        const key = item.kind === "community" ? item.communityId : item.from?.username;
        return key !== peerKey;
      });
      if (remaining.length !== buffer.length) {
        await browser.storage.local.set({
          "tabcom:inbox-buffer": JSON.stringify(remaining),
        });
      }
    }
  } catch {
    // a stale badge is cosmetic — never worth throwing over
  }
}

export async function appendMessageLocally(conversationId: string, message: Message): Promise<void> {
  try {
    const result = await browser.storage.local.get("tabcom:chat");
    const raw = result["tabcom:chat"] as string | undefined;
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const state = parsed.state ?? parsed;
    const thread: Message[] = state.messages?.[conversationId] ?? [];
    if (thread.some((m) => m.id === message.id)) return;
    state.messages = { ...state.messages, [conversationId]: [...thread, message] };
    if (parsed.state) parsed.state = state;
    await browser.storage.local.set({
      "tabcom:chat": JSON.stringify(parsed.state ? parsed : state),
    });
  } catch {
    // best-effort local echo — live/buffered delivery is the source of truth
  }
}

// ---- Extension-context resilience: one shared registry with the
  // annotation overlay (src/content/extension-alive.ts) — see M21/M24/M25.

export async function safeSendMessage(
  message: Record<string, unknown>
): Promise<{ ok: boolean; reason?: string } | null> {
  if (!extensionAlive()) {
    notifyInvalidated();
    return null;
  }
  try {
    return (await browser.runtime.sendMessage(message)) as { ok: boolean; reason?: string } | null;
  } catch (error) {
    if (String(error).includes("context invalidated")) notifyInvalidated();
    return null;
  }
}

export const boardWrite = (
  action:
    | "pin_add"
    | "pin_remove"
    | "highlight_add"
    | "highlight_remove"
    | "item_add"
    | "dm_send"
    | "typing_send"
    | "community_message"
    | "board_vote"
    | "board_comment"
    | "board_decide"
    | "board_remove_item",
  payload: Record<string, unknown>
) => safeSendMessage({ type: "tabcom:board-write", action, payload });
