import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  CornerUpLeft,
  ExternalLink,
  Info,
  Link as LinkIcon,
  Pencil,
  PictureInPicture2,
  Send,
  ShieldOff,
  Smile,
  Trash2,
  X,
} from "lucide-react";

const presenceColors = {
  online: "bg-emerald-500",
  away: "bg-amber-400",
  busy: "bg-red-500",
  offline: "bg-slate-300",
} as const;

/** Stable fallback so the selector never returns a fresh reference. */
const NO_MESSAGES: Message[] = [];

const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "😮", "😢"];

function ReactionPills({
  reactions,
  myUsername,
  isMine,
  onToggle,
}: {
  reactions: Message["reactions"];
  myUsername: string;
  isMine: boolean;
  onToggle: (emoji: string) => void;
}) {
  if (!reactions || reactions.length === 0) return null;
  return (
    <div className={cn("mt-1 flex flex-wrap gap-1", isMine ? "justify-end" : "justify-start")}>
      {reactions.map((r) => {
        const mine = r.usernames.includes(myUsername);
        return (
          <button
            key={r.emoji}
            type="button"
            onClick={() => onToggle(r.emoji)}
            className={cn(
              "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px]",
              mine
                ? "border-blue-300 bg-blue-50 text-blue-600"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
            )}
          >
            <span>{r.emoji}</span>
            <span className="font-semibold">{r.usernames.length}</span>
          </button>
        );
      })}
    </div>
  );
}

function MessageBubble({
  message,
  showAuthor,
  animate,
  myUsername,
  replyPreview,
  isEditing,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  onReply,
  onReact,
  onOpenReplySource,
}: {
  message: Message;
  showAuthor: boolean;
  animate: boolean;
  myUsername: string;
  replyPreview?: Message;
  isEditing: boolean;
  onStartEdit: () => void;
  onSaveEdit: (text: string) => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onReply: () => void;
  onReact: (emoji: string) => void;
  onOpenReplySource: () => void;
}) {
  const isMine = message.authorId === ME;
  const [editDraft, setEditDraft] = useState(message.text);
  const [showReactPicker, setShowReactPicker] = useState(false);

  if (message.kind === "system") {
    return (
      <div className="flex justify-center">
        <p className="max-w-[85%] rounded-full bg-slate-50 px-4 py-1.5 text-center text-xs text-slate-500">
          {message.text}
        </p>
      </div>
    );
  }

  if (message.deletedAt) {
    return (
      <div className={cn("flex", isMine ? "justify-end" : "justify-start")}>
        <p className="max-w-[75%] rounded-2xl bg-slate-50 px-4 py-2 text-sm italic text-slate-400">
          {isMine ? "You deleted this message" : "This message was deleted"}
        </p>
      </div>
    );
  }

  const bubble = (
    <div id={`msg-${message.id}`} className={cn("group flex", isMine ? "justify-end" : "justify-start")}>
      <div className="relative max-w-[75%]">
        {showAuthor && !isMine && (
          <p
            className="mb-0.5 ml-3 text-[11px] font-semibold"
            style={{ color: message.authorColor ?? "#64748B" }}
          >
            {message.authorName}
          </p>
        )}

        {replyPreview && (
          <button
            type="button"
            onClick={onOpenReplySource}
            className={cn(
              "mb-1 flex w-full items-start gap-1.5 rounded-lg border-l-2 border-slate-300 bg-slate-50/80 px-2.5 py-1.5 text-left text-xs text-slate-500 transition hover:bg-slate-100",
              isMine && "ml-auto"
            )}
          >
            <CornerUpLeft size={11} className="mt-0.5 shrink-0" />
            <span className="truncate">
              {replyPreview.deletedAt ? "Deleted message" : replyPreview.text}
            </span>
          </button>
        )}

        {isEditing ? (
          <div className="flex items-center gap-1.5 rounded-2xl border border-blue-300 bg-white px-3 py-2">
            <input
              autoFocus
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSaveEdit(editDraft);
                if (e.key === "Escape") onCancelEdit();
              }}
              className="min-w-0 flex-1 text-sm outline-none"
            />
            <button
              type="button"
              onClick={() => onSaveEdit(editDraft)}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white"
            >
              <Check size={12} />
            </button>
            <button
              type="button"
              onClick={onCancelEdit}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
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
          </div>
        )}

        <ReactionPills
          reactions={message.reactions}
          myUsername={myUsername}
          isMine={isMine}
          onToggle={onReact}
        />

        <p
          className={cn(
            "mt-1 flex items-center gap-1 text-[11px] text-slate-400",
            isMine ? "justify-end" : "justify-start"
          )}
        >
          {message.editedAt && <span className="italic">edited ·</span>}
          {formatClockTime(message.sentAt)}
          {message.status === "failed" && (
            <span className="font-semibold text-red-500">· not sent</span>
          )}
          {isMine && message.status !== "failed" && (
            message.readAt ? (
              <CheckCheck size={13} className="text-blue-500" />
            ) : (
              <Check size={13} className="text-slate-400" />
            )
          )}
        </p>

        {/* Hover action row */}
        {!isEditing && (
          <div
            className={cn(
              "absolute top-0 hidden items-center gap-0.5 rounded-full border border-slate-200 bg-white p-0.5 shadow-sm group-hover:flex",
              isMine ? "-left-[92px]" : "-right-[92px]"
            )}
          >
            <button
              type="button"
              title="Reply"
              onClick={onReply}
              className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
            >
              <CornerUpLeft size={13} />
            </button>
            <div className="relative">
              <button
                type="button"
                title="React"
                onClick={() => setShowReactPicker((v) => !v)}
                className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
              >
                <Smile size={13} />
              </button>
              {showReactPicker && (
                <div
                  className={cn(
                    "absolute top-8 z-10 flex gap-0.5 rounded-full border border-slate-200 bg-white p-1 shadow-lg",
                    isMine ? "right-0" : "left-0"
                  )}
                >
                  {QUICK_REACTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => {
                        onReact(emoji);
                        setShowReactPicker(false);
                      }}
                      className="rounded-full p-1 text-base transition hover:bg-slate-100"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {isMine && message.kind === "text" && (
              <button
                type="button"
                title="Edit"
                onClick={onStartEdit}
                className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
              >
                <Pencil size={13} />
              </button>
            )}
            {isMine && (
              <button
                type="button"
                title="Delete"
                onClick={onDelete}
                className="rounded-full p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        )}
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
import BoardView from "../board/BoardView";
import InfoPanel from "./InfoPanel";
import {
  isFloatOpen,
  toggleFloatingChat,
} from "../../../../lib/floating-chat";

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
  const editMessage = useChatStore((state) => state.editMessage);
  const deleteMessage = useChatStore((state) => state.deleteMessage);
  const reactToMessage = useChatStore((state) => state.reactToMessage);
  const markMessageRead = useChatStore((state) => state.markMessageRead);
  const replyTargets = useChatStore((state) => state.replyTargets);
  const setReplyTarget = useChatStore((state) => state.setReplyTarget);
  const myUsername = useProfileStore((state) => state.username);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const shareCurrentTab = useChatStore((state) => state.shareCurrentTab);

  const visibility = useProfileStore((state) => state.visibility);
  const animations = useProfileStore((state) => state.animations);
  const pipEnabled = useProfileStore((state) => state.pipEnabled);
  const [floating, setFloating] = useState(isFloatOpen());

  const [draft, setDraft] = useState("");
  const [showInfo, setShowInfo] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [tab, setTab] = useState<"chat" | "board">("chat");
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

  // Mark-as-read: DM only, matches how most chat apps do it — opening
  // (or staying on) the conversation marks the latest incoming message
  // read, rather than tracking per-bubble scroll visibility.
  const lastReadSent = useRef<string | null>(null);
  useEffect(() => {
    if (isCommunity || !isLiveContact) return;
    const lastIncoming = [...messages].reverse().find((m) => m.authorId !== ME);
    if (lastIncoming && lastIncoming.id !== lastReadSent.current) {
      lastReadSent.current = lastIncoming.id;
      markMessageRead(conversationId, lastIncoming.id);
    }
  }, [conversationId, isCommunity, isLiveContact, messages, markMessageRead]);

  if (!conversation || (!contact && !community)) return null;

  const title = community ? community.name : contactLabel(contact!);
  const subtitle = community
    ? `${community.members.length} member${community.members.length === 1 ? "" : "s"}`
    : isTyping
      ? "typing…"
      : contact!.presence;

  const activeReplyId = replyTargets[conversationId] ?? null;
  const replySource = activeReplyId
    ? messages.find((m) => m.id === activeReplyId)
    : undefined;

  const submit = () => {
    sendText(conversationId, draft, activeReplyId ?? undefined);
    setDraft("");
    setShowEmoji(false);
    if (activeReplyId) setReplyTarget(conversationId, null);
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

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <button
            type="button"
            onClick={() => setShowInfo(true)}
            className="flex min-w-0 items-center gap-3 text-left"
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

            <span className="min-w-0 truncate text-sm font-semibold leading-tight">
              {title}
            </span>
          </button>

          {/* Second row: for communities this IS the Chat/Board switch —
              no separate full-width bar underneath. For 1:1 chats it's
              the presence/typing subtitle, same as before. */}
          {community ? (
            <div
              className="ml-11 inline-flex w-fit gap-0.5 rounded-full bg-slate-100 p-0.5"
              role="tablist"
              aria-label="View"
            >
              {(["chat", "board"] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={cn(
                    "rounded-full px-3 py-1 text-[11px] font-semibold capitalize transition",
                    tab === id
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  {id === "board" ? "Board" : "Chat"}
                  {id === "board" && community.board.length > 0 && (
                    <span className="ml-1 text-slate-400">
                      · {community.board.length}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <span className="ml-11 flex items-center gap-1.5 text-xs text-slate-500">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  presenceColors[contact!.presence]
                )}
              />
              {subtitle}
            </span>
          )}
        </div>

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

      {isCommunity && tab === "board" && community ? (
        <BoardView community={community} />
      ) : (
        <>
      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            showAuthor={isCommunity}
            animate={animations}
            myUsername={myUsername}
            replyPreview={
              message.replyToId
                ? messages.find((m) => m.id === message.replyToId)
                : undefined
            }
            isEditing={editingMessageId === message.id}
            onStartEdit={() => setEditingMessageId(message.id)}
            onSaveEdit={(text) => {
              if (text.trim() && text.trim() !== message.text) {
                editMessage(conversationId, message.id, text);
              }
              setEditingMessageId(null);
            }}
            onCancelEdit={() => setEditingMessageId(null)}
            onDelete={() => deleteMessage(conversationId, message.id)}
            onReply={() => {
              setReplyTarget(conversationId, message.id);
              inputRef.current?.focus();
            }}
            onReact={(emoji) => reactToMessage(conversationId, message.id, emoji)}
            onOpenReplySource={() => {
              const el = document.getElementById(`msg-${message.replyToId}`);
              el?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
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

      </>
      )}

      {/* Composer — consent gate, then privacy gate (server enforces both) */}
      {isCommunity && tab === "board" ? null : contact && isLiveContact && connection !== "accepted" ? (
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
        <>
        {replySource && (
          <div className="flex items-center gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2">
            <CornerUpLeft size={13} className="shrink-0 text-slate-400" />
            <p className="min-w-0 flex-1 truncate text-xs text-slate-500">
              Replying to <span className="font-medium">{replySource.deletedAt ? "a deleted message" : replySource.text}</span>
            </p>
            <button
              type="button"
              onClick={() => setReplyTarget(conversationId, null)}
              className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-200"
            >
              <X size={13} />
            </button>
          </div>
        )}
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
        </>
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
