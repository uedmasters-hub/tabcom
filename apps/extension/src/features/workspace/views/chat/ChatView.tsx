import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ExternalLink,
  Info,
  Link as LinkIcon,
  PictureInPicture2,
  Send,
  ShieldOff,
  Smile,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";

import { Avatar } from "../../../../components/ui";
import { cn } from "../../../../lib/cn";
import { sendTyping } from "../../../../lib/realtime";
import { ME, useChatStore } from "../../../../stores/chat.store";
import { useProfileStore } from "../../../../stores/profile.store";
import { contactLabel } from "../../../../types/chat";
import type { Message } from "../../../../types/chat";
import { formatClockTime } from "../../../../utils/time";

import ConsentPanel from "./ConsentPanel";
import EmojiPicker from "./EmojiPicker";
import InfoPanel from "./InfoPanel";
import {
  isFloatOpen,
  toggleFloatingChat,
} from "../../../../lib/floating-chat";

const presenceColors = {
  online: "bg-emerald-500",
  away: "bg-amber-400",
  busy: "bg-red-500",
  offline: "bg-slate-300",
} as const;

/** Stable fallback so the selector never returns a fresh reference. */
const NO_MESSAGES: Message[] = [];

function MessageBubble({
  message,
  showAuthor,
  animate,
}: {
  message: Message;
  showAuthor: boolean;
  animate: boolean;
}) {
  const isMine = message.authorId === ME;

  if (message.kind === "system") {
    return (
      <div className="flex justify-center">
        <p className="max-w-[85%] rounded-full bg-slate-50 px-4 py-1.5 text-center text-xs text-slate-500">
          {message.text}
        </p>
      </div>
    );
  }

  const bubble = (
    <div className={cn("flex", isMine ? "justify-end" : "justify-start")}>
      <div className="max-w-[75%]">
        {showAuthor && !isMine && (
          <p
            className="mb-0.5 ml-3 text-[11px] font-semibold"
            style={{ color: message.authorColor ?? "#64748B" }}
          >
            {message.authorName}
          </p>
        )}

        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-6",
            isMine
              ? "rounded-br-md bg-slate-900 text-white"
              : "rounded-bl-md bg-slate-100 text-slate-900"
          )}
        >
          {message.kind === "link" && message.url ? (
            <button
              type="button"
              onClick={() => browser.tabs.create({ url: message.url })}
              className="flex items-start gap-2 text-left"
            >
              <ExternalLink size={16} className="mt-1 shrink-0" />
              <span>
                <span className="block font-medium underline underline-offset-2">
                  {message.text}
                </span>
                <span
                  className={cn(
                    "mt-0.5 block truncate text-xs",
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

          <span className="mt-1 block text-right text-[10px] text-slate-400">
            {formatClockTime(message.sentAt)}
          </span>
        </div>
      </div>
    </div>
  );

  if (!animate) return bubble;

  // iMessage-style spring pop
  return (
    <motion.div
      initial={{
        opacity: 0,
        scale: 0.6,
        y: 14,
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

export default function ChatView({
  conversationId,
}: {
  conversationId: string;
}) {
  const contacts = useChatStore((state) => state.contacts);
  const conversations = useChatStore((state) => state.conversations);
  const communities = useChatStore((state) => state.communities);
  const messages = useChatStore(
    (state) => state.messages[conversationId] ?? NO_MESSAGES
  );
  const typing = useChatStore((state) => state.typing);
  const connections = useChatStore((state) => state.connections);

  const closeConversation = useChatStore((state) => state.closeConversation);
  const sendText = useChatStore((state) => state.sendText);
  const shareCurrentTab = useChatStore((state) => state.shareCurrentTab);

  const visibility = useProfileStore((state) => state.visibility);
  const animations = useProfileStore((state) => state.animations);
  const pipEnabled = useProfileStore((state) => state.pipEnabled);
  const [floating, setFloating] = useState(isFloatOpen());

  const [draft, setDraft] = useState("");
  const [showInfo, setShowInfo] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastTypingSent = useRef(0);

  const conversation = conversations.find(
    (item) => item.id === conversationId
  );

  const isCommunity = conversation?.kind === "community";
  const community =
    isCommunity && conversation.communityId
      ? communities[conversation.communityId]
      : undefined;
  const contact = !isCommunity
    ? contacts.find((item) => item.id === conversation?.contactId)
    : undefined;

  const isLiveContact = !!contact?.id.startsWith("u-");
  const connection = contact
    ? isLiveContact
      ? (connections[contact.username] ?? "none")
      : "accepted"
    : "accepted";

  const isTyping = contact ? typing.includes(contact.id) : false;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
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
    sendText(conversationId, draft);
    setDraft("");
    setShowEmoji(false);
  };

  const gatePrivate =
    visibility === "private" && (isLiveContact || isCommunity);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Thread header — tap for details */}
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
        <button
          type="button"
          onClick={closeConversation}
          aria-label="Back to inbox"
          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
        >
          <ArrowLeft size={18} />
        </button>

        <button
          type="button"
          onClick={() => setShowInfo(true)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {community ? (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">
              {community.name.charAt(0).toUpperCase()}
            </span>
          ) : (
            <Avatar
              name={contact!.name}
              color={contact!.color}
              photo={contact!.photo}
              size="sm"
            />
          )}

          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold leading-tight">
              {title}
            </span>
            <span className="flex items-center gap-1.5 text-xs text-slate-500">
              {!community && (
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    presenceColors[contact!.presence]
                  )}
                />
              )}
              {subtitle}
            </span>
          </span>
        </button>

        {pipEnabled && (
          <button
            type="button"
            onClick={() => {
              void toggleFloatingChat(conversationId).then(() =>
                setFloating(isFloatOpen())
              );
            }}
            title={floating ? "Close floating chat" : "Float this chat"}
            aria-label="Float this chat"
            className={cn(
              "rounded-lg p-1.5 transition hover:bg-slate-100",
              floating
                ? "text-blue-600"
                : "text-slate-400 hover:text-slate-900"
            )}
          >
            <PictureInPicture2 size={18} />
          </button>
        )}

        <button
          type="button"
          onClick={() => setShowInfo(true)}
          aria-label="Details"
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
        >
          <Info size={18} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            showAuthor={isCommunity}
            animate={animations}
          />
        ))}

        {isTyping && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-slate-100 px-4 py-3">
              <span className="flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:300ms]" />
              </span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Composer — consent gate, then privacy gate (server enforces both) */}
      {contact && isLiveContact && connection !== "accepted" ? (
        <ConsentPanel contact={contact} status={connection} />
      ) : gatePrivate ? (
        <div className="flex items-center gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <ShieldOff size={18} className="shrink-0 text-slate-400" />
          <p className="text-xs leading-5 text-slate-500">
            You're in private mode — messaging is paused. Switch to public
            in Settings to send and receive.
          </p>
        </div>
      ) : (
        <div className="relative flex items-center gap-2 border-t border-slate-200 px-4 py-3">
          <AnimatePresence>
            {showEmoji && (
              <motion.div
                initial={{ opacity: 0, y: 6, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.96 }}
                transition={{ duration: 0.15 }}
              >
                <EmojiPicker
                  onPick={(emoji) => {
                    setDraft((value) => value + emoji);
                    inputRef.current?.focus();
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <button
            type="button"
            title="Emoji"
            aria-label="Emoji"
            onClick={() => setShowEmoji((value) => !value)}
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-slate-500 transition",
              showEmoji
                ? "border-blue-300 bg-blue-50 text-blue-600"
                : "border-slate-200 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"
            )}
          >
            <Smile size={18} />
          </button>

          <button
            type="button"
            title="Share current tab"
            aria-label="Share current tab"
            onClick={() => void shareCurrentTab(conversationId)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"
          >
            <LinkIcon size={18} />
          </button>

          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);

              if (
                isLiveContact &&
                connection === "accepted" &&
                Date.now() - lastTypingSent.current > 1500
              ) {
                lastTypingSent.current = Date.now();
                sendTyping(contact!.username);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={
              community
                ? `Message ${community.name}…`
                : `Message ${contactLabel(contact!).split(" ")[0]}…`
            }
            className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 px-4 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500"
          />

          <button
            type="button"
            aria-label="Send message"
            onClick={submit}
            disabled={!draft.trim()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white transition hover:bg-slate-800 disabled:bg-slate-300"
          >
            <Send size={16} />
          </button>
        </div>
      )}

      {showInfo && (
        <InfoPanel
          conversation={conversation}
          contact={contact}
          onClose={() => setShowInfo(false)}
        />
      )}

    </div>
  );
}
