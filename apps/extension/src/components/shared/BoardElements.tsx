import {
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  MapPin,
  MessageSquareText,
  Pencil,
  Send,
  ThumbsUp,
  Trash2,
  Trophy,
} from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/cn";
import type { BoardHighlight, BoardItem, BoardPin } from "../../types/chat";
import { formatRelativeTime } from "../../utils/time";

/**
 * Shared board presentational components.
 *
 * These take everything through props/callbacks — no store hooks, no
 * assumption about where they're mounted. The popup window binds the
 * callbacks to its zustand store actions (a live socket in that JS
 * context); the page pill binds them to the background relay (a
 * single shared connection). Same pixels, same behavior, two data
 * backends — which is the whole point: one implementation to fix,
 * two places it's correct.
 */

export interface BoardCardProps {
  item: BoardItem;
  canRemove: boolean;
  canDecide: boolean;
  hasVoted: boolean;
  onOpen: (url: string) => void;
  onVote: () => void;
  onComment: (text: string) => void;
  onDecide: () => void;
  onRemove: () => void;
}

export function BoardCard({
  item,
  canRemove,
  canDecide,
  hasVoted,
  onOpen,
  onVote,
  onComment,
  onDecide,
  onRemove,
}: BoardCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");

  const submitComment = () => {
    if (!draft.trim()) return;
    onComment(draft.trim());
    setDraft("");
  };

  return (
    <li
      className={cn(
        "overflow-hidden rounded-2xl border transition",
        item.decided ? "border-emerald-300 bg-emerald-50/40" : "border-slate-200"
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(item.url)}
        className="flex w-full items-start gap-3 p-3.5 text-left"
      >
        {item.image ? (
          <img
            src={item.image}
            alt=""
            className="h-16 w-16 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
            <ExternalLink size={20} />
          </span>
        )}

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold leading-snug">
            {item.title}
          </span>
          {item.siteName && (
            <span className="mt-0.5 block text-xs text-slate-400">
              {item.siteName}
            </span>
          )}
          <span className="mt-1 block text-[11px] text-slate-400">
            added by @{item.addedBy} · {formatRelativeTime(item.addedAt)}
          </span>
        </span>
      </button>

      <div className="flex items-center gap-1.5 border-t border-slate-100 px-3 py-2">
        <button
          type="button"
          onClick={onVote}
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition",
            hasVoted
              ? "border-blue-300 bg-blue-50 text-blue-600"
              : "border-slate-200 text-slate-500 hover:border-slate-300"
          )}
        >
          <ThumbsUp size={13} className={hasVoted ? "fill-blue-600" : ""} />
          {item.votes.length}
        </button>

        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-50"
        >
          <MessageSquareText size={12} />
          {item.comments.length}
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>

        <span className="flex-1" />

        {canDecide && !item.decided && (
          <button
            type="button"
            title="Mark as decided"
            onClick={onDecide}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-600"
          >
            <Check size={15} />
          </button>
        )}

        {canRemove && (
          <button
            type="button"
            title="Remove from board"
            onClick={onRemove}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>

      {item.decided && (
        <div className="mx-3 mb-3 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
          <Trophy size={14} />
          Decided
        </div>
      )}

      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-3.5 py-3">
          {item.comments.length > 0 && (
            <ul className="mb-2 space-y-2">
              {item.comments.map((comment) => (
                <li key={comment.id} className="text-xs leading-5">
                  <span className="font-semibold">@{comment.author}</span>{" "}
                  <span className="text-slate-600">{comment.text}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center gap-2">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitComment();
              }}
              placeholder="Add a comment…"
              className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-blue-500"
            />
            <button
              type="button"
              onClick={submitComment}
              disabled={!draft.trim()}
              aria-label="Send comment"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white disabled:bg-slate-300"
            >
              <Send size={12} />
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export function AnnotationGroup({
  item,
  children,
}: {
  item: BoardItem;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200">
      <header className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-3.5 py-2">
        <p className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-600">
          {item.title}
        </p>
        {item.siteName && (
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-400">
            {item.siteName}
          </span>
        )}
      </header>
      <div className="flex flex-col p-1.5">{children}</div>
    </section>
  );
}

export function PinRow({ pin, onJump }: { pin: BoardPin; onJump: () => void }) {
  return (
    <button
      type="button"
      onClick={onJump}
      className="flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-slate-50"
      title="Jump to this spot on the page"
    >
      <MapPin size={14} className="mt-0.5 shrink-0 text-blue-500" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium leading-snug">
          {pin.text}
        </span>
        <span className="mt-0.5 block text-[11px] text-slate-400">
          @{pin.author} · {formatRelativeTime(pin.sentAt)}
        </span>
      </span>
      <ExternalLink size={13} className="mt-1 shrink-0 text-slate-300" />
    </button>
  );
}

export function HighlightRow({
  highlight,
  onJump,
}: {
  highlight: BoardHighlight;
  onJump: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onJump}
      className="flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-slate-50"
      title="Jump to this text on the page"
    >
      <Pencil size={14} className="mt-0.5 shrink-0 text-amber-500" />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] italic leading-snug text-slate-700">
          "{highlight.quote.slice(0, 90)}
          {highlight.quote.length > 90 ? "…" : ""}"
        </span>
        <span className="mt-0.5 block text-[11px] text-slate-400">
          @{highlight.author} · {formatRelativeTime(highlight.sentAt)}
        </span>
      </span>
      <ExternalLink size={13} className="mt-1 shrink-0 text-slate-300" />
    </button>
  );
}
