import { MapPin, Pencil, Plus, ThumbsUp, Trophy } from "lucide-react";
import { useState } from "react";
import { browser } from "wxt/browser";

import {
  AnnotationGroup,
  BoardCard,
  HighlightRow,
  PinRow,
} from "../../../../components/shared/BoardElements";
import { Button, EmptyState } from "../../../../components/ui";
import { navigateToAnnotation } from "../../../../lib/board-navigation";
import { cn } from "../../../../lib/cn";
import { useChatStore } from "../../../../stores/chat.store";
import { useProfileStore } from "../../../../stores/profile.store";
import type { Community } from "../../../../types/chat";

/**
 * Community board, organized as a segmented control:
 *   Tabs       — every page on the board, with voting/comments/decide
 *   Pins       — every pin across all pages; click = jump to the exact
 *                spot on the page (focus-or-open + scroll + pulse)
 *   Highlights — every highlight across all pages; click = jump + flash
 *
 * All rendering below is the SHARED implementation in
 * components/shared/BoardElements — the page pill renders the exact
 * same components against the exact same data, wired to the
 * background relay instead of this store.
 */

type Section = "tabs" | "pins" | "highlights";

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

  const pinCount = community.board.reduce((n, item) => n + item.pins.length, 0);
  const highlightCount = community.board.reduce(
    (n, item) => n + item.highlights.length,
    0
  );

  const segments: Array<{ id: Section; label: string; count: number }> = [
    { id: "tabs", label: "Tabs", count: community.board.length },
    { id: "pins", label: "Pins", count: pinCount },
    { id: "highlights", label: "Highlights", count: highlightCount },
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
        {section === "highlights" && <HighlightsSection community={community} />}
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
  const removeBoardItem = useChatStore((state) => state.removeBoardItem);
  const commentOnBoardItem = useChatStore((state) => state.commentOnBoardItem);
  const voteOnBoardItem = useChatStore((state) => state.voteOnBoardItem);

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
              canRemove={isAdmin || item.addedBy === username}
              canDecide={isAdmin}
              hasVoted={item.votes.includes(username)}
              onOpen={(url) => browser.tabs.create({ url })}
              onVote={() => voteOnBoardItem(community.id, item.id)}
              onComment={(text) => commentOnBoardItem(community.id, item.id, text)}
              onDecide={() => decideBoardItem(community.id, item.id)}
              onRemove={() => removeBoardItem(community.id, item.id)}
            />
          ))}
        </ul>
      )}
    </>
  );
}

// ---- Pins ------------------------------------------------------------------

function PinsSection({ community }: { community: Community }) {
  const itemsWithPins = community.board.filter((item) => item.pins.length > 0);

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
              type: "tabcom:enter-pin-mode",
              communityId: community.id,
            })
          }
        >
          Pin a spot on this page
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
              {item.pins.map((pin) => (
                <PinRow
                  key={pin.id}
                  pin={pin}
                  onJump={() => void navigateToAnnotation(item, { kind: "pin", id: pin.id })}
                />
              ))}
            </AnnotationGroup>
          ))}
        </div>
      )}
    </>
  );
}

// ---- Highlights -------------------------------------------------------------

function HighlightsSection({ community }: { community: Community }) {
  const itemsWithHighlights = community.board.filter(
    (item) => item.highlights.length > 0
  );

  return (
    <>
      <div className="border-b border-slate-100 px-4 py-3">
        <Button
          size="md"
          variant="outline"
          fullWidth
          leftIcon={<Pencil size={15} />}
          onClick={() =>
            void sendToActiveTab({
              type: "tabcom:enter-highlight-mode",
              communityId: community.id,
            })
          }
        >
          Highlight text on this page
        </Button>
      </div>

      {itemsWithHighlights.length === 0 ? (
        <EmptyState
          className="flex-1"
          icon={<Pencil size={24} />}
          title="No highlights yet"
          description="Select text on any page on the board and highlight it — everyone can jump straight to the exact sentence from here."
        />
      ) : (
        <div className="flex flex-col gap-4 px-4 py-4">
          {itemsWithHighlights.map((item) => (
            <AnnotationGroup key={item.id} item={item}>
              {item.highlights.map((highlight) => (
                <HighlightRow
                  key={highlight.id}
                  highlight={highlight}
                  onJump={() =>
                    void navigateToAnnotation(item, { kind: "highlight", id: highlight.id })
                  }
                />
              ))}
            </AnnotationGroup>
          ))}
        </div>
      )}
    </>
  );
}
