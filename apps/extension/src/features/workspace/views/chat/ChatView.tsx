import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  ChevronDown,
  CornerUpLeft,
  ExternalLink,
  Link as LinkIcon,
  Mic,
  Pause,
  Pencil,
  Phone,
  PictureInPicture2,
  Play,
  Plus,
  Send,
  ShieldOff,
  Smile,
  Trash2,
  Video,
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
            ) : message.kind === "voice" && message.dataUrl ? (
              <VoiceBubble
                dataUrl={message.dataUrl}
                durationMs={message.durationMs}
                isMine={isMine}
              />
            ) : message.kind === "image" && message.dataUrl ? (
              <img
                src={message.dataUrl}
                alt="Shared photo"
                className="-mx-2 -my-1 max-h-64 max-w-full rounded-xl object-contain"
              />
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

import { Avatar, CommunityAvatar } from "../../../../components/ui";
import NotificationBell from "../../../../components/layout/NotificationBell";
import { cn } from "../../../../lib/cn";
import { FLOATING_PILL_ENABLED } from "../../../../lib/feature-flags";
import { sendTyping } from "../../../../lib/realtime";
import { ME, useChatStore } from "../../../../stores/chat.store";
import { useProfileStore } from "../../../../stores/profile.store";
import { contactLabel } from "../../../../types/chat";
import type { Message } from "../../../../types/chat";
import { formatClockTime } from "../../../../utils/time";

import ConsentPanel from "./ConsentPanel";
import EmojiPicker from "./EmojiPicker";
import BoardView from "../board/BoardView";
import CommunityManageView from "../community/CommunityManageView";
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
  const live = useChatStore((state) => state.live);
  const messages = useChatStore(
    (state) => state.messages[conversationId] ?? NO_MESSAGES
  );
  const typing = useChatStore((state) => state.typing);
  const connections = useChatStore((state) => state.connections);

  const closeConversation = useChatStore((state) => state.closeConversation);
  const sendText = useChatStore((state) => state.sendText);
  const sendMedia = useChatStore((state) => state.sendMedia);
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
  const [showCallMenu, setShowCallMenu] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [recording, setRecording] = useState<{
    recorder: MediaRecorder;
    startedAt: number;
  } | null>(null);
  const [, recTick] = useState(0);
  const [micError, setMicError] = useState<
    { kind: "blocked" } | { kind: "message"; text: string } | null
  >(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-dismiss transient error messages; the "blocked" case stays
  // until the person acts on it or dismisses it themselves — it won't
  // fix itself on a timer the way "no mic found" might on a retry.
  useEffect(() => {
    if (!micError || micError.kind === "blocked") return;
    const timer = setTimeout(() => setMicError(null), 4000);
    return () => clearTimeout(timer);
  }, [micError]);

  // Re-render once a second while recording so the timer stays live.
  useEffect(() => {
    if (!recording) return;
    const interval = setInterval(() => recTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [recording]);

  const startCall = (video: boolean) => {
    setShowCallMenu(false);
    if (!contact) return;
    void browser.runtime.sendMessage({
      type: "tabcom:call-start",
      peer: contact.username,
      peerName: contact.name,
      peerColor: contact.color,
      video,
    });
  };

  const openMicPermissionHelper = () => {
    // A full, stable tab — not chrome://settings directly, and not
    // retrying inside this popup — because the actual problem here is
    // usually that getUserMedia's prompt can't reliably render inside
    // Tabcom's small transient popup at all, not that the permission
    // was explicitly set to Block (that's a real, separate case, but
    // it turned out to be the less common one — a Brave/Chromium
    // extension-origin quirk can make the Permissions API report
    // "denied" even when chrome://settings/content/microphone shows
    // no site listed as blocked at all). Same origin, so granting it
    // here in a stable tab context makes it work back in the popup.
    void browser.tabs.create({ url: browser.runtime.getURL("/permissions.html" as never) });
  };

  const startVoiceRecording = async () => {
    setMicError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Explicit, low bitrate — voice intelligibility doesn't need much,
      // and an UNcapped MediaRecorder's browser-default bitrate (often
      // 128kbps) pushes a 60s note's base64 size well past the relay's
      // frame limit unpredictably (varies with speech content), which
      // is exactly what made this "work sometimes" before. At 24kbps,
      // even the full 60s cap stays under ~250KB raw — comfortably
      // inside the server's 8MB ceiling with room to spare.
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 24_000,
      });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        // "cancelled" flag set by cancelVoiceRecording — discard silently.
        if ((recorder as MediaRecorder & { cancelled?: boolean }).cancelled) return;
        const durationMs = Date.now() - startedAtRef.current;
        if (durationMs < 500) return; // accidental tap — nothing worth sending
        const blob = new Blob(chunks, { type: mimeType });
        const reader = new FileReader();
        reader.onload = () => {
          sendMedia(conversationId, {
            kind: "voice",
            dataUrl: reader.result as string,
            durationMs,
          });
        };
        reader.readAsDataURL(blob);
      };
      const startedAtRef = { current: Date.now() };
      recorder.start();
      setRecording({ recorder, startedAt: startedAtRef.current });
      // Hard cap at 60s regardless — keeps payload size predictable
      // and recordings focused, well within the server's 8MB ceiling
      // at the 24kbps rate set above.
      setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
        setRecording((current) => (current?.recorder === recorder ? null : current));
      }, 60_000);
    } catch (error) {
      // Silent failure here was exactly the problem — "sometimes it
      // just doesn't work" with zero feedback is indistinguishable
      // from an actual bug. Give a real reason instead.
      const name = error instanceof DOMException ? error.name : "";
      if (name === "NotAllowedError") {
        setMicError({ kind: "blocked" });
      } else if (name === "NotFoundError") {
        setMicError({ kind: "message", text: "No microphone found on this device." });
      } else if (name === "NotReadableError") {
        setMicError({
          kind: "message",
          text: "Microphone is already in use by another app or tab.",
        });
      } else {
        setMicError({ kind: "message", text: "Couldn't start recording — try again." });
      }
    }
  };

  const stopAndSendVoice = () => {
    if (!recording) return;
    recording.recorder.stop();
    setRecording(null);
  };

  const cancelVoiceRecording = () => {
    if (!recording) return;
    (recording.recorder as MediaRecorder & { cancelled?: boolean }).cancelled = true;
    recording.recorder.stop();
    setRecording(null);
  };

  const pickImage = () => {
    setShowAttachMenu(false);
    fileInputRef.current?.click();
  };

  const handleImageChosen = (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    // Downscale so the relay's 1MB frame limit is never hit — 1280px
    // max edge at 0.8 JPEG lands well under it for photos.
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const maxEdge = 1280;
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      sendMedia(conversationId, {
        kind: "image",
        dataUrl: canvas.toDataURL("image/jpeg", 0.8),
      });
    };
    img.src = objectUrl;
  };
  // Board-first: the board (shared tabs/pins/areas) is the community's
  // primary surface, chat is secondary — see product decision log.
  const [tab, setTab] = useState<"chat" | "board">("board");
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

        {community ? (
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              type="button"
              onClick={() => setShowInfo(true)}
              aria-label={`${community.name} details`}
              title={community.name}
              className="relative shrink-0 rounded-full transition hover:ring-2 hover:ring-slate-200"
            >
              <CommunityAvatar
                name={community.name}
                imageVersion={community.imageVersion}
                communityId={community.id}
                size="sm"
              />
              <span
                title={live ? "Connected to realtime server" : "Offline — local demo mode"}
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white",
                  live ? "bg-emerald-500" : "bg-slate-300"
                )}
              />
            </button>

            <div
              className="inline-flex w-fit shrink-0 gap-0.5 rounded-full bg-slate-100 p-0.5"
              role="tablist"
              aria-label="View"
            >
              {(["board", "chat"] as const).map((id) => (
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
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <button
              type="button"
              onClick={() => setShowInfo(true)}
              className="flex min-w-0 items-center gap-3 text-left"
            >
              <span className="relative shrink-0">
                <Avatar
                  name={contact!.name}
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
              </span>

              <span className="min-w-0 truncate text-sm font-semibold leading-tight">
                {title}
              </span>
            </button>

            {isTyping && (
              <span className="ml-11 text-xs text-slate-500">typing…</span>
            )}
          </div>
        )}

        {!community && contact?.id.startsWith("u-") && connection === "accepted" && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowCallMenu((value) => !value)}
              title="Start a call"
              aria-label="Start a call"
              aria-expanded={showCallMenu}
              className={cn(
                "flex items-center gap-0.5 rounded-full px-2 py-1.5 transition",
                showCallMenu
                  ? "bg-slate-100 text-slate-900"
                  : "text-slate-400 hover:bg-slate-100 hover:text-slate-900"
              )}
            >
              <Video size={17} />
              <ChevronDown size={13} />
            </button>

            {showCallMenu && (
              <>
                <button
                  type="button"
                  aria-label="Close call menu"
                  className="fixed inset-0 z-20 cursor-default"
                  onClick={() => setShowCallMenu(false)}
                />
                <div className="absolute right-0 top-10 z-30 flex w-36 flex-col gap-1.5 rounded-2xl border border-slate-100 bg-white p-2 shadow-lg">
                  <button
                    type="button"
                    onClick={() => startCall(false)}
                    className="flex items-center justify-center gap-2 rounded-xl bg-slate-100 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-200"
                  >
                    <Phone size={15} />
                    Voice
                  </button>
                  <button
                    type="button"
                    onClick={() => startCall(true)}
                    className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                  >
                    <Video size={15} />
                    Video
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {FLOATING_PILL_ENABLED && pipEnabled && (
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

        <NotificationBell />
      </div>

      {isCommunity && tab === "board" && community ? (
        <BoardView community={community} />
      ) : (
        <>
      {/* Messages */}
      <div
        className={cn(
          "space-y-3 overflow-y-auto px-4 py-4",
          // While consent is pending there's usually just the one
          // system notice ("X wants to connect") — let it size to its
          // content instead of flex-growing, so the illustrated
          // ConsentPanel below gets the remaining space and the
          // visual weight the mockups show, rather than splitting the
          // screen into a mostly-blank message area + a thin bottom bar.
          contact && isLiveContact && connection !== "accepted" ? "shrink-0" : "flex-1"
        )}
      >
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
        {micError && (
          <div className="flex items-center justify-between gap-2 border-t border-red-100 bg-red-50 px-4 py-2">
            {micError.kind === "blocked" ? (
              <>
                <p className="text-xs leading-4 text-red-700">
                  Couldn't get microphone access — this is usually because
                  the permission prompt can't show properly inside this
                  popup, not that it's actually blocked.{" "}
                  <button
                    type="button"
                    onClick={openMicPermissionHelper}
                    className="font-semibold underline underline-offset-2"
                  >
                    Open the one-time setup tab
                  </button>{" "}
                  to grant it there, then come back and try again.
                </p>
                <button
                  type="button"
                  onClick={() => setMicError(null)}
                  aria-label="Dismiss"
                  className="shrink-0 text-red-400 transition hover:text-red-600"
                >
                  <X size={13} />
                </button>
              </>
            ) : (
              <>
                <p className="text-xs text-red-700">{micError.text}</p>
                <button
                  type="button"
                  onClick={() => setMicError(null)}
                  aria-label="Dismiss"
                  className="shrink-0 text-red-400 transition hover:text-red-600"
                >
                  <X size={13} />
                </button>
              </>
            )}
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

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              handleImageChosen(event.target.files?.[0]);
              event.target.value = "";
            }}
          />

          {recording ? (
            /* Recording replaces the whole input row — one clear mode. */
            <div className="flex h-10 flex-1 items-center gap-3 rounded-full border border-red-200 bg-red-50 px-4">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              <span className="flex-1 text-sm font-medium tabular-nums text-red-700">
                {Math.floor((Date.now() - recording.startedAt) / 1000)}s
              </span>
              <button
                type="button"
                onClick={cancelVoiceRecording}
                className="text-xs font-semibold text-slate-500 transition hover:text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={stopAndSendVoice}
                aria-label="Send voice message"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-white"
              >
                <Send size={13} />
              </button>
            </div>
          ) : (
            <>
              <div className="relative shrink-0">
                <button
                  type="button"
                  title="Add"
                  aria-label="Add attachment"
                  aria-expanded={showAttachMenu}
                  onClick={() => setShowAttachMenu((value) => !value)}
                  className="flex h-10 w-8 items-center justify-center text-slate-500 transition hover:text-slate-900"
                >
                  <Plus size={20} />
                </button>

                {showAttachMenu && (
                  <>
                    <button
                      type="button"
                      aria-label="Close menu"
                      className="fixed inset-0 z-20 cursor-default"
                      onClick={() => setShowAttachMenu(false)}
                    />
                    <div className="absolute bottom-12 left-0 z-30 w-44 rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg">
                      {!community && (
                        <button
                          type="button"
                          onClick={pickImage}
                          className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm font-medium transition hover:bg-slate-50"
                        >
                          <ExternalLink size={15} className="text-slate-400" />
                          Photo
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setShowAttachMenu(false);
                          void shareCurrentTab(conversationId);
                        }}
                        className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm font-medium transition hover:bg-slate-50"
                      >
                        <LinkIcon size={15} className="text-slate-400" />
                        Share current tab
                      </button>
                    </div>
                  </>
                )}
              </div>

              <div className="flex h-10 min-w-0 flex-1 items-center gap-1 rounded-full border border-slate-200 px-2 transition-colors focus-within:border-blue-500">
                <button
                  type="button"
                  title="Emoji"
                  aria-label="Emoji"
                  onClick={() => setShowEmoji((value) => !value)}
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition",
                    showEmoji ? "text-blue-600" : "text-slate-400 hover:text-slate-600"
                  )}
                >
                  <Smile size={17} />
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
                  className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
                />

                {!community && (
                  <button
                    type="button"
                    title="Record a voice message"
                    aria-label="Record a voice message"
                    onClick={() => void startVoiceRecording()}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:text-slate-600"
                  >
                    <Mic size={16} />
                  </button>
                )}
              </div>
            </>
          )}

          {!recording && (
            <button
              type="button"
              aria-label="Send message"
              onClick={submit}
              disabled={!draft.trim()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white transition hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400"
            >
              <Send size={16} />
            </button>
          )}
        </div>
        </>
      )}

      {showInfo && (
        community ? (
          <CommunityManageView
            community={community}
            onClose={() => setShowInfo(false)}
          />
        ) : (
          <InfoPanel
            conversation={conversation}
            contact={contact}
            onClose={() => setShowInfo(false)}
          />
        )
      )}

    </div>
  );
}

/** Compact inline voice-note player: play/pause + elapsed/total. Uses a
 *  hidden HTMLAudioElement rather than native controls, which don't fit
 *  a 320px-wide popup bubble. */
function VoiceBubble({
  dataUrl,
  durationMs,
  isMine,
}: {
  dataUrl: string;
  durationMs?: number;
  isMine: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const audio = new Audio(dataUrl);
    audioRef.current = audio;
    const onTime = () => setElapsed(audio.currentTime * 1000);
    const onEnd = () => {
      setPlaying(false);
      setElapsed(0);
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnd);
      audioRef.current = null;
    };
  }, [dataUrl]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      void audio.play();
      setPlaying(true);
    }
  };

  const fmt = (ms: number) => {
    const total = Math.round(ms / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  };

  const totalMs = durationMs ?? 0;
  const progress = totalMs > 0 ? Math.min(100, (elapsed / totalMs) * 100) : 0;

  return (
    <span className="flex min-w-40 items-center gap-2.5">
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause voice message" : "Play voice message"}
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          isMine ? "bg-white/15" : "bg-slate-900/10"
        )}
      >
        {playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
      </button>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block h-1 overflow-hidden rounded-full",
            isMine ? "bg-white/20" : "bg-slate-900/10"
          )}
        >
          <span
            className={cn("block h-full rounded-full", isMine ? "bg-white" : "bg-slate-900")}
            style={{ width: `${progress}%` }}
          />
        </span>
        <span
          className={cn(
            "mt-1 block text-[11px] tabular-nums",
            isMine ? "text-slate-300" : "text-slate-500"
          )}
        >
          {playing ? fmt(elapsed) : fmt(totalMs)}
        </span>
      </span>
    </span>
  );
}
