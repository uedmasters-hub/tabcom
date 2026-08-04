/**
 * Per-conversation privacy defaults (parent level).
 * Content-level overrides live on Message.privacy.
 */
import { create } from "zustand";
import {
  DEFAULT_PRIVACY,
  type ConversationPrivacyDefaults,
} from "@tabcom/shared";
import {
  getAllConversationPrivacy,
  getConversationPrivacy,
  initLocalStorage,
  setConversationPrivacy,
} from "@/lib/local-storage";

type State = {
  byConversation: Record<string, ConversationPrivacyDefaults>;
  hydrate: () => void;
  getDefaults: (conversationId: string) => ConversationPrivacyDefaults;
  setDefaults: (
    conversationId: string,
    defaults: ConversationPrivacyDefaults
  ) => void;
};

function parseDefaults(json: string | null): ConversationPrivacyDefaults {
  if (!json) return { ...DEFAULT_PRIVACY };
  try {
    return { ...DEFAULT_PRIVACY, ...JSON.parse(json) };
  } catch {
    return { ...DEFAULT_PRIVACY };
  }
}

export const useConversationPrivacy = create<State>((set, get) => ({
  byConversation: {},

  hydrate: () => {
    try {
      initLocalStorage();
      const rows = getAllConversationPrivacy();
      const map: Record<string, ConversationPrivacyDefaults> = {};
      for (const r of rows) {
        map[r.conversation_id] = parseDefaults(r.defaults_json);
      }
      set({ byConversation: map });
    } catch (err) {
      if (__DEV__) console.warn("[tabcom-privacy] hydrate failed:", err);
    }
  },

  getDefaults: (conversationId) => {
    const cached = get().byConversation[conversationId];
    if (cached) return cached;
    try {
      initLocalStorage();
      const raw = getConversationPrivacy(conversationId);
      const defaults = parseDefaults(raw);
      if (raw) {
        set((s) => ({
          byConversation: { ...s.byConversation, [conversationId]: defaults },
        }));
      }
      return defaults;
    } catch {
      return { ...DEFAULT_PRIVACY };
    }
  },

  setDefaults: (conversationId, defaults) => {
    const next = { ...DEFAULT_PRIVACY, ...defaults };
    try {
      initLocalStorage();
      setConversationPrivacy(conversationId, JSON.stringify(next));
    } catch (err) {
      if (__DEV__) console.warn("[tabcom-privacy] setDefaults failed:", err);
    }
    set((s) => ({
      byConversation: { ...s.byConversation, [conversationId]: next },
    }));
  },
}));
