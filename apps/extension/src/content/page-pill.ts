import { browser } from "wxt/browser";

import {
  getCursorsEnabled,
  getPillEnabled,
  getProfileToggles,
  onPillEnabledChange,
  setCursorsEnabled,
  setPillEnabled,
  setProfileToggle,
} from "../lib/pill-settings";

/**
 * Tabcom page pill — v2 (M26): a self-contained mini-app.
 *
 * Everything a person does day-to-day — chat, browse the board, review
 * pins/highlights, adjust quick settings — happens inline in this
 * overlay. The main extension window is still where you connect with
 * new people, create communities, and edit your profile photo; the
 * pill is where you LIVE once that's set up.
 *
 * Visual language: flat, geometric, monochrome-first with a single red
 * accent reserved for counts/urgency. No gradients, no drop-decoration
 * on icons — Swiss/Bauhaus discipline: grid, restraint, legibility.
 */

export const PILL_VERSION = "M26";

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

// ---- Data shapes read from storage ---------------------------------------

interface ChatEntry {
  kind: "community" | "dm";
  id: string; // community id, or contact USERNAME for dms
  conversationId: string | null;
  label: string;
  color: string;
  unread: number;
}

interface BoardComment {
  id: string;
  author: string;
  text: string;
  sentAt: number;
}

interface BoardPin {
  id: string;
  author: string;
  text: string;
  sentAt: number;
}

interface BoardHighlight {
  id: string;
  author: string;
  quote: string;
  comment?: string;
  sentAt: number;
}

interface BoardItem {
  id: string;
  url: string;
  canonicalKey: string;
  title: string;
  image?: string;
  siteName?: string;
  addedBy: string;
  addedAt: number;
  comments: BoardComment[];
  pins: BoardPin[];
  highlights: BoardHighlight[];
  votes: string[];
  decided: boolean;
}

interface CommunityRecord {
  id: string;
  name: string;
  admin: string;
  members: Array<{ username: string }>;
  board: BoardItem[];
}

interface ThreadMessage {
  id: string;
  authorId: string;
  authorName?: string;
  authorColor?: string;
  kind: string;
  text: string;
  sentAt: number;
}

// ---- Storage access (every read/write wrapped — an orphaned tab must
// never throw past this boundary) ------------------------------------------

async function readUsername(): Promise<string | null> {
  try {
    const result = await browser.storage.local.get("tabcom:profile");
    const raw = result["tabcom:profile"] as string | undefined;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return (parsed.state ?? parsed)?.username ?? null;
  } catch {
    return null;
  }
}

async function readChatState(): Promise<{
  conversations: Array<{
    id: string;
    contactId?: string;
    communityId?: string;
    unread?: number;
  }>;
  contacts: Array<{ id: string; username: string; name: string; alias?: string; color: string }>;
  communities: Record<string, CommunityRecord>;
  messages: Record<string, ThreadMessage[]>;
}> {
  const empty = { conversations: [], contacts: [], communities: {}, messages: {} };
  try {
    const result = await browser.storage.local.get("tabcom:chat");
    const raw = result["tabcom:chat"] as string | undefined;
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    const state = parsed.state ?? parsed;
    return {
      conversations: state.conversations ?? [],
      contacts: state.contacts ?? [],
      communities: state.communities ?? {},
      messages: state.messages ?? {},
    };
  } catch {
    return empty;
  }
}

async function readBufferedCounts(): Promise<Record<string, number>> {
  try {
    const result = await browser.storage.local.get("tabcom:inbox-buffer");
    const raw = result["tabcom:inbox-buffer"] as string | undefined;
    if (!raw) return {};
    const counts: Record<string, number> = {};
    for (const entry of JSON.parse(raw)) {
      const key =
        entry.kind === "community" ? `c:${entry.communityId}` : `d:${entry.from?.username}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  } catch {
    return {};
  }
}

async function appendMessageLocally(
  conversationId: string,
  message: ThreadMessage
): Promise<void> {
  try {
    const result = await browser.storage.local.get("tabcom:chat");
    const raw = result["tabcom:chat"] as string | undefined;
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const state = parsed.state ?? parsed;
    const thread: ThreadMessage[] = state.messages?.[conversationId] ?? [];
    if (thread.some((m) => m.id === message.id)) return;
    state.messages = { ...state.messages, [conversationId]: [...thread, message] };
    if (parsed.state) parsed.state = state;
    await browser.storage.local.set({
      "tabcom:chat": JSON.stringify(parsed.state ? parsed : state),
    });
  } catch {
    // best-effort local echo — the live/buffered path is the source of truth
  }
}

// ---- Shadow scaffolding ----------------------------------------------------

const STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }

  /* ---- Collapsed bar ---- */
  .fab { position: fixed; bottom: 20px; right: 20px; z-index: 2147483600;
    display: flex; align-items: center; gap: 2px;
    background: #0B0F19; border-radius: 999px; padding: 6px 8px;
    box-shadow: 0 10px 30px rgba(2,6,23,.35); }
  .fab .status { width: 7px; height: 7px; border-radius: 50%; background: #10B981;
    margin: 0 6px; flex-shrink: 0; }
  .fab .ibtn { position: relative; width: 34px; height: 34px; border-radius: 999px;
    border: none; background: transparent; color: #CBD5E1; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background .12s ease, color .12s ease; }
  .fab .ibtn:hover { background: rgba(255,255,255,.1); color: #fff; }
  .fab .ibtn.active { background: #fff; color: #0B0F19; }
  .fab .ibtn svg { width: 17px; height: 17px; stroke: currentColor; fill: none;
    stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
  .fab .divider { width: 1px; height: 20px; background: rgba(255,255,255,.14); margin: 0 4px; }
  .fab .badge { position: absolute; top: 0; right: 0; min-width: 15px; height: 15px;
    border-radius: 999px; background: #DC2626; color: #fff; font-size: 9px; font-weight: 700;
    display: flex; align-items: center; justify-content: center; padding: 0 3px;
    border: 2px solid #0B0F19; }

  /* ---- Typing ambient pill ---- */
  .typing-pill { position: fixed; bottom: 20px; right: 20px; z-index: 2147483600;
    display: flex; align-items: center; gap: 8px; background: #0B0F19;
    border-radius: 999px; padding: 6px 16px 6px 6px; cursor: pointer;
    box-shadow: 0 10px 30px rgba(2,6,23,.35); }
  .typing-pill .avatar { width: 24px; height: 24px; border-radius: 50%; color: #fff;
    font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
  .typing-pill .label { color: #fff; font-size: 12.5px; font-weight: 600; }

  /* ---- Panel shell ---- */
  .panel { position: fixed; bottom: 66px; right: 20px; z-index: 2147483600;
    width: 300px; max-height: 440px; background: #fff; border-radius: 18px;
    box-shadow: 0 20px 56px rgba(2,6,23,.3); display: flex; flex-direction: column;
    overflow: hidden; color: #0B0F19; }
  .panel-head { display: flex; align-items: center; gap: 8px; padding: 12px 14px;
    border-bottom: 1px solid #F1F5F9; flex-shrink: 0; }
  .panel-head .back { border: none; background: none; cursor: pointer; color: #64748B;
    display: flex; align-items: center; padding: 2px; }
  .panel-head .back svg { width: 17px; height: 17px; stroke: currentColor; fill: none;
    stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .panel-head .avatar { width: 26px; height: 26px; border-radius: 50%; color: #fff;
    font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; }
  .panel-head .title { font-size: 13.5px; font-weight: 700; flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .panel-head .sub { font-size: 10.5px; color: #94A3B8; font-weight: 500; }
  .panel-body { flex: 1; overflow-y: auto; min-height: 0; }
  .panel-empty { padding: 28px 18px; text-align: center; font-size: 12.5px; color: #94A3B8;
    line-height: 1.6; }

  /* ---- Chat list ---- */
  .list-group-label { padding: 12px 14px 6px; font-size: 10px; font-weight: 800;
    text-transform: uppercase; letter-spacing: .06em; color: #94A3B8; }
  .list-row { display: flex; align-items: center; gap: 10px; width: 100%; border: none;
    background: none; text-align: left; cursor: pointer; padding: 8px 14px; }
  .list-row:hover { background: #F8FAFC; }
  .list-row .avatar { width: 32px; height: 32px; border-radius: 50%; color: #fff;
    font-size: 12.5px; font-weight: 700; display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; }
  .list-row .name { flex: 1; min-width: 0; font-size: 13.5px; font-weight: 600;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .list-row .count { min-width: 18px; height: 18px; border-radius: 999px; background: #DC2626;
    color: #fff; font-size: 10.5px; font-weight: 700; display: flex; align-items: center;
    justify-content: center; padding: 0 5px; flex-shrink: 0; }

  /* ---- Thread ---- */
  .thread-msgs { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; }
  .msg-row { display: flex; }
  .msg-row.mine { justify-content: flex-end; }
  .msg-bubble { max-width: 78%; border-radius: 14px; padding: 7px 11px; font-size: 12.5px;
    line-height: 1.5; }
  .msg-bubble.mine { background: #0B0F19; color: #fff; border-bottom-right-radius: 4px; }
  .msg-bubble.theirs { background: #F1F5F9; color: #0B0F19; border-bottom-left-radius: 4px; }
  .msg-author { display: block; font-size: 10px; font-weight: 700; margin-bottom: 2px; }
  .typing-inline { padding: 2px 14px 8px; font-size: 11px; color: #94A3B8; font-style: italic; }
  .composer { display: flex; gap: 6px; padding: 10px 12px; border-top: 1px solid #F1F5F9; flex-shrink: 0; }
  .composer input { flex: 1; min-width: 0; border: 1px solid #E2E8F0; border-radius: 999px;
    padding: 8px 12px; font-size: 12.5px; outline: none; }
  .composer input:focus { border-color: #0B0F19; }
  .composer button { border: none; background: #0B0F19; color: #fff; border-radius: 999px;
    width: 32px; height: 32px; flex-shrink: 0; cursor: pointer; display: flex;
    align-items: center; justify-content: center; }
  .composer button:disabled { background: #CBD5E1; }
  .composer button svg { width: 14px; height: 14px; }

  /* ---- Board / Pins / Highlights ---- */
  .action-row { padding: 10px 14px; border-bottom: 1px solid #F1F5F9; flex-shrink: 0; }
  .action-btn { width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px;
    border: 1px solid #E2E8F0; background: #fff; border-radius: 10px; padding: 8px; cursor: pointer;
    font-size: 12.5px; font-weight: 600; color: #0B0F19; }
  .action-btn:hover { border-color: #0B0F19; }
  .action-btn svg { width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 1.8; }
  .group { border-bottom: 1px solid #F1F5F9; }
  .group-head { display: flex; align-items: center; gap: 8px; padding: 10px 14px 4px; }
  .group-head .name { font-size: 12px; font-weight: 700; flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .group-head .site { font-size: 9.5px; font-weight: 700; text-transform: uppercase;
    color: #94A3B8; letter-spacing: .04em; }
  .item-row { display: flex; align-items: flex-start; gap: 8px; width: 100%; border: none;
    background: none; text-align: left; cursor: pointer; padding: 6px 14px 6px 20px; }
  .item-row:hover { background: #F8FAFC; }
  .item-row .ic { flex-shrink: 0; margin-top: 2px; }
  .item-row .ic svg { width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 2; }
  .item-row .ic.pin { color: #2563EB; }
  .item-row .ic.hl { color: #D97706; }
  .item-row .body { min-width: 0; flex: 1; }
  .item-row .text { font-size: 12.5px; line-height: 1.5; color: #0B0F19; }
  .item-row .text.quote { font-style: italic; color: #334155; }
  .item-row .meta { font-size: 10.5px; color: #94A3B8; margin-top: 1px; }
  .item-row .jump { flex-shrink: 0; color: #CBD5E1; margin-top: 2px; }
  .item-row .jump svg { width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 2; }

  .board-card { border-bottom: 1px solid #F1F5F9; padding: 10px 14px; }
  .board-card .thumb { width: 100%; height: 84px; border-radius: 8px; object-fit: cover;
    background: #F1F5F9; margin-bottom: 8px; }
  .board-card .title { font-size: 12.5px; font-weight: 700; line-height: 1.4; }
  .board-card .site { font-size: 10px; color: #94A3B8; margin-top: 2px; }
  .board-card .row { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
  .board-card .pill-btn { display: flex; align-items: center; gap: 4px; border: 1px solid #E2E8F0;
    background: #fff; border-radius: 999px; padding: 4px 9px; font-size: 11px; font-weight: 700;
    cursor: pointer; color: #64748B; }
  .board-card .pill-btn.on { border-color: #0B0F19; color: #0B0F19; }
  .board-card .pill-btn svg { width: 12px; height: 12px; stroke: currentColor; fill: none; stroke-width: 2; }
  .board-card .spacer { flex: 1; }
  .board-card .icon-btn { border: none; background: none; cursor: pointer; color: #94A3B8;
    padding: 3px; display: flex; }
  .board-card .icon-btn svg { width: 15px; height: 15px; stroke: currentColor; fill: none; stroke-width: 1.8; }
  .board-card .icon-btn.done { color: #059669; }
  .board-card .comments { margin-top: 8px; padding-top: 8px; border-top: 1px solid #F8FAFC; }
  .board-card .comment { font-size: 11.5px; line-height: 1.5; margin-bottom: 4px; }
  .board-card .comment b { font-weight: 700; }
  .board-card .decided-banner { display: flex; align-items: center; gap: 6px; background: #ECFDF5;
    color: #059669; font-size: 11px; font-weight: 700; padding: 6px 9px; border-radius: 8px;
    margin-top: 8px; }
  .board-card .comment-input { display: flex; gap: 6px; margin-top: 6px; }
  .board-card .comment-input input { flex: 1; min-width: 0; border: 1px solid #E2E8F0;
    border-radius: 8px; padding: 5px 8px; font-size: 11.5px; outline: none; }
  .board-card .comment-input button { border: none; background: #0B0F19; color: #fff;
    border-radius: 8px; width: 26px; flex-shrink: 0; cursor: pointer; }

  /* ---- Settings ---- */
  .setting-row { display: flex; align-items: center; gap: 10px; padding: 11px 14px;
    border-bottom: 1px solid #F1F5F9; }
  .setting-row .label { flex: 1; font-size: 12.5px; font-weight: 600; }
  .knob { width: 34px; height: 19px; border-radius: 999px; position: relative;
    background: #CBD5E1; transition: background .15s ease; flex-shrink: 0; border: none; cursor: pointer; }
  .knob.on { background: #0B0F19; }
  .knob::after { content: ""; position: absolute; top: 2px; left: 2px; width: 15px; height: 15px;
    border-radius: 50%; background: #fff; transition: left .15s ease; }
  .knob.on::after { left: 17px; }
  .setting-link { display: flex; align-items: center; padding: 11px 14px; border: none;
    background: none; width: 100%; text-align: left; cursor: pointer; font-size: 12.5px;
    font-weight: 600; color: #0B0F19; border-bottom: 1px solid #F1F5F9; }
  .setting-link .grow { flex: 1; }
  .setting-link svg { width: 15px; height: 15px; stroke: #CBD5E1; fill: none; stroke-width: 2; }
  .setting-danger { color: #DC2626; }
  .setting-danger:hover { background: #FEF2F2; }

  .refresh-chip { position: fixed; bottom: 20px; right: 20px; z-index: 2147483600;
    display: flex; align-items: center; gap: 6px; border: none; cursor: pointer;
    background: #D97706; color: #fff; font-size: 12px; font-weight: 700;
    padding: 9px 14px; border-radius: 999px; box-shadow: 0 10px 30px rgba(120,53,15,.35); }
`;

const ICONS = {
  chat: '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/></svg>',
  board:
    '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="13" height="10" rx="2.5"/><rect x="8" y="10" width="13" height="10" rx="2.5"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="5.5"/><path d="M12 14.5V21"/></svg>',
  highlight:
    '<svg viewBox="0 0 24 24"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/><path d="M4 21h9"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M3 11l18-8-8 18-2-8-8-2z"/></svg>',
  jump: '<svg viewBox="0 0 24 24"><path d="M7 17L17 7M7 7h10v10"/></svg>',
  thumb: '<svg viewBox="0 0 24 24"><path d="M7 10v11M3 10h4l2-8a2 2 0 0 1 2 2v5h7a2 2 0 0 1 2 2.3l-1.4 7A2 2 0 0 1 17 20H7"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>',
  trophy: '<svg viewBox="0 0 24 24"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/></svg>',
  chevron: '<svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>',
};

function initials(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

// ---- Shadow root plumbing --------------------------------------------------

let host: HTMLDivElement | null = null;
let shadow: ShadowRoot | null = null;
let actionsRef: PillActions | null = null;

function ensureRoot(): ShadowRoot {
  if (shadow) return shadow;
  host = document.createElement("div");
  host.id = "tabcom-pill-root";
  host.style.cssText = "all: initial;";
  document.documentElement.append(host);
  shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = STYLES;
  shadow.append(style);
  return shadow;
}

function clearAll() {
  shadow
    ?.querySelectorAll(".fab, .panel, .typing-pill, .refresh-chip")
    .forEach((el) => el.remove());
}

// ---- Orphan resilience (learned the hard way — see M21/M24/M25) ----------

export function extensionAlive(): boolean {
  try {
    return !!browser.runtime?.id;
  } catch {
    return false;
  }
}

let invalidated = false;

export function showRefreshChip(): void {
  if (invalidated) return;
  invalidated = true;
  const root = ensureRoot();
  clearAll();
  const chip = document.createElement("button");
  chip.className = "refresh-chip";
  chip.textContent = "↻  Tabcom was updated — click to refresh";
  chip.addEventListener("click", () => window.location.reload());
  root.append(chip);
}

function guarded<T extends unknown[]>(
  fn: (...args: T) => void | Promise<void>
): (...args: T) => void {
  return (...args: T) => {
    if (invalidated) return;
    if (!extensionAlive()) {
      showRefreshChip();
      return;
    }
    try {
      const result = fn(...args);
      if (result instanceof Promise) {
        result.catch((error) => {
          if (String(error).includes("context invalidated")) showRefreshChip();
        });
      }
    } catch (error) {
      if (String(error).includes("context invalidated")) showRefreshChip();
    }
  };
}

async function safeSendMessage(message: Record<string, unknown>): Promise<unknown> {
  if (!extensionAlive()) {
    showRefreshChip();
    return null;
  }
  try {
    return await browser.runtime.sendMessage(message);
  } catch (error) {
    if (String(error).includes("context invalidated")) showRefreshChip();
    return null;
  }
}

// ---- View state -------------------------------------------------------------

type View =
  | { kind: "collapsed" }
  | { kind: "chats" }
  | { kind: "thread"; entry: ChatEntry }
  | { kind: "board" }
  | { kind: "pins" }
  | { kind: "highlights" }
  | { kind: "settings" };

let view: View = { kind: "collapsed" };
let selectedCommunityId: string | null = null;
let typingFrom: { username: string; name: string; color: string } | null = null;
let typingTimer: ReturnType<typeof setTimeout> | null = null;
let threadTypingPeer = false;
let threadTypingTimer: ReturnType<typeof setTimeout> | null = null;
let username: string | null = null;

function setView(next: View) {
  view = next;
  void render();
}

// ---- Boot + live event wiring ----------------------------------------------

let initialized = false;

export function initPagePill(actions: PillActions): void {
  actionsRef = actions;
  if (initialized) return;
  initialized = true;
  console.log(`[tabcom] page pill ${PILL_VERSION} initializing`);

  void render();

  onPillEnabledChange((enabled) => {
    if (!enabled) clearAll();
    else void render();
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (
      "tabcom:chat" in changes ||
      "tabcom:profile" in changes ||
      "tabcom:inbox-buffer" in changes
    ) {
      void render();
    }
  });

  browser.runtime.onMessage.addListener((message) => {
    if (invalidated) return undefined;

    if (message?.type === "tabcom:dm-live") {
      handleIncomingLive("dm", message.from, message.message);
      return undefined;
    }
    if (message?.type === "tabcom:community-message-live") {
      handleIncomingLive("community", message.from, message.message, message.communityId);
      return undefined;
    }
    if (message?.type === "tabcom:typing-live") {
      handleTypingLive(message.from);
      return undefined;
    }
    if (message?.type === "tabcom:community-updated") {
      void render();
      return undefined;
    }
    return undefined;
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && view.kind !== "collapsed") setView({ kind: "collapsed" });
  });
}

export function refreshPagePill(): void {
  void render();
}

async function handleIncomingLive(
  kind: "dm" | "community",
  from: { username: string; name: string; color: string },
  message: ThreadMessage,
  communityId?: string
) {
  typingFrom = null;
  if (typingTimer) clearTimeout(typingTimer);

  // If the thread this belongs to is already open, echo it straight into
  // the visible conversation and clear the peer's typing indicator.
  if (view.kind === "thread") {
    const matches =
      kind === "dm" ? view.entry.id === from.username : view.entry.id === communityId;
    if (matches) {
      threadTypingPeer = false;
      if (threadTypingTimer) clearTimeout(threadTypingTimer);
      await appendMessageLocally(view.entry.conversationId ?? "", {
        ...message,
        authorId: `u-${from.username}`,
        authorName: from.name,
        authorColor: from.color,
      });
      void render();
      return;
    }
  }

  void render(); // refresh badges/list in the background
}

function handleTypingLive(from: { username: string; name: string; color: string }) {
  if (view.kind === "thread" && view.entry.kind === "dm" && view.entry.id === from.username) {
    threadTypingPeer = true;
    if (threadTypingTimer) clearTimeout(threadTypingTimer);
    threadTypingTimer = setTimeout(() => {
      threadTypingPeer = false;
      void render();
    }, 3000);
    void render();
    return;
  }

  if (view.kind !== "collapsed") return; // don't hijack an open panel

  typingFrom = from;
  if (typingTimer) clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    typingFrom = null;
    void render();
  }, 3500);
  void render();
}

// ---- Root render dispatcher --------------------------------------------------

async function render() {
  if (invalidated) return;
  if (!extensionAlive()) {
    showRefreshChip();
    return;
  }

  const root = ensureRoot();
  clearAll();

  if (!(await getPillEnabled())) return;

  username = await readUsername();
  if (!username) return; // not onboarded — stay invisible

  if (typingFrom && view.kind === "collapsed") {
    renderTypingPill(root, typingFrom);
    return;
  }

  renderBar(root);

  switch (view.kind) {
    case "chats":
      await renderChatsPanel(root);
      break;
    case "thread":
      await renderThreadPanel(root, view.entry);
      break;
    case "board":
      await renderBoardPanel(root);
      break;
    case "pins":
      await renderAnnotationPanel(root, "pins");
      break;
    case "highlights":
      await renderAnnotationPanel(root, "highlights");
      break;
    case "settings":
      await renderSettingsPanel(root);
      break;
  }
}

function renderTypingPill(
  root: ShadowRoot,
  from: { username: string; name: string; color: string }
) {
  const pill = document.createElement("div");
  pill.className = "typing-pill";
  pill.innerHTML = `
    <span class="avatar" style="background:${from.color}">${initials(from.name)}</span>
    <span class="label">${from.name.split(" ")[0]} is typing…</span>
  `;
  pill.addEventListener(
    "click",
    guarded(async () => {
      typingFrom = null;
      if (typingTimer) clearTimeout(typingTimer);
      const { conversations, contacts } = await readChatState();
      const conversation = conversations.find((c) => {
        const contact = contacts.find((item) => item.id === c.contactId);
        return contact?.username === from.username;
      });
      const contact = contacts.find((c) => c.username === from.username);
      setView({
        kind: "thread",
        entry: {
          kind: "dm",
          id: from.username,
          conversationId: conversation?.id ?? null,
          label: contact?.alias || contact?.name || from.name,
          color: from.color,
          unread: 0,
        },
      });
    })
  );
  root.append(pill);
}

// ---- Collapsed bar -----------------------------------------------------------

async function renderBar(root: ShadowRoot) {
  const bar = document.createElement("div");
  bar.className = "fab";
  bar.title = `Tabcom pill ${PILL_VERSION}`;

  const status = document.createElement("span");
  status.className = "status";
  bar.append(status);

  const unreadTotal = await computeTotalUnread();

  const chatBtn = iconButton("chat", "Chats", view.kind === "chats" || view.kind === "thread", () =>
    setView(view.kind === "chats" || view.kind === "thread" ? { kind: "collapsed" } : { kind: "chats" })
  );
  if (unreadTotal > 0) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = unreadTotal > 99 ? "99+" : String(unreadTotal);
    chatBtn.append(badge);
  }
  bar.append(chatBtn);

  const divider = document.createElement("span");
  divider.className = "divider";
  bar.append(divider);

  bar.append(
    iconButton("board", "Board", view.kind === "board", () =>
      setView(view.kind === "board" ? { kind: "collapsed" } : { kind: "board" })
    ),
    iconButton("pin", "Pins", view.kind === "pins", () =>
      setView(view.kind === "pins" ? { kind: "collapsed" } : { kind: "pins" })
    ),
    iconButton("highlight", "Highlights", view.kind === "highlights", () =>
      setView(view.kind === "highlights" ? { kind: "collapsed" } : { kind: "highlights" })
    ),
    iconButton("more", "Settings", view.kind === "settings", () =>
      setView(view.kind === "settings" ? { kind: "collapsed" } : { kind: "settings" })
    )
  );

  root.append(bar);
}

function iconButton(
  icon: keyof typeof ICONS,
  label: string,
  active: boolean,
  onClick: () => void
): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = active ? "ibtn active" : "ibtn";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = ICONS[icon];
  button.addEventListener(
    "click",
    guarded((e: Event) => {
      e.stopPropagation();
      onClick();
    })
  );
  return button;
}

async function computeTotalUnread(): Promise<number> {
  const entries = await buildChatEntries();
  return entries.reduce((n, e) => n + e.unread, 0);
}

// ---- Panel shell helper ------------------------------------------------------

function panelShell(opts: {
  title: string;
  subtitle?: string;
  avatar?: { name: string; color: string };
  onBack?: () => void;
}): { panel: HTMLDivElement; body: HTMLDivElement } {
  const panel = document.createElement("div");
  panel.className = "panel";

  const head = document.createElement("div");
  head.className = "panel-head";

  if (opts.onBack) {
    const back = document.createElement("button");
    back.className = "back";
    back.innerHTML = ICONS.back;
    back.addEventListener("click", guarded(opts.onBack));
    head.append(back);
  }

  if (opts.avatar) {
    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.style.background = opts.avatar.color;
    avatar.textContent = initials(opts.avatar.name);
    head.append(avatar);
  }

  const titleWrap = document.createElement("div");
  titleWrap.style.cssText = "flex:1; min-width:0;";
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = opts.title;
  titleWrap.append(title);
  if (opts.subtitle) {
    const sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = opts.subtitle;
    titleWrap.append(sub);
  }
  head.append(titleWrap);
  panel.append(head);

  const body = document.createElement("div");
  body.className = "panel-body";
  panel.append(body);

  return { panel, body };
}

function emptyState(root: HTMLElement, text: string) {
  const el = document.createElement("div");
  el.className = "panel-empty";
  el.textContent = text;
  root.append(el);
}

// ---- Chats panel --------------------------------------------------------------

async function buildChatEntries(): Promise<ChatEntry[]> {
  if (!username) return [];
  const [{ conversations, contacts, communities }, buffered] = await Promise.all([
    readChatState(),
    readBufferedCounts(),
  ]);

  const entries: ChatEntry[] = [];

  for (const community of Object.values(communities)) {
    if (!community.members?.some((m) => m.username === username)) continue;
    const conversation = conversations.find((c) => c.communityId === community.id);
    entries.push({
      kind: "community",
      id: community.id,
      conversationId: conversation?.id ?? null,
      label: community.name,
      color: "#0B0F19",
      unread: (conversation?.unread ?? 0) + (buffered[`c:${community.id}`] ?? 0),
    });
  }

  for (const conversation of conversations) {
    if (!conversation.contactId) continue;
    const contact = contacts.find((c) => c.id === conversation.contactId);
    if (!contact) continue;
    entries.push({
      kind: "dm",
      id: contact.username,
      conversationId: conversation.id,
      label: contact.alias || contact.name,
      color: contact.color,
      unread: (conversation.unread ?? 0) + (buffered[`d:${contact.username}`] ?? 0),
    });
  }

  return entries.sort((a, b) => b.unread - a.unread || a.label.localeCompare(b.label));
}

async function renderChatsPanel(root: ShadowRoot) {
  const { panel, body } = panelShell({
    title: "Chats",
    onBack: () => setView({ kind: "collapsed" }),
  });

  const entries = await buildChatEntries();
  const dms = entries.filter((e) => e.kind === "dm");
  const communities = entries.filter((e) => e.kind === "community");

  if (entries.length === 0) {
    emptyState(body, "No conversations yet. Connect with people or join a community from the Tabcom panel.");
  } else {
    if (dms.length > 0) {
      appendGroupLabel(body, `Chats — ${dms.length}`);
      for (const entry of dms) body.append(chatRow(entry));
    }
    if (communities.length > 0) {
      appendGroupLabel(body, `Community — ${communities.length}`);
      for (const entry of communities) body.append(chatRow(entry));
    }
  }

  root.append(panel);
}

function appendGroupLabel(body: HTMLElement, text: string) {
  const label = document.createElement("div");
  label.className = "list-group-label";
  label.textContent = text;
  body.append(label);
}

function chatRow(entry: ChatEntry): HTMLButtonElement {
  const row = document.createElement("button");
  row.className = "list-row";
  row.innerHTML = `
    <span class="avatar" style="background:${entry.color}">${initials(entry.label)}</span>
    <span class="name">${entry.label.replace(/</g, "&lt;")}</span>
  `;
  if (entry.unread > 0) {
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = entry.unread > 99 ? "99+" : String(entry.unread);
    row.append(count);
  }
  row.addEventListener(
    "click",
    guarded(() => setView({ kind: "thread", entry }))
  );
  return row;
}

// ---- Thread panel ---------------------------------------------------------------

let threadDraft = "";
let lastTypingSentAt = 0;

async function renderThreadPanel(root: ShadowRoot, entry: ChatEntry) {
  const { panel, body } = panelShell({
    title: entry.label,
    subtitle: entry.kind === "dm" ? (threadTypingPeer ? "typing…" : undefined) : "Community",
    avatar: { name: entry.label, color: entry.color },
    onBack: () => setView({ kind: "chats" }),
  });

  const { messages } = await readChatState();
  const thread = entry.conversationId ? (messages[entry.conversationId] ?? []) : [];

  const msgsWrap = document.createElement("div");
  msgsWrap.className = "thread-msgs";

  if (thread.length === 0) {
    emptyState(msgsWrap, "No messages yet — say hello.");
  } else {
    for (const message of thread) {
      const mine = message.authorId === "me";
      const row = document.createElement("div");
      row.className = mine ? "msg-row mine" : "msg-row";
      const bubble = document.createElement("div");
      bubble.className = mine ? "msg-bubble mine" : "msg-bubble theirs";
      if (!mine && entry.kind === "community" && message.authorName) {
        bubble.innerHTML = `<span class="msg-author" style="color:${message.authorColor ?? "#64748B"}">${message.authorName.replace(/</g, "&lt;")}</span>`;
      }
      bubble.append(document.createTextNode(message.text));
      row.append(bubble);
      msgsWrap.append(row);
    }
  }
  body.append(msgsWrap);

  if (threadTypingPeer) {
    const typing = document.createElement("div");
    typing.className = "typing-inline";
    typing.textContent = `${entry.label.split(" ")[0]} is typing…`;
    body.append(typing);
  }

  panel.append(body);
  requestAnimationFrame(() => {
    body.scrollTop = body.scrollHeight;
  });

  const composer = document.createElement("div");
  composer.className = "composer";
  const input = document.createElement("input");
  input.placeholder = "Message…";
  input.value = threadDraft;

  const sendButton = document.createElement("button");
  sendButton.innerHTML = ICONS.send;

  const submit = guarded(async () => {
    const text = input.value.trim();
    if (!text || !entry.conversationId) return;
    threadDraft = "";

    const optimistic: ThreadMessage = {
      id: crypto.randomUUID(),
      authorId: "me",
      kind: "text",
      text,
      sentAt: Date.now(),
    };
    await appendMessageLocally(entry.conversationId, optimistic);
    void render();

    if (entry.kind === "dm") {
      await safeSendMessage({
        type: "tabcom:board-write",
        action: "dm_send",
        payload: { username: entry.id, text },
      });
    } else {
      await safeSendMessage({
        type: "tabcom:board-write",
        action: "community_message",
        payload: { communityId: entry.id, text },
      });
    }
  });

  input.addEventListener("input", () => {
    threadDraft = input.value;
    sendButton.disabled = !input.value.trim();

    if (entry.kind === "dm") {
      const now = Date.now();
      if (now - lastTypingSentAt > 1500) {
        lastTypingSentAt = now;
        void safeSendMessage({
          type: "tabcom:board-write",
          action: "typing_send",
          payload: { username: entry.id },
        });
      }
    }
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });
  sendButton.disabled = !input.value.trim();
  sendButton.addEventListener("click", submit);

  composer.append(input, sendButton);
  panel.append(composer);

  root.append(panel);
  input.focus();
}

// ---- Board panel -----------------------------------------------------------------

async function eligibleCommunities(): Promise<Array<{ id: string; name: string }>> {
  const { communities } = await readChatState();
  if (!username) return [];
  return Object.values(communities)
    .filter((c) => c.members?.some((m) => m.username === username))
    .map((c) => ({ id: c.id, name: c.name }));
}

async function ensureSelectedCommunity(): Promise<{ id: string; name: string } | null> {
  const list = await eligibleCommunities();
  if (list.length === 0) return null;
  if (!selectedCommunityId || !list.some((c) => c.id === selectedCommunityId)) {
    selectedCommunityId = list[0].id;
  }
  return list.find((c) => c.id === selectedCommunityId) ?? null;
}

async function renderBoardPanel(root: ShadowRoot) {
  const community = await ensureSelectedCommunity();

  const { panel, body } = panelShell({
    title: community?.name ?? "Board",
    onBack: () => setView({ kind: "collapsed" }),
  });

  const actionRow = document.createElement("div");
  actionRow.className = "action-row";
  const addButton = document.createElement("button");
  addButton.className = "action-btn";
  addButton.innerHTML = `${ICONS.board} <span>Add this page</span>`;
  addButton.addEventListener(
    "click",
    guarded(async () => {
      if (!community) return;
      await actionsRef?.addCurrentPage(community.id);
    })
  );
  actionRow.append(addButton);
  body.append(actionRow);

  if (!community) {
    emptyState(body, "You're not in a community yet — create one from the Tabcom panel.");
    root.append(panel);
    return;
  }

  const { communities } = await readChatState();
  const items = communities[community.id]?.board ?? [];

  if (items.length === 0) {
    emptyState(body, "No pages on this board yet.");
  } else {
    for (const item of items) body.append(boardCard(community.id, item));
  }

  root.append(panel);
}

function boardCard(communityId: string, item: BoardItem): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "board-card";

  const hasVoted = !!username && item.votes.includes(username);
  const isAdmin = true; // admin-only actions are also enforced server-side; UI just offers the affordance

  card.innerHTML = `
    ${item.image ? `<img class="thumb" src="${item.image}" alt="" />` : ""}
    <div class="title">${item.title.replace(/</g, "&lt;")}</div>
    ${item.siteName ? `<div class="site">${item.siteName.replace(/</g, "&lt;")}</div>` : ""}
  `;

  const row = document.createElement("div");
  row.className = "row";

  const voteBtn = document.createElement("button");
  voteBtn.className = hasVoted ? "pill-btn on" : "pill-btn";
  voteBtn.innerHTML = `${ICONS.thumb} <span>${item.votes.length}</span>`;
  voteBtn.addEventListener(
    "click",
    guarded(() =>
      safeSendMessage({
        type: "tabcom:board-write",
        action: "board_vote",
        payload: { communityId, itemId: item.id },
      }).then(() => void render())
    )
  );
  row.append(voteBtn);

  const spacer = document.createElement("span");
  spacer.className = "spacer";
  row.append(spacer);

  if (!item.decided) {
    const decideBtn = document.createElement("button");
    decideBtn.className = "icon-btn";
    decideBtn.title = "Mark as decided";
    decideBtn.innerHTML = ICONS.check;
    decideBtn.addEventListener(
      "click",
      guarded(() =>
        safeSendMessage({
          type: "tabcom:board-write",
          action: "board_decide",
          payload: { communityId, itemId: item.id },
        }).then(() => void render())
      )
    );
    row.append(decideBtn);
  }

  const removeBtn = document.createElement("button");
  removeBtn.className = "icon-btn";
  removeBtn.title = "Remove";
  removeBtn.innerHTML = ICONS.trash;
  removeBtn.addEventListener(
    "click",
    guarded(() =>
      safeSendMessage({
        type: "tabcom:board-write",
        action: "board_remove_item",
        payload: { communityId, itemId: item.id },
      }).then(() => void render())
    )
  );
  row.append(removeBtn);
  card.append(row);

  if (item.decided) {
    const banner = document.createElement("div");
    banner.className = "decided-banner";
    banner.innerHTML = `${ICONS.trophy} <span>Decided</span>`;
    card.append(banner);
  }

  if (item.comments.length > 0) {
    const commentsWrap = document.createElement("div");
    commentsWrap.className = "comments";
    for (const comment of item.comments) {
      const c = document.createElement("div");
      c.className = "comment";
      c.innerHTML = `<b>@${comment.author}</b> ${comment.text.replace(/</g, "&lt;")}`;
      commentsWrap.append(c);
    }
    card.append(commentsWrap);
  }

  const commentInput = document.createElement("div");
  commentInput.className = "comment-input";
  const input = document.createElement("input");
  input.placeholder = "Comment…";
  const send = document.createElement("button");
  send.innerHTML = ICONS.send;
  const submit = guarded(async () => {
    const text = input.value.trim();
    if (!text) return;
    await safeSendMessage({
      type: "tabcom:board-write",
      action: "board_comment",
      payload: { communityId, itemId: item.id, text },
    });
    input.value = "";
    void render();
  });
  send.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });
  commentInput.append(input, send);
  card.append(commentInput);

  void isAdmin;
  return card;
}

// ---- Pins / Highlights panels -------------------------------------------------

async function renderAnnotationPanel(root: ShadowRoot, mode: "pins" | "highlights") {
  const community = await ensureSelectedCommunity();

  const { panel, body } = panelShell({
    title: mode === "pins" ? "Pins" : "Highlights",
    subtitle: community?.name,
    onBack: () => setView({ kind: "collapsed" }),
  });

  const actionRow = document.createElement("div");
  actionRow.className = "action-row";
  const button = document.createElement("button");
  button.className = "action-btn";
  button.innerHTML =
    mode === "pins"
      ? `${ICONS.pin} <span>Pin a spot on this page</span>`
      : `${ICONS.highlight} <span>Highlight text on this page</span>`;
  button.addEventListener(
    "click",
    guarded(() => {
      if (!community) return;
      if (mode === "pins") actionsRef?.enterPinMode(community.id);
      else actionsRef?.enterHighlightMode(community.id);
    })
  );
  actionRow.append(button);
  body.append(actionRow);

  if (!community) {
    emptyState(body, "You're not in a community yet.");
    root.append(panel);
    return;
  }

  const { communities } = await readChatState();
  const items = (communities[community.id]?.board ?? []).filter((item) =>
    mode === "pins" ? item.pins.length > 0 : item.highlights.length > 0
  );

  if (items.length === 0) {
    emptyState(
      body,
      mode === "pins"
        ? "No pins yet. Drop one on any page on the board."
        : "No highlights yet. Select text on any page on the board."
    );
  } else {
    for (const item of items) {
      const group = document.createElement("div");
      group.className = "group";
      const head = document.createElement("div");
      head.className = "group-head";
      head.innerHTML = `
        <span class="name">${item.title.replace(/</g, "&lt;")}</span>
        ${item.siteName ? `<span class="site">${item.siteName.replace(/</g, "&lt;")}</span>` : ""}
      `;
      group.append(head);

      const rows = mode === "pins" ? item.pins : item.highlights;
      for (const entry of rows) {
        const row = document.createElement("button");
        row.className = "item-row";
        const text = mode === "pins" ? (entry as BoardPin).text : `"${(entry as BoardHighlight).quote.slice(0, 90)}${(entry as BoardHighlight).quote.length > 90 ? "…" : ""}"`;
        row.innerHTML = `
          <span class="ic ${mode === "pins" ? "pin" : "hl"}">${mode === "pins" ? ICONS.pin : ICONS.highlight}</span>
          <span class="body">
            <span class="text${mode === "highlights" ? " quote" : ""}">${text.replace(/</g, "&lt;")}</span>
            <span class="meta">@${entry.author}</span>
          </span>
          <span class="jump">${ICONS.jump}</span>
        `;
        row.addEventListener(
          "click",
          guarded(() => {
            actionsRef?.navigateToAnnotation(
              { url: item.url, canonicalKey: item.canonicalKey },
              { kind: mode === "pins" ? "pin" : "highlight", id: entry.id }
            );
          })
        );
        group.append(row);
      }

      body.append(group);
    }
  }

  root.append(panel);
}

// ---- Settings panel ------------------------------------------------------------

async function renderSettingsPanel(root: ShadowRoot) {
  const { panel, body } = panelShell({
    title: "Settings",
    onBack: () => setView({ kind: "collapsed" }),
  });

  const [cursorsOn, toggles] = await Promise.all([getCursorsEnabled(), getProfileToggles()]);

  body.append(
    settingToggle("Live cursors", cursorsOn, async (next) => {
      await setCursorsEnabled(next);
      void render();
    })
  );

  body.append(
    settingToggle("Message animations", toggles?.animations ?? true, async (next) => {
      await setProfileToggle("animations", next);
      void render();
    })
  );

  body.append(
    settingToggle("Public profile", toggles?.visibility !== "private", async (next) => {
      await setProfileToggle("visibility", next ? "public" : "private");
      void render();
    })
  );

  body.append(
    settingToggle("Tabcom pill on pages", true, async (next) => {
      if (!next) {
        await setPillEnabled(false);
        clearAll();
      }
    })
  );

  const openPanelLink = document.createElement("button");
  openPanelLink.className = "setting-link";
  openPanelLink.innerHTML = `<span class="grow">Open Tabcom panel</span>${ICONS.chevron}`;
  openPanelLink.addEventListener("click", guarded(() => actionsRef?.openPanel()));
  body.append(openPanelLink);

  root.append(panel);
}

function settingToggle(
  label: string,
  value: boolean,
  onChange: (next: boolean) => void
): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "setting-row";
  const text = document.createElement("span");
  text.className = "label";
  text.textContent = label;
  const knob = document.createElement("button");
  knob.className = value ? "knob on" : "knob";
  knob.addEventListener(
    "click",
    guarded(() => onChange(!value))
  );
  row.append(text, knob);
  return row;
}
