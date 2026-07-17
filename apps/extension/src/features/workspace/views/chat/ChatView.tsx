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
  FileText,
  Image as ImageIcon,
  MapPin,
  Paperclip,
  Pause,
  Pencil,
  Phone,
  Download,
  Expand,
  RotateCw,
  UserRound,
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

/** In-chat attachment preview: the DEFAULT viewing experience. Covers
 *  the conversation without leaving it — a richer full-tab viewer is
 *  one explicit tap away. Blob URL for the iframe is minted in THIS
 *  document so its lifetime matches the preview. */
function AttachmentLightbox({
  message,
  onClose,
  onFullScreen,
}: {
  message: Message;
  onClose: () => void;
  onFullScreen: () => void;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!message.dataUrl) return;
    let revoked = false;
    let url: string | null = null;
    void (async () => {
      try {
        const blob = await (await fetch(message.dataUrl!)).blob();
        const typed = message.mimeType
          ? new Blob([blob], { type: message.mimeType })
          : blob;
        url = URL.createObjectURL(typed);
        if (!revoked) setObjectUrl(url);
      } catch {
        setObjectUrl(null);
      }
    })();
    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [message.dataUrl, message.mimeType]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const browserViewable =
    message.kind === "file" &&
    (message.mimeType === "application/pdf" ||
      message.mimeType?.startsWith("text/") ||
      message.mimeType?.startsWith("image/"));

  const title =
    message.fileName ??
    (message.kind === "image"
      ? "Photo"
      : message.kind === "video"
        ? "Video"
        : message.kind === "voice"
          ? "Voice message"
          : "File");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview: ${title}`}
      className="absolute inset-0 z-50 flex flex-col bg-slate-950/95"
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <p className="min-w-0 flex-1 truncate text-[12px] font-semibold text-white">
          {title}
          {message.fileSize ? (
            <span className="ml-1.5 font-normal text-slate-400">
              {formatFileSize(message.fileSize)}
            </span>
          ) : null}
        </p>
        <button
          type="button"
          onClick={onFullScreen}
          title="Open full screen"
          className="flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-white/20"
        >
          <Expand size={12} />
          Full screen
        </button>
        {objectUrl && (
          <a
            href={objectUrl}
            download={message.fileName ?? title}
            title="Download"
            className="rounded-lg bg-white/10 p-1.5 text-white transition hover:bg-white/20"
          >
            <Download size={13} />
          </a>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="rounded-lg bg-white/10 p-1.5 text-white transition hover:bg-white/20"
        >
          <X size={13} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        {!message.dataUrl ? (
          <p className="px-6 text-center text-xs leading-5 text-slate-400">
            This attachment is no longer on this device — Tabcom never keeps a
            server copy, so it can't be re-downloaded.
          </p>
        ) : message.kind === "image" ? (
          <img
            src={message.dataUrl}
            alt={title}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        ) : message.kind === "video" ? (
          <video
            src={message.dataUrl}
            controls
            autoPlay
            className="max-h-full max-w-full rounded-lg"
          />
        ) : message.kind === "voice" ? (
          <audio src={message.dataUrl} controls autoPlay className="w-full max-w-xs" />
        ) : browserViewable && objectUrl ? (
          <iframe
            src={objectUrl}
            title={title}
            className="h-full w-full rounded-lg border-0 bg-white"
          />
        ) : (
          <p className="px-6 text-center text-xs leading-5 text-slate-400">
            No inline preview for this file type — use Download above, or Full
            screen for the dedicated viewer.
          </p>
        )}
      </div>
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
  onRetry,
  onOpenAttachment,
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
  onRetry: () => void;
  onOpenAttachment: () => void;
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
              <button
                type="button"
                onClick={onOpenAttachment}
                title="Open full-screen"
                className="-mx-2 -my-1 block"
              >
                <img
                  src={message.dataUrl}
                  alt="Shared photo"
                  className="max-h-64 max-w-full rounded-xl object-contain"
                />
              </button>
            ) : message.kind === "video" && message.dataUrl ? (
              <span className="-mx-2 -my-1 block">
                <video
                  src={message.dataUrl}
                  controls
                  preload="metadata"
                  className="max-h-64 max-w-full rounded-xl bg-slate-900"
                />
                <button
                  type="button"
                  onClick={onOpenAttachment}
                  className={cn(
                    "mt-1 text-[11px] font-semibold underline underline-offset-2",
                    isMine ? "text-slate-300" : "text-slate-500"
                  )}
                >
                  Open full-screen
                </button>
              </span>
            ) : message.kind === "file" && message.dataUrl ? (
              <button
                type="button"
                onClick={onOpenAttachment}
                title="Open file"
                className="flex items-center gap-2.5 text-left"
              >
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                    isMine ? "bg-white/10" : "bg-slate-100"
                  )}
                >
                  <Paperclip size={16} className={isMine ? "text-white" : "text-slate-500"} />
                </span>
                <span className="min-w-0">
                  <span className="block max-w-[180px] truncate font-medium underline underline-offset-2">
                    {message.fileName ?? "File"}
                  </span>
                  <span
                    className={cn(
                      "mt-0.5 block text-xs",
                      isMine ? "text-slate-300" : "text-slate-500"
                    )}
                  >
                    {formatFileSize(message.fileSize) || "File"}
                  </span>
                </span>
              </button>
            ) : message.kind === "contact" && message.contactUsername ? (
              <span className="flex items-center gap-2.5">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white"
                  style={{ backgroundColor: message.contactColor ?? "#64748b" }}
                >
                  {(message.contactName ?? message.contactUsername).charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {message.contactName ?? message.contactUsername}
                  </span>
                  <span
                    className={cn(
                      "mt-0.5 block truncate text-xs",
                      isMine ? "text-slate-300" : "text-slate-500"
                    )}
                  >
                    @{message.contactUsername} · Tabcom contact
                  </span>
                </span>
              </span>
            ) : message.kind === "location" &&
              message.latitude != null &&
              message.longitude != null ? (
              <a
                href={`https://www.google.com/maps?q=${message.latitude},${message.longitude}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-start gap-2 text-left"
              >
                <MapPin size={16} className="mt-0.5 shrink-0" />
                <span>
                  <span className="block font-medium underline underline-offset-2">
                    Shared location
                  </span>
                  <span
                    className={cn(
                      "mt-0.5 block text-xs",
                      isMine ? "text-slate-300" : "text-slate-500"
                    )}
                  >
                    {message.latitude.toFixed(5)}, {message.longitude.toFixed(5)} — open in
                    Maps
                  </span>
                </span>
              </a>
            ) : ["image", "video", "voice", "file"].includes(message.kind) &&
              !message.dataUrl ? (
              // Zero-retention consequence: no server copy exists, so a
              // payload lost from this device is gone — placeholder, no
              // re-download offered because none is possible.
              <span
                className={cn(
                  "flex items-center gap-2 text-xs italic",
                  isMine ? "text-slate-300" : "text-slate-400"
                )}
              >
                <Paperclip size={13} />
                Attachment unavailable on this device
              </span>
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
          {message.status === "failed" && !message.readAt && (
            <>
              <span className="font-semibold text-red-500">· not sent</span>
              <button
                type="button"
                onClick={onRetry}
                className="flex items-center gap-0.5 font-semibold text-blue-600 underline underline-offset-2"
              >
                <RotateCw size={11} />
                Retry
              </button>
            </>
          )}
          {isMine && (message.status !== "failed" || message.readAt) && (
            message.readAt ? (
              <CheckCheck size={13} className="text-blue-500" />
            ) : message.status === "delivered" ? (
              <CheckCheck size={13} className="text-slate-400" />
            ) : message.status === "sending" ? (
              <Check size={13} className="text-slate-300" />
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
import { sendTyping, updatePresence } from "../../../../lib/realtime";
import {
  fileToStagedAttachment,
  formatFileSize,
  openAttachmentViewer,
  stagedToMedia,
  type StagedAttachment,
} from "../../../../lib/attachments";
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
  const retryMessage = useChatStore((state) => state.retryMessage);
  const allContacts = useChatStore((state) => state.contacts);
  const editMessage = useChatStore((state) => state.editMessage);
  const deleteMessage = useChatStore((state) => state.deleteMessage);
  const reactToMessage = useChatStore((state) => state.reactToMessage);
  const markMessageRead = useChatStore((state) => state.markMessageRead);
  const replyTargets = useChatStore((state) => state.replyTargets);
  const setReplyTarget = useChatStore((state) => state.setReplyTarget);
  const myUsername = useProfileStore((state) => state.username);
  const myPresence = useProfileStore((state) => state.presence);
  const setPresence = useProfileStore((state) => state.setPresence);
  /** Appear-offline gate: which action the user tried while hidden —
   *  drives the "switch to Online first" prompt. */
  const [offlineGate, setOfflineGate] = useState<"message" | "call" | null>(null);
  /** Staged (previewed, not yet sent) attachment. */
  const [pending, setPending] = useState<StagedAttachment | null>(null);
  const [attachError, setAttachError] = useState<{
    text: string;
    /** Deep-link into the unified permission center. */
    setupFocus?: string;
  } | null>(null);
  const [attachBusy, setAttachBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showContactPicker, setShowContactPicker] = useState(false);
  /** In-chat attachment preview (lightbox). Full-screen tab viewer is
   *  an explicit escalation from here, never the first hop. */
  const [previewMessage, setPreviewMessage] = useState<Message | null>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
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
    if (myPresence === "offline") {
      setOfflineGate("call");
      return;
    }
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

  /** Stage any file (from picker, drag-drop, or paste) as a preview
   *  above the composer — nothing sends until the user confirms. */
  const stageFile = (file: File | undefined | null) => {
    if (!file) return;
    setAttachError(null);
    setAttachBusy(true);
    void fileToStagedAttachment(file)
      .then((staged) => setPending(staged))
      .catch((error: Error) => setAttachError({ text: error.message }))
      .finally(() => setAttachBusy(false));
  };

  const sendPending = () => {
    if (!pending) return;
    if (myPresence === "offline") {
      setOfflineGate("message");
      return;
    }
    sendMedia(conversationId, stagedToMedia(pending));
    setPending(null);
  };

  const shareLocation = () => {
    setShowAttachMenu(false);
    setAttachError(null);
    if (!navigator.geolocation) {
      setAttachError({ text: "Location isn't available in this browser." });
      return;
    }
    setAttachBusy(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setAttachBusy(false);
        sendMedia(conversationId, {
          kind: "location",
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      (error) => {
        setAttachBusy(false);
        // Same pattern as the voice-note flow: permission prompts often
        // can't render inside this popup, so a denial here usually
        // means "the prompt never appeared" — send the user to the
        // one-time setup tab where it can, instead of a dead end.
        if (error.code === error.PERMISSION_DENIED) {
          setAttachError({
            text: "Location needs a one-time permission — the prompt can't show properly inside this popup. Grant it on the setup page, then come back and tap Location again.",
            setupFocus: "location",
          });
        } else {
          setAttachError({
            text: "Couldn't get a location fix — check that your device's location service is on, then try again.",
          });
        }
      },
      { timeout: 10_000 }
    );
  };

  const sendContactCard = (target: {
    username: string;
    name: string;
    color: string;
  }) => {
    setShowContactPicker(false);
    sendMedia(conversationId, {
      kind: "contact",
      contactUsername: target.username,
      contactName: target.name,
      contactColor: target.color,
    });
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

  if (!conversation) return null;

  // Restored conversations can reference a contact/community the store
  // hasn't (re)resolved yet — e.g. panel opened while offline, before
  // the roster/communities snapshot arrives. Returning null here used
  // to strand the user on a blank pane with no back button. Always
  // render a header with a way back instead.
  if (!contact && !community) {
    return (
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <button
            type="button"
            onClick={closeConversation}
            aria-label="Back to inbox"
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <ArrowLeft size={18} />
          </button>
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
            Conversation
          </h2>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <p className="text-sm leading-5 text-slate-500">
            This chat can't be opened right now — it may need a live
            connection to load. It will come back once you're online.
          </p>
        </div>
      </div>
    );
  }

  const title = community ? community.name : contactLabel(contact!);

  const activeReplyId = replyTargets[conversationId] ?? null;
  const replySource = activeReplyId
    ? messages.find((m) => m.id === activeReplyId)
    : undefined;

  const doSend = () => {
    sendText(conversationId, draft, activeReplyId ?? undefined);
    setDraft("");
    setShowEmoji(false);
    if (activeReplyId) setReplyTarget(conversationId, null);
  };

  const submit = () => {
    // Appear-offline lifecycle: while hidden, outgoing chat is gated
    // behind an explicit "go online first" prompt rather than silently
    // messaging people who see you as offline.
    if (myPresence === "offline") {
      setOfflineGate("message");
      return;
    }
    doSend();
  };

  const goOnlineAndContinue = () => {
    const pending = offlineGate;
    setPresence("online");
    updatePresence("online");
    setOfflineGate(null);
    if (pending === "message" && draft.trim().length > 0) doSend();
    // "call": the user re-taps the call button now that they're online —
    // auto-starting a call the instant a dialog closes is jarring.
  };

  const gatePrivate =
    visibility === "private" && (isLiveContact || isCommunity);

  return (
    <div
      className={"relative flex min-h-0 flex-1 flex-col"}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragOver(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault();
        setDragOver(false);
        stageFile(event.dataTransfer.files[0]);
      }}
    >
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-xl border-2 border-dashed border-blue-400 bg-blue-50/80">
          <p className="text-sm font-semibold text-blue-600">
            Drop to attach — sent device-to-device
          </p>
        </div>
      )}

      {previewMessage && (
        <AttachmentLightbox
          message={
            // Re-resolve from the live thread so edits/deletes while
            // previewing stay honest.
            messages.find((m) => m.id === previewMessage.id) ?? previewMessage
          }
          onClose={() => setPreviewMessage(null)}
          onFullScreen={() => {
            openAttachmentViewer(conversationId, previewMessage);
            setPreviewMessage(null);
          }}
        />
      )}
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
        {/* Zero-retention disclosure: chat history lives only on this
            device; the server intentionally never stores messages. Said
            once, up front, so a server restart "losing" history is an
            explained property instead of a surprise bug report. */}
        <p className="mx-auto max-w-[260px] rounded-full bg-slate-50 px-3 py-1 text-center text-[10px] leading-4 text-slate-400">
          Messages are stored only on your devices — Tabcom servers keep
          no chat history.
        </p>
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
            onRetry={() => retryMessage(conversationId, message.id)}
            onOpenAttachment={() => setPreviewMessage(message)}
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

      {offlineGate && (
        <div className="mx-4 mb-2 flex items-start gap-2.5 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold leading-4 text-slate-800">
              You're appearing offline
            </p>
            <p className="mt-0.5 text-[11px] leading-4 text-slate-500">
              {offlineGate === "call"
                ? "Calls are unavailable while you appear offline. Switch to Online to start voice or video calls."
                : "Switch your status to Online to send messages — right now others see you as offline."}
            </p>
          </div>
          <button
            type="button"
            onClick={goOnlineAndContinue}
            className="shrink-0 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-slate-800"
          >
            Go online
          </button>
          <button
            type="button"
            onClick={() => setOfflineGate(null)}
            className="shrink-0 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-slate-500 transition hover:bg-slate-100"
          >
            Not now
          </button>
        </div>
      )}

      {attachError && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2">
          <p className="min-w-0 flex-1 text-[11px] leading-4 text-red-700">
            {attachError.text}
            {attachError.setupFocus && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={() =>
                    void browser.tabs.create({
                      url:
                        browser.runtime.getURL("/permissions.html" as never) +
                        `?focus=${attachError.setupFocus}`,
                    })
                  }
                  className="font-semibold underline underline-offset-2"
                >
                  Open the setup page
                </button>
              </>
            )}
          </p>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setAttachError(null)}
            className="shrink-0 rounded-lg p-1 text-red-400 transition hover:bg-red-100"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {attachBusy && (
        <div className="mx-4 mb-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
          Preparing attachment…
        </div>
      )}

      {pending && (
        <div className="mx-4 mb-2 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          {pending.kind === "image" ? (
            <img
              src={pending.dataUrl}
              alt={pending.fileName}
              className="h-16 w-16 shrink-0 rounded-xl object-cover"
            />
          ) : pending.kind === "video" ? (
            <video
              src={pending.dataUrl}
              muted
              className="h-16 w-16 shrink-0 rounded-xl bg-slate-900 object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-slate-100">
              <Paperclip size={20} className="text-slate-400" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-slate-900">
              {pending.fileName}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {formatFileSize(pending.fileSize)}
              {" · sent directly to their device — never stored on a server"}
            </p>
          </div>
          <button
            type="button"
            onClick={sendPending}
            className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-slate-800"
          >
            Send
          </button>
          <button
            type="button"
            aria-label="Cancel attachment"
            onClick={() => setPending(null)}
            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {showContactPicker && (
        <div className="mx-4 mb-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          <div className="flex items-center justify-between px-2 py-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Share a contact
            </p>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setShowContactPicker(false)}
              className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100"
            >
              <X size={13} />
            </button>
          </div>
          <div className="max-h-40 overflow-y-auto">
            {allContacts.filter(
              (item) =>
                item.id.startsWith("u-") &&
                connections[item.username] === "accepted" &&
                item.id !== contact?.id
            ).length === 0 ? (
              <p className="px-2 py-3 text-center text-[12px] text-slate-400">
                No other connected contacts to share yet.
              </p>
            ) : (
              allContacts
                .filter(
                  (item) =>
                    item.id.startsWith("u-") &&
                    connections[item.username] === "accepted" &&
                    item.id !== contact?.id
                )
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      sendContactCard({
                        username: item.username,
                        name: item.name,
                        color: item.color,
                      })
                    }
                    className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition hover:bg-slate-50"
                  >
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
                      style={{ backgroundColor: item.color }}
                    >
                      {item.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold text-slate-900">
                        {item.name}
                      </span>
                      <span className="block truncate text-[11px] text-slate-400">
                        @{item.username}
                      </span>
                    </span>
                  </button>
                ))
            )}
          </div>
        </div>
      )}

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
            accept="image/*,video/*"
            className="hidden"
            onChange={(event) => {
              stageFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <input
            ref={docInputRef}
            type="file"
            className="hidden"
            onChange={(event) => {
              stageFile(event.target.files?.[0]);
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
                    <div className="absolute bottom-12 left-0 z-30 w-52 rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg">
                      <button
                        type="button"
                        onClick={pickImage}
                        className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm font-medium transition hover:bg-slate-50"
                      >
                        <ImageIcon size={15} className="text-slate-400" />
                        Photos &amp; Videos
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowAttachMenu(false);
                          docInputRef.current?.click();
                        }}
                        className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm font-medium transition hover:bg-slate-50"
                      >
                        <FileText size={15} className="text-slate-400" />
                        Documents &amp; Files
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowAttachMenu(false);
                          setShowContactPicker(true);
                        }}
                        className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm font-medium transition hover:bg-slate-50"
                      >
                        <UserRound size={15} className="text-slate-400" />
                        Contacts
                      </button>
                      <button
                        type="button"
                        onClick={shareLocation}
                        className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm font-medium transition hover:bg-slate-50"
                      >
                        <MapPin size={15} className="text-slate-400" />
                        Location
                      </button>
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
                  onPaste={(event) => {
                    const file = event.clipboardData?.files?.[0];
                    if (file) {
                      event.preventDefault();
                      stageFile(file);
                    }
                  }}
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
