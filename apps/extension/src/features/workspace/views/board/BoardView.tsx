import {
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  MapPin,
  MessageSquareText,
  Pencil,
  Plus,
  Send,
  ThumbsUp,
  Trash2,
  Trophy,
} from "lucide-react";
import { useState } from "react";
import { browser } from "wxt/browser";

import { Button, EmptyState } from "../../../../components/ui";
import { cn } from "../../../../lib/cn";
import { useChatStore } from "../../../../stores/chat.store";
import { useProfileStore } from "../../../../stores/profile.store";
import type { BoardItem, Community } from "../../../../types/chat";
import { formatRelativeTime } from "../../../../utils/time";

/**
 * Shared decision board for a community: add listings from any tab,
 * vote, comment, and let the admin conclude with a decision. This is
 * the "conclude" step most collaborative-browsing tools skip.
 */
async function sendToActiveTab(message: Record<string, unknown>) {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await browser.tabs.sendMessage(tab.id, message);
  } catch {
    // content script not present on this page (e.g. chrome://) — ignore
  }
}

export default function BoardView({ community }: { community: Community }) {
  const username = useProfileStore((state) => state.username);
  const addCurrentTabToBoard = useChatStore(
    (state) => state.addCurrentTabToBoard
  );
  const decideBoardItem = useChatStore((state) => state.decideBoardItem);

  const isAdmin = community.admin === username;
  const decided = community.board.find((item) => item.decided);

  if (community.board.length === 0) {
    return (
      <div className="flex flex-1 flex-col">
        <BoardToolbar
          communityId={community.id}
          onAdd={() => void addCurrentTabToBoard(community.id)}
        />
        <EmptyState
          className="flex-1"
          icon={<ThumbsUp size={24} />}
          title="No items yet"
          description="Browse to a listing, then Add, Pin, or Highlight directly on the page — it shows up here for everyone."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <BoardToolbar
        communityId={community.id}
        onAdd={() => void addCurrentTabToBoard(community.id)}
      />

      {decided && (
        <div className="mx-4 mt-1 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <Trophy size={16} className="shrink-0 text-emerald-600" />
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-emerald-700">
            Decided: {decided.title}
          </p>
          {isAdmin && (
            <button
              type="button"
              onClick={() => decideBoardItem(community.id, null)}
              className="shrink-0 text-xs font-medium text-emerald-600 underline"
            >
              Reopen
            </button>
          )}
        </div>
      )}

      <ul className="flex flex-col gap-3 px-4 py-4">
        {community.board.map((item) => (
          <BoardCard
            key={item.id}
            item={item}
            communityId={community.id}
            isAdmin={isAdmin}
            username={username}
          />
        ))}
      </ul>
    </div>
  );
}

function BoardToolbar({
  communityId,
  onAdd,
}: {
  communityId: string;
  onAdd: () => void;
}) {
  return (
    <div className="flex gap-2 border-b border-slate-100 px-4 py-3">
      <Button
        size="md"
        variant="outline"
        className="flex-1"
        leftIcon={<Plus size={14} />}
        onClick={onAdd}
      >
        Add tab
      </Button>

      <Button
        size="md"
        variant="outline"
        className="flex-1"
        leftIcon={<MapPin size={14} />}
        onClick={() =>
          void sendToActiveTab({ type: "tabcom:enter-pin-mode", communityId })
        }
      >
        Pin
      </Button>

      <Button
        size="md"
        variant="outline"
        className="flex-1"
        leftIcon={<Pencil size={14} />}
        onClick={() =>
          void sendToActiveTab({
            type: "tabcom:enter-highlight-mode",
            communityId,
          })
        }
      >
        Highlight
      </Button>
    </div>
  );
}

function BoardCard({
  item,
  communityId,
  isAdmin,
  username,
}: {
  item: BoardItem;
  communityId: string;
  isAdmin: boolean;
  username: string;
}) {
  const removeBoardItem = useChatStore((state) => state.removeBoardItem);
  const commentOnBoardItem = useChatStore((state) => state.commentOnBoardItem);
  const voteOnBoardItem = useChatStore((state) => state.voteOnBoardItem);
  const decideBoardItem = useChatStore((state) => state.decideBoardItem);

  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");

  const hasVoted = item.votes.includes(username);
  const canRemove = isAdmin || item.addedBy === username;

  const submitComment = () => {
    if (!draft.trim()) return;
    commentOnBoardItem(communityId, item.id, draft);
    setDraft("");
  };

  return (
    <li
      className={cn(
        "overflow-hidden rounded-2xl border transition",
        item.decided
          ? "border-emerald-300 bg-emerald-50/40"
          : "border-slate-200"
      )}
    >
      <button
        type="button"
        onClick={() => browser.tabs.create({ url: item.url })}
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
          onClick={() => voteOnBoardItem(communityId, item.id)}
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
          {(item.pins.length > 0 || item.highlights.length > 0) && (
            <span className="ml-1 flex items-center gap-1 text-slate-400">
              {item.pins.length > 0 && (
                <span className="flex items-center gap-0.5">
                  <MapPin size={11} /> {item.pins.length}
                </span>
              )}
              {item.highlights.length > 0 && (
                <span className="flex items-center gap-0.5">
                  <Pencil size={11} /> {item.highlights.length}
                </span>
              )}
            </span>
          )}
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>

        <span className="flex-1" />

        {isAdmin && !item.decided && (
          <button
            type="button"
            title="Mark as decided"
            onClick={() => decideBoardItem(communityId, item.id)}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-600"
          >
            <Check size={15} />
          </button>
        )}

        {canRemove && (
          <button
            type="button"
            title="Remove from board"
            onClick={() => removeBoardItem(communityId, item.id)}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>

      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-3.5 py-3">
          {item.pins.length > 0 && (
            <ul className="mb-2 space-y-1.5">
              {item.pins.map((pin) => (
                <li key={pin.id} className="flex items-start gap-1.5 text-xs leading-5">
                  <MapPin size={12} className="mt-0.5 shrink-0 text-blue-500" />
                  <span>
                    <span className="font-semibold">@{pin.author}</span>{" "}
                    <span className="text-slate-600">{pin.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {item.highlights.length > 0 && (
            <ul className="mb-2 space-y-1.5">
              {item.highlights.map((highlight) => (
                <li key={highlight.id} className="flex items-start gap-1.5 text-xs leading-5">
                  <Pencil size={12} className="mt-0.5 shrink-0 text-amber-500" />
                  <span>
                    <span className="font-semibold">@{highlight.author}</span>{" "}
                    <span className="italic text-slate-500">
                      "{highlight.quote.slice(0, 60)}
                      {highlight.quote.length > 60 ? "…" : ""}"
                    </span>
                    {highlight.comment && (
                      <span className="block text-slate-600">{highlight.comment}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

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
