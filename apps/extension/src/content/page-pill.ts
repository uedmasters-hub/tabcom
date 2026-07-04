import { browser } from "wxt/browser";

import {
  getCursorsEnabled,
  getPillEnabled,
  onPillEnabledChange,
  setCursorsEnabled,
  setPillEnabled,
} from "../lib/pill-settings";

/**
 * Tabcom page pill — a pill-shaped floating action button, bottom-right
 * of every page, giving one-tap access to community actions without
 * opening the side panel.
 *
 * Design principles:
 *  - Fully self-contained: own shadow root, own styles, zero coupling
 *    to the annotation overlay's internals. Everything it needs from
 *    the host content script arrives via the `PillActions` callbacks.
 *  - Storage-driven: reads profile/communities passively from
 *    browser.storage.local (no network), obeys the single
 *    "tabcom:pill-enabled" flag, and reacts live when that flag is
 *    toggled from Settings.
 *  - Honest states: onboarded + communities -> full menu; onboarded but
 *    no community -> explains what to do; not onboarded -> stays hidden.
 */

export const PILL_VERSION = "M21";

export interface PillActions {
  enterPinMode: (communityId: string) => void;
  enterHighlightMode: (communityId: string) => void;
  addCurrentPage: (communityId: string) => Promise<boolean>;
  openPanel: () => void;
}

interface PillCommunity {
  id: string;
  name: string;
}

const ICONS = {
  chat: '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/></svg>',
  add: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 4H6a2 2 0 0 0-2 2v10"/><path d="M14.5 12h-0.01M14.5 14.5v-5M12 14.5h5" stroke-width="0"/><path d="M14.5 11v6M11.5 14h6"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="5.5"/><path d="M12 14.5V21"/></svg>',
  highlight: '<svg viewBox="0 0 24 24"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/><path d="M4 21h9" /></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>',
};

/** After the extension reloads, content scripts already injected into
 *  open tabs become orphans — the pill still renders but every
 *  browser.* call throws "Extension context invalidated". Detect it and
 *  show a clear call to action instead of dying silently. */
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

  const root = ensurePillRoot();
  clearUI();

  const chip = document.createElement("button");
  chip.className = "refresh-chip";
  chip.innerHTML = `↻&nbsp; Tabcom was updated — click to refresh this page`;
  chip.addEventListener("click", () => window.location.reload());
  root.append(chip);
}

/** Wrap any handler that talks to the extension. */
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

let host: HTMLDivElement | null = null;
let shadow: ShadowRoot | null = null;
let expanded = false;
let chatMenuOpen = false;
let selectedCommunityId: string | null = null;
let actionsRef: PillActions | null = null;

// ---- storage readers (passive, zero network) ---------------------------

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

async function readMemberCommunities(
  username: string
): Promise<PillCommunity[]> {
  try {
    const result = await browser.storage.local.get("tabcom:chat");
    const raw = result["tabcom:chat"] as string | undefined;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const communities = (parsed.state ?? parsed)?.communities ?? {};
    return Object.values(
      communities as Record<
        string,
        { id: string; name: string; members: Array<{ username: string }> }
      >
    )
      .filter((c) => c.members?.some((m) => m.username === username))
      .map((c) => ({ id: c.id, name: c.name }));
  } catch {
    return [];
  }
}

interface ChatEntry {
  kind: "community" | "dm";
  id: string; // community id, or contact USERNAME for dms
  conversationId: string | null;
  label: string;
  unread: number;
}

async function readChatEntries(username: string): Promise<ChatEntry[]> {
  try {
    const result = await browser.storage.local.get([
      "tabcom:chat",
      "tabcom:inbox-buffer",
    ]);

    const raw = result["tabcom:chat"] as string | undefined;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const state = parsed.state ?? parsed;
    const conversations: Array<{
      id: string;
      contactId?: string;
      communityId?: string;
      unread?: number;
    }> = state.conversations ?? [];
    const contacts: Array<{
      id: string;
      username: string;
      name: string;
      alias?: string;
    }> = state.contacts ?? [];
    const communities: Record<string, { id: string; name: string; members: Array<{ username: string }> }> =
      state.communities ?? {};

    // Messages buffered while the panel was closed add to unread counts.
    const buffered: Record<string, number> = {};
    const rawBuffer = result["tabcom:inbox-buffer"] as string | undefined;
    if (rawBuffer) {
      for (const entry of JSON.parse(rawBuffer)) {
        const key =
          entry.kind === "community"
            ? `c:${entry.communityId}`
            : `d:${entry.from?.username}`;
        buffered[key] = (buffered[key] ?? 0) + 1;
      }
    }

    const entries: ChatEntry[] = [];

    for (const community of Object.values(communities)) {
      if (!community.members?.some((m) => m.username === username)) continue;
      const conversation = conversations.find(
        (c) => c.communityId === community.id
      );
      entries.push({
        kind: "community",
        id: community.id,
        conversationId: conversation?.id ?? null,
        label: community.name,
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
        unread:
          (conversation.unread ?? 0) + (buffered[`d:${contact.username}`] ?? 0),
      });
    }

    // Unread first, then alphabetical — the badge earns its position.
    return entries.sort(
      (a, b) => b.unread - a.unread || a.label.localeCompare(b.label)
    );
  } catch {
    return [];
  }
}

// ---- shadow scaffolding -------------------------------------------------

const STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }

  .fab { position: fixed; bottom: 20px; right: 20px; z-index: 2147483600;
    display: flex; align-items: center; gap: 2px;
    background: #111827; border-radius: 999px; padding: 6px 8px;
    box-shadow: 0 10px 34px rgba(2,6,23,.4); }
  .fab .status { width: 7px; height: 7px; border-radius: 50%; background: #10B981;
    margin: 0 6px 0 6px; box-shadow: 0 0 0 3px rgba(16,185,129,.18); }
  .fab .ibtn { width: 34px; height: 34px; border-radius: 999px; border: none;
    background: transparent; color: #E2E8F0; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background .12s ease, color .12s ease, transform .1s ease; }
  .fab .ibtn:hover { background: rgba(255,255,255,.12); color: #fff; transform: translateY(-1px); }
  .fab .ibtn:active { transform: translateY(0); }
  .fab .ibtn svg { width: 17px; height: 17px; stroke: currentColor; fill: none;
    stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .fab .divider { width: 1px; height: 20px; background: rgba(255,255,255,.16); margin: 0 5px; }
  .fab .ibtn { position: relative; }
  .fab .badge { position: absolute; top: 1px; right: 1px; min-width: 15px; height: 15px;
    border-radius: 999px; background: #EF4444; color: #fff; font-size: 9.5px; font-weight: 800;
    display: flex; align-items: center; justify-content: center; padding: 0 4px;
    border: 2px solid #111827; }
  .menu .chat-row { display: flex; align-items: center; gap: 9px; width: 100%;
    border: none; background: none; text-align: left; cursor: pointer;
    padding: 8px; border-radius: 10px; font-size: 12.5px; font-weight: 600; color: #0F172A; }
  .menu .chat-row:hover { background: #F1F5F9; }
  .menu .chat-row .tag { font-size: 9px; font-weight: 800; text-transform: uppercase;
    letter-spacing: .04em; color: #94A3B8; width: 30px; flex-shrink: 0; }
  .menu .chat-row .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .menu .chat-row .count { min-width: 17px; height: 17px; border-radius: 999px; background: #EF4444;
    color: #fff; font-size: 10px; font-weight: 800; display: flex; align-items: center;
    justify-content: center; padding: 0 5px; flex-shrink: 0; }

  .menu { position: fixed; bottom: 72px; right: 20px; z-index: 2147483600;
    width: 244px; background: #fff; color: #0F172A;
    border-radius: 14px; box-shadow: 0 18px 50px rgba(2,6,23,.28); padding: 8px; }
  .menu .title { font-size: 10.5px; font-weight: 800; text-transform: uppercase;
    letter-spacing: .05em; color: #94A3B8; padding: 4px 8px 6px; }
  .menu select { width: 100%; border: 1px solid #E2E8F0; border-radius: 10px;
    padding: 7px 8px; font-size: 12.5px; background: #fff; color: #0F172A;
    margin: 0 0 6px; }
  .menu .row { display: flex; align-items: center; gap: 9px; width: 100%;
    border: none; background: none; text-align: left; cursor: pointer;
    padding: 8px; border-radius: 10px; font-size: 12.5px; font-weight: 600;
    color: #0F172A; }
  .menu .row:hover { background: #F1F5F9; }
  .menu .row .grow { flex: 1; }
  .menu .knob { width: 32px; height: 18px; border-radius: 999px; position: relative;
    background: #CBD5E1; transition: background .15s ease; flex-shrink: 0; }
  .menu .knob.on { background: #0F172A; }
  .menu .knob::after { content: ""; position: absolute; top: 2px; left: 2px;
    width: 14px; height: 14px; border-radius: 50%; background: #fff;
    transition: left .15s ease; }
  .menu .knob.on::after { left: 16px; }
  .menu .divider { height: 1px; background: #F1F5F9; margin: 5px 4px; }
  .menu .danger { color: #DC2626; }
  .menu .danger:hover { background: #FEF2F2; }
  .menu .empty { padding: 8px; font-size: 12px; color: #64748B; line-height: 1.5; }

  .refresh-chip { position: fixed; bottom: 20px; right: 20px; z-index: 2147483600;
    display: flex; align-items: center; gap: 4px; border: none; cursor: pointer;
    background: #F59E0B; color: #451A03; font-size: 12px; font-weight: 700;
    padding: 9px 14px; border-radius: 999px; box-shadow: 0 10px 30px rgba(120,53,15,.35);
    font-family: inherit; }
  .refresh-chip:hover { background: #FBbf24; }

  .toast { position: fixed; bottom: 72px; right: 20px; z-index: 2147483600;
    background: #0F172A; color: #fff; font-size: 12px; font-weight: 600;
    padding: 8px 14px; border-radius: 999px; box-shadow: 0 10px 30px rgba(2,6,23,.35); }
`;

function ensurePillRoot(): ShadowRoot {
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

function clearUI() {
  shadow
    ?.querySelectorAll(".fab, .menu, .toast, .refresh-chip")
    .forEach((el) => el.remove());
}

function toast(message: string) {
  const root = ensurePillRoot();
  root.querySelectorAll(".toast").forEach((el) => el.remove());
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  root.append(el);
  setTimeout(() => el.remove(), 1800);
}

// ---- rendering ----------------------------------------------------------

async function render() {
  if (invalidated) return;
  if (!extensionAlive()) {
    showRefreshChip();
    return;
  }

  const root = ensurePillRoot();
  clearUI();

  if (!(await getPillEnabled())) return;

  const username = await readUsername();
  if (!username) return; // not onboarded — never show

  const communities = await readMemberCommunities(username);
  if (
    selectedCommunityId &&
    !communities.some((c) => c.id === selectedCommunityId)
  ) {
    selectedCommunityId = null;
  }
  if (!selectedCommunityId && communities.length > 0) {
    selectedCommunityId = communities[0].id;
  }

  const bar = document.createElement("div");
  bar.className = "fab";
  bar.title = `Tabcom pill ${PILL_VERSION} — you're visible as Online`;

  const status = document.createElement("span");
  status.className = "status";
  bar.append(status);

  const iconButton = (
    icon: keyof typeof ICONS,
    label: string,
    onClick: () => void,
    dataAction?: string
  ) => {
    const button = document.createElement("button");
    button.className = "ibtn";
    button.title = label;
    button.setAttribute("aria-label", label);
    if (dataAction) button.dataset.action = dataAction;
    button.innerHTML = ICONS[icon];
    button.addEventListener(
      "click",
      guarded((e: MouseEvent) => {
        e.stopPropagation();
        onClick();
      })
    );
    return button;
  };

  const requireCommunity = (run: (communityId: string) => void) => () => {
    if (!selectedCommunityId) {
      toast("Create a community first — open the panel");
      return;
    }
    run(selectedCommunityId);
  };

  const chatEntries = await readChatEntries(username);
  const totalUnread = chatEntries.reduce((n, e) => n + e.unread, 0);

  const chatButton = iconButton(
    "chat",
    "Chats — communities & people",
    () => {
      chatMenuOpen = !chatMenuOpen;
      expanded = false;
      ensurePillRoot().querySelectorAll(".menu").forEach((el) => el.remove());
      if (chatMenuOpen) renderChatMenu(chatEntries);
    },
    "chat"
  );
  if (totalUnread > 0) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = totalUnread > 99 ? "99+" : String(totalUnread);
    chatButton.append(badge);
  }
  bar.append(chatButton);

  const divider = document.createElement("span");
  divider.className = "divider";
  bar.append(divider);

  bar.append(
    iconButton(
      "add",
      "Add this page to board",
      requireCommunity(async (communityId) => {
        const ok = await actionsRef?.addCurrentPage(communityId);
        toast(ok ? "Added to board" : "Couldn't add — is the server running?");
      })
    ),
    iconButton(
      "pin",
      "Pin a spot on this page",
      requireCommunity((communityId) => actionsRef?.enterPinMode(communityId))
    ),
    iconButton(
      "highlight",
      "Highlight text on this page",
      requireCommunity((communityId) =>
        actionsRef?.enterHighlightMode(communityId)
      )
    ),
    iconButton(
      "more",
      "More options",
      () => {
        expanded = !expanded;
        chatMenuOpen = false;
        void renderMenu(bar, communities);
      },
      "menu"
    )
  );

  root.append(bar);
  if (expanded) void renderMenu(bar, communities);
}

function renderChatMenu(entries: ChatEntry[]) {
  const root = ensurePillRoot();
  root.querySelectorAll(".menu").forEach((el) => el.remove());
  if (!chatMenuOpen) return;

  const menu = document.createElement("div");
  menu.className = "menu";

  const title = document.createElement("div");
  title.className = "title";
  title.textContent = "Chats";
  menu.append(title);

  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent =
      "No conversations yet — open the panel to connect with people or create a community.";
    menu.append(empty);
  }

  for (const entry of entries.slice(0, 8)) {
    const row = document.createElement("button");
    row.className = "chat-row";
    row.innerHTML = `
      <span class="tag">${entry.kind === "community" ? "grp" : "dm"}</span>
      <span class="grow">${entry.label.replace(/</g, "&lt;")}</span>
      ${entry.unread > 0 ? `<span class="count">${entry.unread > 99 ? "99+" : entry.unread}</span>` : ""}
    `;
    row.addEventListener(
      "click",
      guarded(async () => {
        chatMenuOpen = false;
        root.querySelectorAll(".menu").forEach((el) => el.remove());

        // Panel also honors this if opened later.
        await browser.storage.local.set({
          "tabcom:open-target": JSON.stringify({ kind: entry.kind, id: entry.id }),
        });

        // Open the floating Chat PiP directly on this conversation —
        // full chat without the panel.
        await browser.runtime.sendMessage({
          type: "tabcom:open-float",
          conversationId: entry.conversationId,
        });
      })
    );
    menu.append(row);
  }

  root.append(menu);
}

async function renderMenu(bar: HTMLElement, communities: PillCommunity[]) {
  const root = ensurePillRoot();
  root.querySelectorAll(".menu").forEach((el) => el.remove());
  if (!expanded) return;

  const menu = document.createElement("div");
  menu.className = "menu";

  const title = document.createElement("div");
  title.className = "title";
  title.textContent = "Tabcom";
  menu.append(title);

  if (communities.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent =
      "You're not in a community yet — open the panel and create one.";
    menu.append(empty);
  } else if (communities.length > 1) {
    const select = document.createElement("select");
    for (const community of communities) {
      const option = document.createElement("option");
      option.value = community.id;
      option.textContent = community.name;
      option.selected = community.id === selectedCommunityId;
      select.append(option);
    }
    select.addEventListener("change", () => {
      selectedCommunityId = select.value;
    });
    menu.append(select);
  }

  // Live cursors toggle
  const cursorsOn = await getCursorsEnabled();
  const cursorsRow = document.createElement("button");
  cursorsRow.className = "row";
  cursorsRow.innerHTML = `<span class="grow">Live cursors</span><span class="knob ${cursorsOn ? "on" : ""}"></span>`;
  cursorsRow.addEventListener(
    "click",
    guarded(async (e: MouseEvent) => {
      e.stopPropagation();
      const next = !(await getCursorsEnabled());
      await setCursorsEnabled(next);
      void renderMenu(bar, communities);
    })
  );
  menu.append(cursorsRow);

  const openRow = document.createElement("button");
  openRow.className = "row";
  openRow.innerHTML = `<span class="grow">Open Tabcom panel</span>`;
  openRow.addEventListener(
    "click",
    guarded(() => {
      actionsRef?.openPanel();
      expanded = false;
      void renderMenu(bar, communities);
    })
  );
  menu.append(openRow);

  const divider = document.createElement("div");
  divider.className = "divider";
  menu.append(divider);

  const hideRow = document.createElement("button");
  hideRow.className = "row danger";
  hideRow.innerHTML = `<span class="grow">Hide pill & go offline</span>`;
  hideRow.title = "Re-enable from Settings";
  hideRow.addEventListener(
    "click",
    guarded(async () => {
      await setPillEnabled(false);
      clearUI();
    })
  );
  menu.append(hideRow);

  root.append(menu);
}

function collapse() {
  expanded = false;
  ensurePillRoot().querySelectorAll(".menu").forEach((el) => el.remove());
}

// ---- public API ---------------------------------------------------------

/** Mount the pill. Call once from the content script's main(). */
let initialized = false;

export function initPagePill(actions: PillActions): void {
  actionsRef = actions;
  if (initialized) return;
  initialized = true;
  console.log(`[tabcom] page pill ${PILL_VERSION} initializing`);

  void render();

  // React live to the Settings toggle and to community changes synced
  // by the panel/background.
  onPillEnabledChange((enabled) => {
    if (!enabled) clearUI();
    else void render();
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (
      area === "local" &&
      ("tabcom:chat" in changes ||
        "tabcom:profile" in changes ||
        "tabcom:inbox-buffer" in changes)
    ) {
      void render();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && expanded) collapse();
  });
}

/** Let the host content script re-render (e.g. after community updates). */
export function refreshPagePill(): void {
  void render();
}
