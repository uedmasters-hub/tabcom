import { motion } from "framer-motion";
import { ExternalLink } from "lucide-react";

import { cn } from "../../lib/cn";
import type { Message } from "../../types/chat";
import { formatClockTime } from "../../utils/time";

/** "me" as the author id — a plain constant, not a store value, safe
 *  to use anywhere a message needs to know if it was locally sent. */
export const ME = "me";

export interface MessageBubbleProps {
  message: Message;
  showAuthor: boolean;
  animate: boolean;
  onOpenLink?: (url: string) => void;
}

export function MessageBubble({
  message,
  showAuthor,
  animate,
  onOpenLink,
}: MessageBubbleProps) {
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
              onClick={() => onOpenLink?.(message.url!)}
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
