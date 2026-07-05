import {
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  MapPin,
  MessageSquareText,
  Plus,
  Send,
  Square,
  ThumbsUp,
  Trash2,
  Trophy,
} from "lucide-react";
import { useState } from "react";
import { browser } from "wxt/browser";

import { Button, EmptyState } from "../../../../components/ui";
import { navigateToAnnotation } from "../../../../lib/board-navigation";
import { cn } from "../../../../lib/cn";
import { useChatStore } from "../../../../stores/chat.store";
import { useProfileStore } from "../../../../stores/profile.store";
import type {
  BoardArea,
  BoardItem,
  BoardPin,
  Community,
} from "../../../../types/chat";
import { formatRelativeTime } from "../../../../utils/time";

/**
 * Community board, organized as a segmented control:
 *   Tabs       — every page on the board, with voting/comments/decide
 *   Pins       — every pin across all pages; click = jump to the exact
 *                spot on the page (focus-or-open + scroll + pulse)
 *   Highlights — every highlight across all pages; click = jump + flash
 */

type Section = "tabs" | "pins" | "areas";

async function sendToActiveTab(message: Record<string, unknown>) {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await browser.tabs.sendMessage(tab.id, message);
  } catch {
    // content script not present on this page (e.g. chrome://)
  }
}

export default function BoardView({ community }: { community: Community }) {
  const [section, setSection] = useState<Section>("tabs");

  const pinCount = community.board.reduce((n, item) => n + (item.pins ?? []).length, 0);
  const areaCount = community.board.reduce((n, item) => n + (item.areas ?? []).length, 0);

  const segments: Array<{ id: Section; label: string; count: number }> = [
    { id: "tabs", label: "Tabs", count: community.board.length },
    { id: "pins", label: "Pins", count: pinCount },
    { id: "areas", label: "Areas", count: areaCount },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex gap-1 border-b border-slate-100 px-4 py-2.5">
        {segments.map((segment) => (
          <button
            key={segment.id}
            type="button"
            onClick={() => setSection(segment.id)}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-xs font-semibold transition",
              section === segment.id
                ? "bg-slate-900 text-white"
                : "text-slate-500 hover:bg-slate-100"
            )}
          >
            {segment.label}
            {segment.count > 0 && <span className="ml-1.5">· {segment.count}</span>}
          </button>
        ))}
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto">
        {section === "tabs" && <TabsSection community={community} />}
        {section === "pins" && <PinsSection community={community} />}
        {section === "areas" && <AreasSection community={community} />}
      </div>
    </div>
  );
}

// ---- Tabs ----------------------------------------------------------------

function TabsSection({ community }: { community: Community }) {
  const username = useProfileStore((state) => state.username);
  const addCurrentTabToBoard = useChatStore(
    (state) => state.addCurrentTabToBoard
  );
  const decideBoardItem = useChatStore((state) => state.decideBoardItem);

  const isAdmin = community.admin === username;
  const decided = community.board.find((item) => item.decided);

  return (
    <>
      <div className="border-b border-slate-100 px-4 py-3">
        <Button
          size="md"
          variant="outline"
          fullWidth
          leftIcon={<Plus size={15} />}
          onClick={() => void addCurrentTabToBoard(community.id)}
        >
          Add current tab
        </Button>
      </div>

      {decided && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
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

      {community.board.length === 0 ? (
        <EmptyState
          className="flex-1"
          icon={<ThumbsUp size={24} />}
          title="No pages yet"
          description="Browse to a listing and tap 'Add current tab' — or use the Tabcom pill right on the page."
        />
      ) : (
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
      )}
    </>
  );
}

// ---- Pins ------------------------------------------------------------------

function PinsSection({ community }: { community: Community }) {
  const itemsWithPins = community.board.filter((item) => (item.pins ?? []).length > 0);

  return (
    <>
      <div className="border-b border-slate-100 px-4 py-3">
        <Button
          size="md"
          variant="outline"
          fullWidth
          leftIcon={<MapPin size={15} />}
          onClick={() =>
            void sendToActiveTab({
              type: "tabcom:enter-annotate-mode",
              communityId: community.id,
            })
          }
        >
          Annotate this page — click to pin, drag to select an area
        </Button>
      </div>

      {itemsWithPins.length === 0 ? (
        <EmptyState
          className="flex-1"
          icon={<MapPin size={24} />}
          title="No pins yet"
          description="Open any page on the board and drop a pin — everyone in the community can jump straight to it from here."
        />
      ) : (
        <div className="flex flex-col gap-4 px-4 py-4">
          {itemsWithPins.map((item) => (
            <AnnotationGroup key={item.id} item={item}>
              {(item.pins ?? []).map((pin) => (
                <PinRow key={pin.id} item={item} pin={pin} communityId={community.id} />
              ))}
            </AnnotationGroup>
          ))}
        </div>
      )}
    </>
  );
}

function PinRow({
  item,
  pin,
  communityId,
}: {
  item: BoardItem;
  pin: BoardPin;
  communityId: string;
}) {
  const commentOnPin = useChatStore((state) => state.commentOnPin);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");

  const submit = () => {
    if (!draft.trim()) return;
    commentOnPin(communityId, item.id, pin.id, draft);
    setDraft("");
  };

  return (
    <div className="overflow-hidden rounded-xl border border-transparent transition hover:border-slate-100">
      <div className="flex w-full items-start gap-2.5 px-2.5 py-2">
        <button
          type="button"
          onClick={() => void navigateToAnnotation(item, { kind: "pin", id: pin.id })}
          className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
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
        </button>

        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-slate-500 transition hover:bg-slate-50"
        >
          <MessageSquareText size={11} />
          {(pin.comments ?? []).length}
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-3 py-2.5">
          {(pin.comments ?? []).length > 0 && (
            <ul className="mb-2 space-y-1.5">
              {(pin.comments ?? []).map((comment) => (
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
                if (event.key === "Enter") submit();
              }}
              placeholder="Reply to this pin…"
              className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-blue-500"
            />
            <button
              type="button"
              onClick={submit}
              disabled={!draft.trim()}
              aria-label="Send comment"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white disabled:bg-slate-300"
            >
              <Send size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Areas -------------------------------------------------------------

function AreasSection({ community }: { community: Community }) {
  const itemsWithAreas = community.board.filter((item) => (item.areas ?? []).length > 0);

  return (
    <>
      <div className="border-b border-slate-100 px-4 py-3">
        <Button
          size="md"
          variant="outline"
          fullWidth
          leftIcon={<Square size={15} />}
          onClick={() =>
            void sendToActiveTab({
              type: "tabcom:enter-annotate-mode",
              communityId: community.id,
            })
          }
        >
          Annotate this page — click to pin, drag to select an area
        </Button>
      </div>

      {itemsWithAreas.length === 0 ? (
        <EmptyState
          className="flex-1"
          icon={<Square size={24} />}
          title="No areas yet"
          description="Click and drag over any part of a page on the board — works over images and mixed content, not just text."
        />
      ) : (
        <div className="flex flex-col gap-4 px-4 py-4">
          {itemsWithAreas.map((item) => (
            <AnnotationGroup key={item.id} item={item}>
              {(item.areas ?? []).map((area) => (
                <AreaRow key={area.id} item={item} area={area} communityId={community.id} />
              ))}
            </AnnotationGroup>
          ))}
        </div>
      )}
    </>
  );
}

function AreaRow({
  item,
  area,
  communityId,
}: {
  item: BoardItem;
  area: BoardArea;
  communityId: string;
}) {
  const commentOnArea = useChatStore((state) => state.commentOnArea);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");

  const submit = () => {
    if (!draft.trim()) return;
    commentOnArea(communityId, item.id, area.id, draft);
    setDraft("");
  };

  return (
    <div className="overflow-hidden rounded-xl border border-transparent transition hover:border-slate-100">
      <div className="flex w-full items-start gap-2.5 px-2.5 py-2">
        <button
          type="button"
          onClick={() => void navigateToAnnotation(item, { kind: "area", id: area.id })}
          className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
          title="Jump to this area on the page"
        >
          <Square size={14} className="mt-0.5 shrink-0 text-violet-500" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium leading-snug">
              {area.text}
            </span>
            <span className="mt-0.5 block text-[11px] text-slate-400">
              @{area.author} · {formatRelativeTime(area.sentAt)}
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-slate-500 transition hover:bg-slate-50"
        >
          <MessageSquareText size={11} />
          {(area.comments ?? []).length}
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-3 py-2.5">
          {(area.comments ?? []).length > 0 && (
            <ul className="mb-2 space-y-1.5">
              {(area.comments ?? []).map((comment) => (
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
                if (event.key === "Enter") submit();
              }}
              placeholder="Reply to this area…"
              className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-blue-500"
            />
            <button
              type="button"
              onClick={submit}
              disabled={!draft.trim()}
              aria-label="Send comment"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white disabled:bg-slate-300"
            >
              <Send size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- shared pieces -----------------------------------------------------------

function AnnotationGroup({
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
        item.decided ? "border-emerald-300 bg-emerald-50/40" : "border-slate-200"
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
