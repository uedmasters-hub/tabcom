import { motion } from "framer-motion";
import {
  ExternalLink,
  Link as LinkIcon,
  Pin,
  PinOff,
  Send,
  Smile,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { createPortal } from "react-dom";
import { browser } from "wxt/browser";

import "../../src/styles/tailwind.css";
import "../../src/styles/globals.css";

import { Avatar } from "../../src/components/ui";
import EmojiPicker from "../../src/features/workspace/views/chat/EmojiPicker";
import { cn } from "../../src/lib/cn";
import { disconnectRealtime, initRealtime, sendTyping } from "../../src/lib/realtime";
import { ME, useChatStore } from "../../src/stores/chat.store";
import { useProfileStore } from "../../src/stores/profile.store";
import { contactLabel } from "../../src/types/chat";
import type { Message } from "../../src/types/chat";
import { formatClockTime } from "../../src/utils/time";

/**
 * Floating chat window — a compact but COMPLETE chat experience:
 * identity header with presence, typing indicator, timestamps, link
 * cards, emoji, share-tab, spring animations. Runs its own socket.
 */

const NO_MESSAGES: Message[] = [];

interface DocumentPictureInPicture {
  requestWindow(options?: {
    width?: number;
    height?: number;
  }): Promise<Window>;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

/** Copy this document's styles into the always-on-top window. */
function cloneStyles(target: Window): void {
  for (const sheet of [...document.styleSheets]) {
    try {
      const css = [...sheet.cssRules].map((rule) => rule.cssText).join("");
      const style = target.document.createElement("style");
      style.textContent = css;
      target.document.head.append(style);
    } catch {
      if (sheet.href) {
        const link = target.document.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        target.document.head.append(link);
      }
    }
  }
}

const presenceColors = {
  online: "bg-emerald-500",
  away: "bg-amber-400",
  busy: "bg-red-500",
  offline: "bg-slate-300",
} as const;

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
  const sessionToken = useProfileStore((state) => state.sessionToken);
  const guestInstanceId = useProfileStore((state) => state.guestInstanceId);

  const conversations = useChatStore((state) => state.conversations);

  const [conversationId, setConversationId] = useState<string | null>(null);

  useEffect(() => {
    if (!profileHydrated || !username) return;

    initRealtime(
      {
        username,
        name: displayName,
        color: avatarColor,
        visibility: "public",
        presence: "online",
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
      },
      sessionToken,
      guestInstanceId
    );
  }, [profileHydrated, username, displayName, avatarColor, photo, sessionToken, guestInstanceId]);

  // Same reasoning as background's own listener for this message: the
  // pip window holds its own separate connection with no built-in
  // awareness of the panel's session state either.
  useEffect(() => {
    const listener = (message: { type?: string }) => {
      if (message?.type === "tabcom:session-ended") {
        disconnectRealtime();
      }
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

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

  // These MUST be called unconditionally, before any early return below —
  // React requires the exact same hooks, in the exact same order, on
  // every render. Calling them after "if (...) return null" meant they
  // were skipped entirely on the first render (before hydration) and
  // only started being called once hydration finished, which is exactly
  // the kind of hook-count mismatch that crashes a component outright.
  const [pinWindow, setPinWindow] = useState<Window | null>(null);
  const popupWindowId = useRef<number | null>(null);

  if (!hasHydrated || !profileHydrated) return null;

  const pinSupported =
    typeof window !== "undefined" && !!window.documentPictureInPicture;

  const restorePopup = async () => {
    const id = popupWindowId.current;
    if (id != null) {
      try {
        await browser.windows.update(id, { state: "normal", focused: true });
      } catch {
        // popup already gone
      }
    }
  };

  const pinToTop = async () => {
    if (!window.documentPictureInPicture || pinWindow) return;

    const win = await window.documentPictureInPicture.requestWindow({
      width: 340,
      height: 500,
    });

    cloneStyles(win);
    win.document.title = "Tabcom — Pinned chat";
    win.document.body.style.margin = "0";
    win.document.body.style.height = "100vh";
    win.document.body.style.overflow = "hidden";

    win.addEventListener("pagehide", () => {
      setPinWindow(null);
      void restorePopup();
    });

    setPinWindow(win);

    // The PiP window dies with its opener, so keep this popup alive
    // but tuck it away.
    const current = await browser.windows.getCurrent();
    popupWindowId.current = current.id ?? null;
    if (current.id != null) {
      void browser.windows.update(current.id, { state: "minimized" });
    }
  };

  const unpin = () => pinWindow?.close();

  if (!conversationId) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-white px-8 text-center">
        <p className="text-sm font-semibold">No conversation yet</p>
        <p className="mt-1 text-xs text-slate-500">
          Start one in the Tabcom panel — it will appear here.
        </p>
      </div>
    );
  }

  const thread = (
    <FloatThread
      conversationId={conversationId}
      pinSupported={pinSupported}
      pinned={!!pinWindow}
      onTogglePin={() => (pinWindow ? unpin() : void pinToTop())}
    />
  );

  if (pinWindow) {
    return (
      <>
        {createPortal(thread, pinWindow.document.body)}

        <div className="fixed inset-0 flex flex-col items-center justify-center bg-white px-8 text-center">
          <Pin size={22} className="text-blue-600" />
          <p className="mt-3 text-sm font-semibold">Chat is pinned on top</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            The conversation is floating above all your apps. Closing this
            window closes the pin too.
          </p>
          <button
            type="button"
            onClick={unpin}
            className="mt-4 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold transition hover:border-slate-300"
          >
            Bring it back here
          </button>
        </div>
      </>
    );
  }

  return thread;
}

function FloatBubble({
  message,
  animate,
  showAuthor,
}: {
  message: Message;
  animate: boolean;
  showAuthor: boolean;
}) {
  const isMine = message.authorId === ME;

  if (message.kind === "system") {
    return (
      <div className="flex justify-center">
        <p className="max-w-[90%] rounded-full bg-slate-50 px-3 py-1 text-center text-[11px] text-slate-500">
          {message.text}
        </p>
      </div>
    );
  }

  const bubble = (
    <div className={cn("flex", isMine ? "justify-end" : "justify-start")}>
      <div className="max-w-[80%]">
        {showAuthor && !isMine && message.authorName && (
          <p
            className="mb-0.5 ml-2.5 text-[10px] font-semibold"
            style={{ color: message.authorColor ?? "#64748B" }}
          >
            {message.authorName}
          </p>
        )}

        <div
          className={cn(
            "rounded-2xl px-3.5 py-2 text-[13px] leading-5",
            isMine
              ? "rounded-br-md bg-slate-900 text-white"
              : "rounded-bl-md bg-slate-100 text-slate-900"
          )}
        >
          {message.kind === "link" && message.url ? (
            <button
              type="button"
              onClick={() => browser.tabs.create({ url: message.url })}
              className="flex items-start gap-1.5 text-left"
            >
              <ExternalLink size={13} className="mt-0.5 shrink-0" />
              <span>
                <span className="block font-medium underline underline-offset-2">
                  {message.text}
                </span>
                <span
                  className={cn(
                    "mt-0.5 block max-w-[200px] truncate text-[10px]",
                    isMine ? "text-slate-300" : "text-slate-500"
                  )}
                >
                  {message.url}
                </span>
              </span>
            </button>
          ) : (
            message.text
          )}

          <span
            className={cn(
              "mt-0.5 block text-right text-[9px]",
              isMine ? "text-slate-400" : "text-slate-400"
            )}
          >
            {formatClockTime(message.sentAt)}
          </span>
        </div>
      </div>
    </div>
  );

  if (!animate) return bubble;

  return (
    <motion.div
      initial={{
        opacity: 0,
        scale: 0.6,
        y: 12,
        originX: isMine ? 1 : 0,
        originY: 1,
      }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 460, damping: 28, mass: 0.7 }}
    >
      {bubble}
    </motion.div>
  );
}

function FloatThread({
  conversationId,
  pinSupported,
  pinned,
  onTogglePin,
}: {
  conversationId: string;
  pinSupported: boolean;
  pinned: boolean;
  onTogglePin: () => void;
}) {
  const conversations = useChatStore((state) => state.conversations);
  const contacts = useChatStore((state) => state.contacts);
  const communities = useChatStore((state) => state.communities);
  const messages = useChatStore(
    (state) => state.messages[conversationId] ?? NO_MESSAGES
  );
  const typing = useChatStore((state) => state.typing);
  const connections = useChatStore((state) => state.connections);
  const live = useChatStore((state) => state.live);

  const sendText = useChatStore((state) => state.sendText);
  const shareCurrentTab = useChatStore((state) => state.shareCurrentTab);
  const animations = useProfileStore((state) => state.animations);

  const [draft, setDraft] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastTypingSent = useRef(0);

  const conversation = conversations.find(
    (item) => item.id === conversationId
  );
  const community = conversation?.communityId
    ? communities[conversation.communityId]
    : undefined;
  const contact = conversation?.contactId
    ? contacts.find((item) => item.id === conversation.contactId)
    : undefined;

  const isLiveContact = !!contact?.id.startsWith("u-");
  const accepted =
    !contact ||
    !isLiveContact ||
    (connections[contact.username] ?? "none") === "accepted";
  const isTyping = contact ? typing.includes(contact.id) : false;

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTo({
      top: list.scrollHeight,
      behavior: animations ? "smooth" : "auto",
    });
  }, [messages.length, isTyping, animations]);

  if (!conversation || (!contact && !community)) return null;

  const title = community ? community.name : contactLabel(contact!);
  const subtitle = community
    ? `${community.members.length} member${community.members.length === 1 ? "" : "s"}`
    : isTyping
      ? "typing…"
      : contact!.presence;

  const submit = () => {
    if (!draft.trim()) return;
    sendText(conversationId, draft);
    setDraft("");
    setShowEmoji(false);
  };

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-white font-sans text-slate-900">
      {/* Identity header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 px-4 py-3">
        {community ? (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">
            {community.name.charAt(0).toUpperCase()}
          </span>
        ) : (
          <div className="relative shrink-0">
            <Avatar
              name={contactLabel(contact!)}
              color={contact!.color}
              photo={contact!.photo}
              size="sm"
            />
            <span
              className={cn(
                "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white",
                presenceColors[contact!.presence]
              )}
            />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight">
            {title}
          </p>
          <p className="truncate text-[11px] text-slate-500">{subtitle}</p>
        </div>

        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
            live
              ? "bg-emerald-50 text-emerald-600"
              : "bg-slate-100 text-slate-400"
          )}
        >
          {live ? "Live" : "Offline"}
        </span>

        {pinSupported && (
          <button
            type="button"
            onClick={onTogglePin}
            title={pinned ? "Unpin from top" : "Pin on top of all apps"}
            aria-label={pinned ? "Unpin from top" : "Pin on top of all apps"}
            className={cn(
              "shrink-0 rounded-lg p-1.5 transition hover:bg-slate-100",
              pinned ? "text-blue-600" : "text-slate-400 hover:text-slate-900"
            )}
          >
            {pinned ? <PinOff size={15} /> : <Pin size={15} />}
          </button>
        )}
      </div>

      {/* Messages */}
      <div
        ref={listRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4"
      >
        {messages.map((message) => (
          <FloatBubble
            key={message.id}
            message={message}
            animate={animations}
            showAuthor={!!community}
          />
        ))}

        {isTyping && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-slate-100 px-3.5 py-2.5">
              <span className="flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:300ms]" />
              </span>
            </div>
          </div>
        )}

      </div>

      {/* Composer */}
      <div className="relative flex shrink-0 items-center gap-2 border-t border-slate-200 px-4 py-3">
        {showEmoji && (
          <EmojiPicker
            onPick={(emoji) => {
              setDraft((value) => value + emoji);
              inputRef.current?.focus();
            }}
          />
        )}

        <button
          type="button"
          title="Emoji"
          aria-label="Emoji"
          onClick={() => setShowEmoji((value) => !value)}
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition",
            showEmoji
              ? "border-blue-300 bg-blue-50 text-blue-600"
              : "border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-600"
          )}
        >
          <Smile size={15} />
        </button>

        <button
          type="button"
          title="Share current tab"
          aria-label="Share current tab"
          onClick={() => void shareCurrentTab(conversationId)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-blue-300 hover:text-blue-600"
        >
          <LinkIcon size={15} />
        </button>

        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);

            if (
              isLiveContact &&
              accepted &&
              contact &&
              Date.now() - lastTypingSent.current > 1500
            ) {
              lastTypingSent.current = Date.now();
              sendTyping(contact.username);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={
            community
              ? `Message ${community.name}…`
              : `Message ${contactLabel(contact!).split(" ")[0]}…`
          }
          className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-[13px] outline-none transition-colors focus:border-blue-500"
        />

        <button
          type="button"
          onClick={submit}
          disabled={!draft.trim()}
          aria-label="Send"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white transition hover:bg-slate-800 disabled:bg-slate-300"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<FloatApp />);
