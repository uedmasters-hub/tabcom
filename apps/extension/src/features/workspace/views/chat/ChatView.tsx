import { ArrowLeft, ExternalLink, Link as LinkIcon, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";

import { Avatar } from "../../../../components/ui";
import { cn } from "../../../../lib/cn";
import { ME, useChatStore } from "../../../../stores/chat.store";
import type { Message } from "../../../../types/chat";
import { formatClockTime } from "../../../../utils/time";

const presenceColors = {
  online: "bg-emerald-500",
  away: "bg-amber-400",
  busy: "bg-red-500",
  offline: "bg-slate-300",
} as const;

/**
 * Stable fallback so the selector never returns a fresh reference.
 * A new `?? []` per call makes useSyncExternalStore loop -> blank screen.
 */
const NO_MESSAGES: Message[] = [];

function MessageBubble({ message }: { message: Message }) {
  const isMine = message.authorId === ME;

  return (
    <div className={cn("flex", isMine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-6",
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

        <span
          className={cn(
            "mt-1 block text-right text-[10px]",
            isMine ? "text-slate-400" : "text-slate-400"
          )}
        >
          {formatClockTime(message.sentAt)}
        </span>
      </div>
    </div>
  );
}

export default function ChatView({
  conversationId,
}: {
  conversationId: string;
}) {
  const contacts = useChatStore((state) => state.contacts);
  const conversations = useChatStore((state) => state.conversations);
  const messages = useChatStore(
    (state) => state.messages[conversationId] ?? NO_MESSAGES
  );
  const typing = useChatStore((state) => state.typing);

  const closeConversation = useChatStore((state) => state.closeConversation);
  const sendText = useChatStore((state) => state.sendText);
  const shareCurrentTab = useChatStore((state) => state.shareCurrentTab);

  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const conversation = conversations.find(
    (item) => item.id === conversationId
  );
  const contact = contacts.find(
    (item) => item.id === conversation?.contactId
  );

  const isTyping = contact ? typing.includes(contact.id) : false;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isTyping]);

  if (!conversation || !contact) return null;

  const submit = () => {
    sendText(conversationId, draft);
    setDraft("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Thread header */}
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
        <button
          type="button"
          onClick={closeConversation}
          aria-label="Back to inbox"
          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
        >
          <ArrowLeft size={18} />
        </button>

        <Avatar name={contact.name} color={contact.color} size="sm" />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight">
            {contact.name}
          </p>
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                presenceColors[contact.presence]
              )}
            />
            {isTyping ? "typing…" : contact.presence}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
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

      {/* Composer */}
      <div className="flex items-center gap-2 border-t border-slate-200 px-4 py-3">
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
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={`Message ${contact.name.split(" ")[0]}…`}
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
    </div>
  );
}
