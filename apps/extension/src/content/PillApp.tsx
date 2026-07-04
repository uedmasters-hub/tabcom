import {
  ChevronLeft,
  MessageSquare,
  Pin,
  Send,
  Settings as SettingsIcon,
  SquareStack,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { browser } from "wxt/browser";

import {
  AnnotationGroup,
  BoardCard,
  HighlightRow,
  PinRow,
} from "../components/shared/BoardElements";
import { MessageBubble } from "../components/shared/MessageBubble";
import { SettingsToggleRow } from "../components/shared/SettingsToggleRow";
import {
  getCursorsEnabled,
  getProfileToggles,
  setCursorsEnabled,
  setPillEnabled,
  setProfileToggle,
} from "../lib/pill-settings";
import type { BoardItem, Community, Message } from "../types/chat";

import {
  appendMessageLocally,
  boardWrite,
  markConversationRead,
  onInvalidated,
  useChatState,
  useInboxBuffer,
  useUsername,
} from "./pill-data";

export const PILL_VERSION = "M28";

export interface PillActions {
  enterPinMode: (communityId: string) => void;
  enterHighlightMode: (communityId: string) => void;
  addCurrentPage: (communityId: string) => Promise<boolean>;
  openPanel: () => void;
  navigateToAnnotation: (
    item: { url: string; canonicalKey: string },
    target: { kind: "pin" | "highlight"; id: string }
  ) => void;
}

type View =
  | { kind: "collapsed" }
  | { kind: "chats" }
  | {
      kind: "thread";
      chatKind: "dm" | "community";
      id: string;
      conversationId: string | null;
      label: string;
      color: string;
    }
  | { kind: "board" }
  | { kind: "pins" }
  | { kind: "highlights" }
  | { kind: "settings" };

function initials(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function Avatar({ name, color, size = 32 }: { name: string; color: string; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ background: color, width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials(name)}
    </span>
  );
}

export default function PillApp({ actions }: { actions: PillActions }) {
  const [view, setView] = useState<View>({ kind: "collapsed" });
  const [invalidated, setInvalidated] = useState(false);
  const [selectedCommunityId, setSelectedCommunityId] = useState<string | null>(null);
  const [typingFrom, setTypingFrom] = useState<{ username: string; name: string; color: string } | null>(
    null
  );
  const [threadTypingPeer, setThreadTypingPeer] = useState(false);

  const username = useUsername();
  const chat = useChatState();
  const buffer = useInboxBuffer();

  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    onInvalidated(() => setInvalidated(true));
  }, []);

  // ---- Live push events from the background relay --------------------------
  useEffect(() => {
    const listener = (message: any) => {
      if (invalidated) return undefined;

      if (message?.type === "tabcom:dm-live" || message?.type === "tabcom:community-message-live") {
        const from = message.from as { username: string; name: string; color: string };
        const kind: "dm" | "community" = message.type === "tabcom:dm-live" ? "dm" : "community";
        const peerId = kind === "dm" ? from.username : message.communityId;
        const current = viewRef.current;

        setTypingFrom(null);

        if (current.kind === "thread" && current.chatKind === kind && current.id === peerId) {
          setThreadTypingPeer(false);
          const full: Message = {
            ...message.message,
            authorId: `u-${from.username}`,
            authorName: from.name,
            authorColor: from.color,
          };
          if (current.conversationId) {
            void appendMessageLocally(current.conversationId, full);
            void markConversationRead(current.conversationId, peerId);
          }
        }
        return undefined;
      }

      if (message?.type === "tabcom:typing-live") {
        const from = message.from as { username: string; name: string; color: string };
        const current = viewRef.current;

        if (current.kind === "thread" && current.chatKind === "dm" && current.id === from.username) {
          setThreadTypingPeer(true);
          setTimeout(() => setThreadTypingPeer(false), 3000);
          return undefined;
        }

        if (current.kind === "collapsed") {
          setTypingFrom(from);
          setTimeout(() => setTypingFrom(null), 3500);
        }
      }
      return undefined;
    };

    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, [invalidated]);

  // ---- Derived data ----------------------------------------------------------

  const memberCommunities = useMemo(
    () => Object.values(chat.communities).filter((c) => c.members?.some((m) => m.username === username)),
    [chat.communities, username]
  );

  useEffect(() => {
    if (memberCommunities.length === 0) return;
    if (!selectedCommunityId || !memberCommunities.some((c) => c.id === selectedCommunityId)) {
      setSelectedCommunityId(memberCommunities[0].id);
    }
  }, [memberCommunities, selectedCommunityId]);

  const bufferedCount = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const entry of buffer) {
      const key = entry.kind === "community" ? `c:${entry.communityId}` : `d:${entry.from?.username}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [buffer]);

  const chatEntries = useMemo(() => {
    if (!username) return [];
    const entries: Array<{
      kind: "dm" | "community";
      id: string;
      conversationId: string | null;
      label: string;
      color: string;
      unread: number;
    }> = [];

    for (const community of memberCommunities) {
      const conversation = chat.conversations.find((c) => c.communityId === community.id);
      entries.push({
        kind: "community",
        id: community.id,
        conversationId: conversation?.id ?? null,
        label: community.name,
        color: "#0B0F19",
        unread: (conversation?.unread ?? 0) + (bufferedCount[`c:${community.id}`] ?? 0),
      });
    }

    for (const conversation of chat.conversations) {
      if (!conversation.contactId) continue;
      const contact = chat.contacts.find((c) => c.id === conversation.contactId);
      if (!contact) continue;
      entries.push({
        kind: "dm",
        id: contact.username,
        conversationId: conversation.id,
        label: contact.alias || contact.name,
        color: contact.color,
        unread: (conversation.unread ?? 0) + (bufferedCount[`d:${contact.username}`] ?? 0),
      });
    }

    return entries.sort((a, b) => b.unread - a.unread || a.label.localeCompare(b.label));
  }, [memberCommunities, chat.conversations, chat.contacts, bufferedCount, username]);

  const totalUnread = chatEntries.reduce((n, e) => n + e.unread, 0);

  if (invalidated) {
    return (
      <button
        className="fixed bottom-[22px] right-[22px] z-[2147483600] flex items-center gap-1.5 rounded-full bg-amber-600 px-4 py-2.5 text-xs font-bold text-white shadow-xl"
        onClick={() => window.location.reload()}
      >
        ↻ Tabcom was updated — click to refresh
      </button>
    );
  }

  if (!username) return null; // not onboarded — stay invisible

  if (typingFrom && view.kind === "collapsed") {
    return (
      <TypingAmbientPill
        from={typingFrom}
        onClick={() => {
          const conversation = chat.conversations.find((c) => {
            const contact = chat.contacts.find((item) => item.id === c.contactId);
            return contact?.username === typingFrom.username;
          });
          setTypingFrom(null);
          void markConversationRead(conversation?.id ?? null, typingFrom.username);
          setView({
            kind: "thread",
            chatKind: "dm",
            id: typingFrom.username,
            conversationId: conversation?.id ?? null,
            label: typingFrom.name,
            color: typingFrom.color,
          });
        }}
      />
    );
  }

  return (
    <>
      <CollapsedBar view={view} setView={setView} totalUnread={totalUnread} />
      {view.kind === "chats" && <ChatsPanel entries={chatEntries} setView={setView} />}
      {view.kind === "thread" && (
        <ThreadPanel
          view={view}
          setView={setView}
          messages={view.conversationId ? chat.messages[view.conversationId] ?? [] : []}
          threadTypingPeer={threadTypingPeer}
        />
      )}
      {view.kind === "board" && (
        <BoardPanel
          community={memberCommunities.find((c) => c.id === selectedCommunityId) ?? null}
          username={username}
          setView={setView}
          actions={actions}
        />
      )}
      {(view.kind === "pins" || view.kind === "highlights") && (
        <AnnotationPanel
          mode={view.kind}
          community={memberCommunities.find((c) => c.id === selectedCommunityId) ?? null}
          setView={setView}
          actions={actions}
        />
      )}
      {view.kind === "settings" && <SettingsPanel setView={setView} actions={actions} />}
    </>
  );
}

// ---- Collapsed bar ----------------------------------------------------------

function CollapsedBar({
  view,
  setView,
  totalUnread,
}: {
  view: View;
  setView: (v: View) => void;
  totalUnread: number;
}) {
  const isActive = (kind: View["kind"]) => view.kind === kind || (kind === "chats" && view.kind === "thread");

  const iconBtn = (kind: View["kind"], label: string, icon: React.ReactNode) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => setView(isActive(kind) ? { kind: "collapsed" } : ({ kind } as View))}
      className={`relative flex h-9 w-9 items-center justify-center rounded-full transition ${
        isActive(kind) ? "bg-white text-slate-900" : "text-slate-300 hover:bg-white/10 hover:text-white"
      }`}
    >
      {icon}
      {kind === "chats" && totalUnread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full border-2 border-slate-900 bg-red-600 px-1 text-[9.5px] font-bold text-white">
          {totalUnread > 99 ? "99+" : totalUnread}
        </span>
      )}
    </button>
  );

  return (
    <div className="fixed bottom-[22px] right-[22px] z-[2147483600] flex items-center gap-[3px] rounded-full bg-slate-900 px-2.5 py-2 shadow-2xl">
      <span className="mx-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
      {iconBtn("chats", "Chats", <MessageSquare size={17} strokeWidth={1.7} />)}
      <span className="mx-1.5 h-5 w-px bg-white/15" />
      {iconBtn("board", "Board", <SquareStack size={17} strokeWidth={1.7} />)}
      {iconBtn("pins", "Pins", <Pin size={17} strokeWidth={1.7} />)}
      {iconBtn("highlights", "Highlights", <PencilIcon />)}
      {iconBtn("settings", "Settings", <SettingsIcon size={17} strokeWidth={1.7} />)}
    </div>
  );
}

function PencilIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
      <path d="M4 21h9" />
    </svg>
  );
}

function TypingAmbientPill({
  from,
  onClick,
}: {
  from: { username: string; name: string; color: string };
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-[22px] right-[22px] z-[2147483600] flex items-center gap-2.5 rounded-full bg-slate-900 py-2 pl-2 pr-4 shadow-2xl"
    >
      <Avatar name={from.name} color={from.color} size={26} />
      <span className="text-[13px] font-semibold text-white">{from.name.split(" ")[0]} is typing…</span>
    </button>
  );
}

// ---- Panel shell -------------------------------------------------------------

function PanelShell({
  title,
  subtitle,
  avatar,
  onBack,
  children,
}: {
  title: string;
  subtitle?: string;
  avatar?: { name: string; color: string };
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed bottom-[70px] right-[22px] z-[2147483600] flex max-h-[500px] w-[336px] flex-col overflow-hidden rounded-[20px] bg-white text-slate-900 shadow-2xl">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-slate-100 px-[18px] py-4">
        <button
          onClick={onBack}
          className="-ml-1 flex items-center rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
        >
          <ChevronLeft size={18} />
        </button>
        {avatar && <Avatar name={avatar.name} color={avatar.color} size={30} />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14.5px] font-bold leading-tight tracking-tight">{title}</p>
          {subtitle && <p className="mt-0.5 text-[11px] font-medium text-slate-400">{subtitle}</p>}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-1.5">{children}</div>
    </div>
  );
}

function EmptyPanelState({ text }: { text: string }) {
  return <div className="px-[26px] py-10 text-center text-[13px] leading-relaxed text-slate-400">{text}</div>;
}

// ---- Chats list ---------------------------------------------------------------

interface ChatEntry {
  kind: "dm" | "community";
  id: string;
  conversationId: string | null;
  label: string;
  color: string;
  unread: number;
}

function ChatsPanel({ entries, setView }: { entries: ChatEntry[]; setView: (v: View) => void }) {
  const dms = entries.filter((e) => e.kind === "dm");
  const communities = entries.filter((e) => e.kind === "community");

  const openThread = (entry: ChatEntry) => {
    void markConversationRead(entry.conversationId, entry.id);
    setView({
      kind: "thread",
      chatKind: entry.kind,
      id: entry.id,
      conversationId: entry.conversationId,
      label: entry.label,
      color: entry.color,
    });
  };

  return (
    <PanelShell title="Chats" onBack={() => setView({ kind: "collapsed" })}>
      {entries.length === 0 ? (
        <EmptyPanelState text="No conversations yet. Connect with people or join a community from the Tabcom panel." />
      ) : (
        <>
          {dms.length > 0 && <GroupLabel text={`Chats — ${dms.length}`} />}
          {dms.map((entry) => (
            <ChatRow key={entry.id} entry={entry} onClick={() => openThread(entry)} />
          ))}
          {communities.length > 0 && <GroupLabel text={`Community — ${communities.length}`} />}
          {communities.map((entry) => (
            <ChatRow key={entry.id} entry={entry} onClick={() => openThread(entry)} />
          ))}
        </>
      )}
    </PanelShell>
  );
}

function GroupLabel({ text }: { text: string }) {
  return (
    <div className="px-[18px] pb-2 pt-[18px] text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400">
      {text}
    </div>
  );
}

function ChatRow({ entry, onClick }: { entry: ChatEntry; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 px-[18px] py-2.5 text-left transition hover:bg-slate-50">
      <Avatar name={entry.label} color={entry.color} size={36} />
      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{entry.label}</span>
      {entry.unread > 0 && (
        <span className="flex h-[19px] min-w-[19px] shrink-0 items-center justify-center rounded-full bg-red-600 px-1.5 text-[10.5px] font-bold text-white">
          {entry.unread > 99 ? "99+" : entry.unread}
        </span>
      )}
    </button>
  );
}

// ---- Thread ---------------------------------------------------------------------

function ThreadPanel({
  view,
  setView,
  messages,
  threadTypingPeer,
}: {
  view: Extract<View, { kind: "thread" }>;
  setView: (v: View) => void;
  messages: Message[];
  threadTypingPeer: boolean;
}) {
  const [draft, setDraft] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const lastTypingSentAt = useRef(0);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages.length, threadTypingPeer]);

  const submit = async () => {
    const text = draft.trim();
    if (!text || !view.conversationId) return;
    setDraft("");

    const optimistic: Message = {
      id: crypto.randomUUID(),
      authorId: "me",
      kind: "text",
      text,
      sentAt: Date.now(),
    };
    await appendMessageLocally(view.conversationId, optimistic);

    if (view.chatKind === "dm") {
      await boardWrite("dm_send", { username: view.id, text });
    } else {
      await boardWrite("community_message", { communityId: view.id, text });
    }
  };

  const onInputChange = (value: string) => {
    setDraft(value);
    if (view.chatKind !== "dm") return;
    const now = Date.now();
    if (now - lastTypingSentAt.current > 1500) {
      lastTypingSentAt.current = now;
      void boardWrite("typing_send", { username: view.id });
    }
  };

  return (
    <PanelShell
      title={view.label}
      subtitle={view.chatKind === "community" ? "Community" : threadTypingPeer ? "typing…" : undefined}
      avatar={{ name: view.label, color: view.color }}
      onBack={() => setView({ kind: "chats" })}
    >
      <div ref={bodyRef} className="flex flex-col gap-2.5 px-[18px] pb-2 pt-4">
        {messages.length === 0 ? (
          <EmptyPanelState text="No messages yet — say hello." />
        ) : (
          messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              showAuthor={view.chatKind === "community"}
              animate
              onOpenLink={(url) => browser.tabs.create({ url })}
            />
          ))
        )}
        {threadTypingPeer && (
          <p className="pb-1 pl-1 text-[11.5px] italic text-slate-400">{view.label.split(" ")[0]} is typing…</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-slate-100 px-4 py-3">
        <input
          value={draft}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Message…"
          className="h-9 min-w-0 flex-1 rounded-full border border-slate-200 px-3.5 text-[13px] outline-none focus:border-slate-900"
        />
        <button
          onClick={submit}
          disabled={!draft.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white transition disabled:bg-slate-200"
        >
          <Send size={14} />
        </button>
      </div>
    </PanelShell>
  );
}

// ---- Board / Pins / Highlights (SHARED components, same as the popup) -----

function CommunitySwitchNote({ community }: { community: Community | null }) {
  if (!community) {
    return <EmptyPanelState text="You're not in a community yet — create one from the Tabcom panel." />;
  }
  return null;
}

function BoardPanel({
  community,
  username,
  setView,
  actions,
}: {
  community: Community | null;
  username: string;
  setView: (v: View) => void;
  actions: PillActions;
}) {
  const isAdmin = community ? community.admin === username : false;

  return (
    <PanelShell title={community?.name ?? "Board"} onBack={() => setView({ kind: "collapsed" })}>
      <div className="border-b border-slate-100 px-[18px] py-3.5">
        <button
          disabled={!community}
          onClick={() => community && void actions.addCurrentPage(community.id)}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2.5 text-[13px] font-semibold transition hover:border-slate-900 disabled:opacity-40"
        >
          <SquareStack size={14} /> Add this page
        </button>
      </div>

      <CommunitySwitchNote community={community} />

      {community &&
        (community.board.length === 0 ? (
          <EmptyPanelState text="No pages on this board yet." />
        ) : (
          <ul className="flex flex-col gap-3 px-[18px] py-4">
            {community.board.map((item) => (
              <BoardCard
                key={item.id}
                item={item}
                canRemove={isAdmin || item.addedBy === username}
                canDecide={isAdmin}
                hasVoted={item.votes.includes(username)}
                onOpen={(url) => browser.tabs.create({ url })}
                onVote={() => void boardWrite("board_vote", { communityId: community.id, itemId: item.id })}
                onComment={(text) =>
                  void boardWrite("board_comment", { communityId: community.id, itemId: item.id, text })
                }
                onDecide={() => void boardWrite("board_decide", { communityId: community.id, itemId: item.id })}
                onRemove={() =>
                  void boardWrite("board_remove_item", { communityId: community.id, itemId: item.id })
                }
              />
            ))}
          </ul>
        ))}
    </PanelShell>
  );
}

function AnnotationPanel({
  mode,
  community,
  setView,
  actions,
}: {
  mode: "pins" | "highlights";
  community: Community | null;
  setView: (v: View) => void;
  actions: PillActions;
}) {
  const items = (community?.board ?? []).filter((item: BoardItem) =>
    mode === "pins" ? item.pins.length > 0 : item.highlights.length > 0
  );

  return (
    <PanelShell
      title={mode === "pins" ? "Pins" : "Highlights"}
      subtitle={community?.name}
      onBack={() => setView({ kind: "collapsed" })}
    >
      <div className="border-b border-slate-100 px-[18px] py-3.5">
        <button
          disabled={!community}
          onClick={() => {
            if (!community) return;
            if (mode === "pins") actions.enterPinMode(community.id);
            else actions.enterHighlightMode(community.id);
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2.5 text-[13px] font-semibold transition hover:border-slate-900 disabled:opacity-40"
        >
          {mode === "pins" ? <Pin size={14} /> : <PencilIcon />}
          {mode === "pins" ? "Pin a spot on this page" : "Highlight text on this page"}
        </button>
      </div>

      <CommunitySwitchNote community={community} />

      {community && items.length === 0 && (
        <EmptyPanelState
          text={
            mode === "pins"
              ? "No pins yet. Drop one on any page on the board."
              : "No highlights yet. Select text on any page on the board."
          }
        />
      )}

      {community && items.length > 0 && (
        <div className="flex flex-col gap-4 px-[18px] py-4">
          {items.map((item) => (
            <AnnotationGroup key={item.id} item={item}>
              {mode === "pins"
                ? item.pins.map((pin) => (
                    <PinRow key={pin.id} pin={pin} onJump={() => actions.navigateToAnnotation(item, { kind: "pin", id: pin.id })} />
                  ))
                : item.highlights.map((highlight) => (
                    <HighlightRow
                      key={highlight.id}
                      highlight={highlight}
                      onJump={() => actions.navigateToAnnotation(item, { kind: "highlight", id: highlight.id })}
                    />
                  ))}
            </AnnotationGroup>
          ))}
        </div>
      )}
    </PanelShell>
  );
}

// ---- Settings -----------------------------------------------------------------

function SettingsPanel({ setView, actions }: { setView: (v: View) => void; actions: PillActions }) {
  const [cursorsOn, setCursorsOn] = useState(true);
  const [animations, setAnimations] = useState(true);
  const [isPublic, setIsPublic] = useState(true);

  useEffect(() => {
    void getCursorsEnabled().then(setCursorsOn);
    void getProfileToggles().then((t) => {
      if (t) {
        setAnimations(t.animations);
        setIsPublic(t.visibility !== "private");
      }
    });
  }, []);

  return (
    <PanelShell title="Settings" onBack={() => setView({ kind: "collapsed" })}>
      <div className="flex flex-col gap-3 px-[18px] py-4">
        <SettingsToggleRow
          icon={<span className="text-base">🖱️</span>}
          label="Live cursors"
          description="See where community members are looking, live."
          checked={cursorsOn}
          onToggle={() => {
            const next = !cursorsOn;
            setCursorsOn(next);
            void setCursorsEnabled(next);
          }}
        />
        <SettingsToggleRow
          icon={<span className="text-base">✨</span>}
          label="Message animations"
          description="Apple-style spring pop when messages arrive."
          checked={animations}
          onToggle={() => {
            const next = !animations;
            setAnimations(next);
            void setProfileToggle("animations", next);
          }}
        />
        <SettingsToggleRow
          icon={<span className="text-base">🌐</span>}
          label="Public profile"
          description="Anyone can find and connect with you."
          checked={isPublic}
          onToggle={() => {
            const next = !isPublic;
            setIsPublic(next);
            void setProfileToggle("visibility", next ? "public" : "private");
          }}
        />
      </div>

      <button
        onClick={() => {
          setView({ kind: "collapsed" });
          actions.openPanel();
        }}
        className="flex w-full items-center border-t border-slate-100 px-[18px] py-3.5 text-left text-[13px] font-semibold transition hover:bg-slate-50"
      >
        <span className="flex-1">Open Tabcom panel</span>
      </button>

      <button
        onClick={() => void setPillEnabled(false)}
        className="flex w-full items-center border-t border-slate-100 px-[18px] py-3.5 text-left text-[13px] font-semibold text-red-600 transition hover:bg-red-50"
      >
        <span className="flex-1">Hide pill (re-enable in Settings)</span>
      </button>
    </PanelShell>
  );
}
