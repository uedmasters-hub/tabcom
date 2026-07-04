import { browser } from "wxt/browser";

import {
  getPillEnabled,
  onPillEnabledChange,
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

export const PILL_VERSION = "M14";

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

let host: HTMLDivElement | null = null;
let shadow: ShadowRoot | null = null;
let expanded = false;
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

// ---- shadow scaffolding -------------------------------------------------

const STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }

  .fab { position: fixed; bottom: 20px; right: 20px; z-index: 2147483600;
    display: flex; align-items: center; gap: 8px;
    background: #0F172A; color: #fff; border: none; cursor: pointer;
    border-radius: 999px; padding: 9px 16px 9px 10px;
    font-size: 13px; font-weight: 700; letter-spacing: .01em;
    box-shadow: 0 10px 30px rgba(2,6,23,.35);
    transition: transform .15s ease, box-shadow .15s ease; }
  .fab:hover { transform: translateY(-1px); box-shadow: 0 14px 36px rgba(2,6,23,.4); }
  .fab .dot { width: 22px; height: 22px; border-radius: 50%;
    background: linear-gradient(135deg, #2563EB, #7C3AED);
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 800; }

  .menu { position: fixed; bottom: 66px; right: 20px; z-index: 2147483600;
    width: 248px; background: #fff; color: #0F172A;
    border-radius: 16px; box-shadow: 0 18px 50px rgba(2,6,23,.28);
    padding: 10px; }
  .menu .head { display: flex; align-items: center; justify-content: space-between;
    padding: 2px 4px 8px; }
  .menu .title { font-size: 11px; font-weight: 800; text-transform: uppercase;
    letter-spacing: .05em; color: #64748B; }
  .menu select { width: 100%; border: 1px solid #E2E8F0; border-radius: 10px;
    padding: 8px; font-size: 12.5px; background: #fff; color: #0F172A;
    margin-bottom: 8px; }
  .menu .action { display: flex; align-items: center; gap: 9px; width: 100%;
    border: none; background: none; text-align: left; cursor: pointer;
    padding: 9px 8px; border-radius: 10px; font-size: 13px; font-weight: 600;
    color: #0F172A; }
  .menu .action:hover { background: #F1F5F9; }
  .menu .action .ic { width: 20px; text-align: center; }
  .menu .divider { height: 1px; background: #F1F5F9; margin: 6px 2px; }
  .menu .hide { color: #64748B; font-weight: 500; font-size: 12px; }
  .menu .hide:hover { color: #DC2626; background: #FEF2F2; }
  .menu .empty { padding: 10px 8px; font-size: 12.5px; color: #64748B; line-height: 1.5; }
  .toast { position: fixed; bottom: 66px; right: 20px; z-index: 2147483600;
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
  shadow?.querySelectorAll(".fab, .menu, .toast").forEach((el) => el.remove());
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

  const fab = document.createElement("button");
  fab.className = "fab";
  fab.title = `Tabcom pill ${PILL_VERSION}`;
  fab.innerHTML = `<span class="dot">T</span><span>Tabcom</span>`;
  fab.addEventListener("click", () => {
    expanded = !expanded;
    void render();
  });
  root.append(fab);

  if (!expanded) return;

  const menu = document.createElement("div");
  menu.className = "menu";

  const head = document.createElement("div");
  head.className = "head";
  head.innerHTML = `<span class="title">Tabcom</span>`;
  menu.append(head);

  if (communities.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent =
      "You're not in a community yet. Open the panel and create one to pin, highlight, and share pages with your people.";
    menu.append(empty);
    menu.append(
      actionButton("💬", "Open Tabcom panel", () => {
        actionsRef?.openPanel();
        collapse();
      })
    );
  } else {
    if (communities.length > 1) {
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

    menu.append(
      actionButton("💬", "Open chat", () => {
        actionsRef?.openPanel();
        collapse();
      }),
      actionButton("➕", "Add this page to board", async () => {
        if (!selectedCommunityId) return;
        collapse();
        const ok = await actionsRef?.addCurrentPage(selectedCommunityId);
        toast(ok ? "Added to board" : "Couldn't add — is the server running?");
      }),
      actionButton("📍", "Pin a spot on this page", () => {
        collapse();
        if (selectedCommunityId) actionsRef?.enterPinMode(selectedCommunityId);
      }),
      actionButton("✎", "Highlight text on this page", () => {
        collapse();
        if (selectedCommunityId)
          actionsRef?.enterHighlightMode(selectedCommunityId);
      })
    );
  }

  const divider = document.createElement("div");
  divider.className = "divider";
  menu.append(divider);

  menu.append(
    actionButton(
      "✕",
      "Hide pill (re-enable in Settings)",
      async () => {
        await setPillEnabled(false);
        clearUI();
      },
      "hide"
    )
  );

  root.append(menu);
}

function actionButton(
  icon: string,
  label: string,
  onClick: () => void,
  extraClass = ""
): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = `action ${extraClass}`.trim();
  button.innerHTML = `<span class="ic">${icon}</span><span>${label}</span>`;
  button.addEventListener("click", onClick);
  return button;
}

function collapse() {
  expanded = false;
  void render();
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
    if (area === "local" && ("tabcom:chat" in changes || "tabcom:profile" in changes)) {
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
