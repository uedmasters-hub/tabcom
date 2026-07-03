import { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { Link as LinkIcon, Send } from "lucide-react";

import "../../src/styles/tailwind.css";
import "../../src/styles/globals.css";

import { cn } from "../../src/lib/cn";
import { initRealtime } from "../../src/lib/realtime";
import { ME, useChatStore } from "../../src/stores/chat.store";
import { useProfileStore } from "../../src/stores/profile.store";
import { contactLabel } from "../../src/types/chat";
import type { Message } from "../../src/types/chat";

/**
 * Standalone floating chat window (popup-type browser window).
 *
 * Runs its own socket with the same identity — the server dedupes the
 * roster per username, and DMs are delivered to every socket, so the
 * panel and the float stay in sync through the server. Local history is
 * shared via the same persisted storage.
 *
 * Presence contract: this window announces "online" (you're actively
 * chatting). When it closes, its socket drops and your panel's chosen
 * status wins again.
 */

const NO_MESSAGES: Message[] = [];

function requestedConversationId(): string | null {
  return new URLSearchParams(window.location.search).get("conversation");
}

function FloatApp() {
  const hasHydrated = useChatStore((state) => state.hasHydrated);
  const profileHydrated = useProfileStore((state) => state.hasHydrated);

  const username = useProfileStore((state) => state.username);
  const displayName = useProfileStore((state) => state.displayName);
  const avatarColor = useProfileStore((state) => state.avatarColor);
  const photo = useProfileStore((state) => state.photo);

  const contacts = useChatStore((state) => state.contacts);
  const conversations = useChatStore((state) => state.conversations);
  const communities = useChatStore((state) => state.communities);
  const live = useChatStore((state) => state.live);

  const [conversationId, setConversationId] = useState<string | null>(null);

  // Connect this window's own socket once identity is available.
  useEffect(() => {
    if (!profileHydrated || !username) return;

    initRealtime(
      {
        username,
        name: displayName,
        color: avatarColor,
        visibility: "public",
        presence: "online", // actively chatting while the float is up
        photo,
      },
      {
        onConnectionChange: (isLive) =>
          useChatStore.getState().setLiveStatus(isLive),
        onRoster: (users) =>
          useChatStore
            .getState()
            .applyRoster(users.filter((user) => user.username !== username)),
        onDm: (from, message) =>
          useChatStore.getState().receiveDm(from, message),
        onTyping: (from) => useChatStore.getState().receiveTyping(from),
        onDmError: (to, reason) =>
          useChatStore.getState().receiveDmError(to, reason),
        onConnections: (snapshot) =>
          useChatStore.getState().receiveConnections(snapshot),
        onConnectRequest: (from) =>
          useChatStore.getState().receiveConnectRequest(from),
        onConnectUpdate: (user, status) =>
          useChatStore.getState().receiveConnectUpdate(user, status),
        onCommunities: (list) =>
          useChatStore.getState().receiveCommunities(list),
        onCommunityUpdate: (community) =>
          useChatStore.getState().receiveCommunityUpdate(community),
        onCommunityInvite: (community, from, attempt) =>
          useChatStore
            .getState()
            .receiveCommunityInvite(community, from, attempt),
        onCommunityDeclined: (payload) =>
          useChatStore.getState().receiveCommunityDeclined(payload),
        onCommunityLeft: (id) =>
          useChatStore.getState().receiveCommunityLeft(id),
        onCommunityMessage: (id, from, message) =>
          useChatStore.getState().receiveCommunityMessage(id, from, message),
        onCommunityError: (payload) =>
          useChatStore.getState().receiveCommunityError(payload),
      }
    );
  }, [profileHydrated, username, displayName, avatarColor, photo]);

  // Resolve the conversation to show (query param, else most recent).
  useEffect(() => {
    if (!hasHydrated || conversationId) return;

    const requested = requestedConversationId();
    const found =
      (requested &&
        conversations.find((item) => item.id === requested)?.id) ||
      conversations[0]?.id ||
      null;

    setConversationId(found);
    if (found) useChatStore.getState().openConversation(found);
  }, [hasHydrated, conversations, conversationId]);

  if (!hasHydrated || !profileHydrated) return null;

  const conversation = conversations.find(
    (item) => item.id === conversationId
  );
  const community = conversation?.communityId
    ? communities[conversation.communityId]
    : undefined;
  const contact = conversation?.contactId
    ? contacts.find((item) => item.id === conversation.contactId)
    : undefined;

  const title = community
    ? community.name
    : contact
      ? contactLabel(contact)
      : "Tabcom";

  return (
    <FloatThread
      title={title}
      subtitle={live ? "Live · floating" : "Offline"}
      conversationId={conversationId}
    />
  );
}

function FloatThread({
  title,
  subtitle,
  conversationId,
}: {
  title: string;
  subtitle: string;
  conversationId: string | null;
}) {
  const messages = useChatStore((state) =>
    conversationId ? (state.messages[conversationId] ?? NO_MESSAGES) : NO_MESSAGES
  );
  const sendText = useChatStore((state) => state.sendText);
  const shareCurrentTab = useChatStore((state) => state.shareCurrentTab);

  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView();
  }, [messages.length]);

  const submit = () => {
    if (!draft.trim() || !conversationId) return;
    sendText(conversationId, draft);
    setDraft("");
  };

  return (
    <div className="flex h-screen flex-col bg-white font-sans text-slate-900">
      <div className="border-b border-slate-200 px-4 py-2.5">
        <p className="truncate text-sm font-semibold">{title}</p>
        <p className="text-[10px] uppercase tracking-wide text-blue-600">
          {subtitle}
        </p>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {!conversationId && (
          <p className="mt-8 text-center text-xs text-slate-400">
            No conversation yet — start one in the Tabcom panel.
          </p>
        )}

        {messages.map((message) =>
          message.kind === "system" ? (
            <p
              key={message.id}
              className="mx-auto max-w-[90%] rounded-full bg-slate-50 px-3 py-1 text-center text-[11px] text-slate-500"
            >
              {message.text}
            </p>
          ) : (
            <div
              key={message.id}
              className={cn(
                "flex",
                message.authorId === ME ? "justify-end" : "justify-start"
              )}
            >
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-3 py-2 text-[13px] leading-5",
                  message.authorId === ME
                    ? "rounded-br-md bg-slate-900 text-white"
                    : "rounded-bl-md bg-slate-100"
                )}
              >
                {message.authorName && message.authorId !== ME && (
                  <span
                    className="block text-[10px] font-semibold"
                    style={{ color: message.authorColor }}
                  >
                    {message.authorName}
                  </span>
                )}
                {message.kind === "link" ? `🔗 ${message.text}` : message.text}
              </div>
            </div>
          )
        )}
        <div ref={endRef} />
      </div>

      <div className="flex items-center gap-1.5 border-t border-slate-200 px-3 py-2.5">
        <button
          type="button"
          onClick={() =>
            conversationId && void shareCurrentTab(conversationId)
          }
          title="Share current tab"
          aria-label="Share current tab"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-blue-300 hover:text-blue-600"
        >
          <LinkIcon size={15} />
        </button>

        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="Message…"
          className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-[13px] outline-none focus:border-blue-500"
        />

        <button
          type="button"
          onClick={submit}
          disabled={!draft.trim() || !conversationId}
          aria-label="Send"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white transition disabled:bg-slate-300"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<FloatApp />);
