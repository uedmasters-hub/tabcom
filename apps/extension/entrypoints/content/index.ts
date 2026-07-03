import { browser } from "wxt/browser";

import {
  addBoardHighlight,
  addBoardPin,
  disconnectRealtime,
  initRealtime,
  removeBoardPin,
  type WireCommunity,
} from "../../src/lib/realtime";
import { readPageAnchor } from "../../src/lib/anchor";
import { resolveTextQuote, serializeSelection } from "../../src/lib/text-quote";

/**
 * On-page annotation overlay.
 *
 * READ (passive, on every page load): looks up the page's canonical key
 * against communities already synced to local storage and renders any
 * existing pins/highlights. No network activity — this must be free for
 * every page a person browses.
 *
 * WRITE (only when the person actually pins/highlights something): opens
 * a short-lived socket scoped to this tab, submits, listens once for the
 * server's confirmation, writes it back to local storage so read-mode
 * stays fresh even if the side panel isn't open, then disconnects.
 */

interface StoredProfile {
  username: string;
  displayName: string;
  avatarColor: string;
  photo?: string;
}

interface StoredChatState {
  communities: Record<string, WireCommunity>;
}

const HIGHLIGHT_STYLE_ID = "tabcom-highlight-style";
const IDLE_DISCONNECT_MS = 4000;

let shadowHost: HTMLDivElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let activeMode: { kind: "pin" | "highlight"; communityId: string } | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

async function readStoredProfile(): Promise<StoredProfile | null> {
  const result = await browser.storage.local.get("tabcom:profile");
  const raw = result["tabcom:profile"] as string | undefined;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const state = parsed.state ?? parsed;
    if (!state?.username) return null;
    return {
      username: state.username,
      displayName: state.displayName,
      avatarColor: state.avatarColor,
      photo: state.photo,
    };
  } catch {
    return null;
  }
}

async function readStoredCommunities(): Promise<Record<string, WireCommunity>> {
  const result = await browser.storage.local.get("tabcom:chat");
  const raw = result["tabcom:chat"] as string | undefined;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    const state = (parsed.state ?? parsed) as StoredChatState;
    return state.communities ?? {};
  } catch {
    return {};
  }
}

async function writeStoredCommunity(community: WireCommunity): Promise<void> {
  const result = await browser.storage.local.get("tabcom:chat");
  const raw = result["tabcom:chat"] as string | undefined;
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    const state = parsed.state ?? parsed;
    state.communities = { ...state.communities, [community.id]: community };
    if (parsed.state) parsed.state = state;
    await browser.storage.local.set({
      "tabcom:chat": JSON.stringify(parsed.state ? parsed : state),
    });
  } catch {
    // best-effort cache write; panel resync will fix it if this fails
  }
}

function ensureShadowRoot(): ShadowRoot {
  if (shadowRoot) return shadowRoot;

  shadowHost = document.createElement("div");
  shadowHost.id = "tabcom-annotation-root";
  shadowHost.style.cssText = "all: initial;";
  document.documentElement.append(shadowHost);
  shadowRoot = shadowHost.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .layer { position: absolute; top: 0; left: 0; width: 100%; pointer-events: none; z-index: 2147483000; }
    .pin { position: absolute; transform: translate(-50%, -100%); pointer-events: auto; cursor: pointer; }
    .pin-dot { width: 28px; height: 28px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg);
      background: #2563EB; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,.25); }
    .pin-dot span { display: block; transform: rotate(45deg); width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center; color: white; font-size: 11px; font-weight: 700; }
    .popover { position: absolute; pointer-events: auto; background: white; border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,.18); padding: 10px 12px; width: 220px; font-size: 13px; color: #0F172A; }
    .popover .author { font-weight: 700; font-size: 11px; color: #2563EB; margin-bottom: 3px; }
    .popover .remove { margin-top: 6px; font-size: 11px; color: #DC2626; cursor: pointer; background: none; border: none; padding: 0; }
    .mode-bar { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); pointer-events: auto;
      background: #0F172A; color: white; padding: 8px 16px; border-radius: 999px; font-size: 12.5px;
      display: flex; align-items: center; gap: 10px; box-shadow: 0 6px 18px rgba(0,0,0,.25); z-index: 2147483001; }
    .mode-bar button { background: rgba(255,255,255,.15); border: none; color: white; border-radius: 999px;
      padding: 3px 10px; font-size: 11.5px; cursor: pointer; }
    .composer { position: fixed; pointer-events: auto; background: white; border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,.2); padding: 10px; width: 220px; z-index: 2147483001; }
    .composer input { width: 100%; border: 1px solid #E2E8F0; border-radius: 8px; padding: 6px 8px;
      font-size: 12.5px; outline: none; box-sizing: border-box; }
    .composer .row { display: flex; gap: 6px; margin-top: 6px; }
    .composer button { flex: 1; border: none; border-radius: 8px; padding: 6px 8px; font-size: 12px;
      font-weight: 600; cursor: pointer; }
    .composer .send { background: #0F172A; color: white; }
    .composer .cancel { background: #F1F5F9; color: #334155; }
    .highlight-btn { position: fixed; pointer-events: auto; background: #0F172A; color: white;
      border: none; border-radius: 999px; padding: 6px 12px; font-size: 12px; font-weight: 600;
      cursor: pointer; z-index: 2147483001; box-shadow: 0 6px 18px rgba(0,0,0,.25); }
  `;
  shadowRoot.append(style);

  const layer = document.createElement("div");
  layer.className = "layer";
  layer.id = "layer";
  shadowRoot.append(layer);

  return shadowRoot;
}

function layerEl(): HTMLDivElement {
  return ensureShadowRoot().getElementById("layer") as HTMLDivElement;
}

function documentHeight(): number {
  return Math.max(document.documentElement.scrollHeight, window.innerHeight);
}

function clearChildren(el: Element) {
  while (el.firstChild) el.firstChild.remove();
}

// ---- Read mode: render existing pins + highlights --------------------

async function renderExisting() {
  const [profile, communities] = await Promise.all([
    readStoredProfile(),
    readStoredCommunities(),
  ]);
  if (!profile) return;

  const anchor = readPageAnchor();
  const layer = layerEl();
  clearChildren(layer);
  layer.style.height = `${documentHeight()}px`;

  removeHighlightStyle();
  const ranges: Range[] = [];

  for (const community of Object.values(communities)) {
    const isMember = community.members.some((m) => m.username === profile.username);
    if (!isMember) continue;

    const item = community.board.find((i) => i.canonicalKey === anchor.canonicalKey);
    if (!item) continue;

    for (const pin of item.pins) {
      const marker = document.createElement("div");
      marker.className = "pin";
      marker.style.left = `${pin.xPercent}%`;
      marker.style.top = `${pin.yPercent}%`;
      marker.innerHTML = `<div class="pin-dot"><span>${pin.author.charAt(0).toUpperCase()}</span></div>`;

      marker.addEventListener("click", (event) => {
        event.stopPropagation();
        showPinPopover(marker, pin, community.id, item.id);
      });

      layer.append(marker);
    }

    for (const highlight of item.highlights) {
      const range = resolveTextQuote(highlight);
      if (range) ranges.push(range);
    }
  }

  if (ranges.length > 0 && "highlights" in CSS) {
    injectHighlightStyle();
    const HighlightCtor = (window as unknown as { Highlight: new (...r: Range[]) => unknown })
      .Highlight;
    const registry = (CSS as unknown as { highlights: Map<string, unknown> }).highlights;
    registry.set("tabcom-highlight", new HighlightCtor(...ranges));
  }
}

function injectHighlightStyle() {
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = `::highlight(tabcom-highlight) { background-color: rgba(37,99,235,0.28); }`;
  document.head.append(style);
}

function removeHighlightStyle() {
  const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
  registry?.delete("tabcom-highlight");
}

function showPinPopover(
  anchorEl: HTMLElement,
  pin: { id: string; author: string; text: string },
  communityId: string,
  itemId: string
) {
  const root = ensureShadowRoot();
  root.querySelectorAll(".popover").forEach((el) => el.remove());

  const rect = anchorEl.getBoundingClientRect();
  const popover = document.createElement("div");
  popover.className = "popover";
  popover.style.left = `${rect.left + window.scrollX}px`;
  popover.style.top = `${rect.bottom + window.scrollY + 6}px`;
  popover.innerHTML = `
    <div class="author">@${pin.author}</div>
    <div>${pin.text.replace(/</g, "&lt;")}</div>
    <button class="remove">Remove pin</button>
  `;
  popover.querySelector(".remove")?.addEventListener("click", async () => {
    await withWriteConnection(() => removeBoardPin(communityId, itemId, pin.id));
    popover.remove();
  });

  document.addEventListener("click", () => popover.remove(), { once: true });
  layerEl().append(popover);
}

// ---- Write path: short-lived on-demand socket -------------------------

let writeConnected = false;

async function withWriteConnection(action: () => void): Promise<void> {
  const profile = await readStoredProfile();
  if (!profile) return;

  if (!writeConnected) {
    initRealtime(
      {
        username: profile.username,
        name: profile.displayName,
        color: profile.avatarColor,
        visibility: "public",
        presence: "online",
        photo: profile.photo,
      },
      {
        onConnectionChange: (live) => {
          writeConnected = live;
        },
        onRoster: () => {},
        onDm: () => {},
        onTyping: () => {},
        onDmError: () => {},
        onConnections: () => {},
        onConnectRequest: () => {},
        onConnectUpdate: () => {},
        onCommunities: () => {},
        onCommunityUpdate: (community) => {
          void writeStoredCommunity(community);
          void renderExisting();
        },
        onCommunityInvite: () => {},
        onCommunityDeclined: () => {},
        onCommunityLeft: () => {},
        onCommunityMessage: () => {},
        onCommunityError: () => {},
      }
    );
    await new Promise((resolve) => setTimeout(resolve, 350)); // let the socket connect
  }

  action();
  scheduleIdleDisconnect();
}

function scheduleIdleDisconnect() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    disconnectRealtime();
    writeConnected = false;
  }, IDLE_DISCONNECT_MS);
}

// ---- Active modes: pin / highlight ------------------------------------

function exitMode() {
  activeMode = null;
  ensureShadowRoot()
    .querySelectorAll(".mode-bar, .composer, .highlight-btn")
    .forEach((el) => el.remove());
  document.removeEventListener("click", handlePinClick, true);
  document.removeEventListener("mouseup", handleSelectionChange);
}

function showModeBar(label: string) {
  const root = ensureShadowRoot();
  const bar = document.createElement("div");
  bar.className = "mode-bar";
  bar.innerHTML = `<span>${label}</span><button>Cancel</button>`;
  bar.querySelector("button")?.addEventListener("click", exitMode);
  root.append(bar);
}

function handlePinClick(event: MouseEvent) {
  if (!activeMode || activeMode.kind !== "pin") return;
  const target = event.target as HTMLElement;
  if (target.closest(".composer, .mode-bar, .pin, .popover")) return;

  event.preventDefault();
  event.stopPropagation();

  const xPercent = (event.pageX / document.documentElement.scrollWidth) * 100;
  const yPercent = (event.pageY / documentHeight()) * 100;

  showComposer(event.clientX, event.clientY, async (text) => {
    const anchor = readPageAnchor();
    await withWriteConnection(() =>
      addBoardPin({
        communityId: activeMode!.communityId,
        ...anchor,
        text,
        xPercent,
        yPercent,
      })
    );
    exitMode();
  });
}

function showComposer(clientX: number, clientY: number, onSubmit: (text: string) => void) {
  const root = ensureShadowRoot();
  root.querySelectorAll(".composer").forEach((el) => el.remove());

  const composer = document.createElement("div");
  composer.className = "composer";
  composer.style.left = `${Math.min(clientX, window.innerWidth - 236)}px`;
  composer.style.top = `${Math.min(clientY, window.innerHeight - 100)}px`;
  composer.innerHTML = `
    <input type="text" placeholder="Add a note…" autofocus />
    <div class="row">
      <button class="cancel">Cancel</button>
      <button class="send">Pin</button>
    </div>
  `;

  const input = composer.querySelector("input") as HTMLInputElement;
  const submit = () => {
    if (!input.value.trim()) return;
    onSubmit(input.value.trim());
    composer.remove();
  };

  composer.querySelector(".send")?.addEventListener("click", submit);
  composer.querySelector(".cancel")?.addEventListener("click", () => composer.remove());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") composer.remove();
  });

  root.append(composer);
  setTimeout(() => input.focus(), 0);
}

function handleSelectionChange() {
  if (!activeMode || activeMode.kind !== "highlight") return;

  const root = ensureShadowRoot();
  root.querySelectorAll(".highlight-btn").forEach((el) => el.remove());

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;

  const button = document.createElement("button");
  button.className = "highlight-btn";
  button.textContent = "✎ Highlight this";
  button.style.left = `${rect.left + rect.width / 2 - 60}px`;
  button.style.top = `${Math.max(8, rect.top - 38)}px`;

  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    const quoteSelector = serializeSelection();
    if (!quoteSelector) return;

    const anchor = readPageAnchor();
    await withWriteConnection(() =>
      addBoardHighlight({
        communityId: activeMode!.communityId,
        ...anchor,
        ...quoteSelector,
      })
    );
    button.remove();
    exitMode();
  });

  root.append(button);
}

// ---- Messages from the side panel --------------------------------------

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "tabcom:read-anchor") {
    try {
      sendResponse({ ok: true, anchor: readPageAnchor() });
    } catch (error) {
      sendResponse({ ok: false, error: String(error) });
    }
    return true;
  }

  if (message?.type === "tabcom:enter-pin-mode") {
    exitMode();
    activeMode = { kind: "pin", communityId: message.communityId };
    showModeBar("Click anywhere on the page to drop a pin");
    document.addEventListener("click", handlePinClick, true);
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "tabcom:enter-highlight-mode") {
    exitMode();
    activeMode = { kind: "highlight", communityId: message.communityId };
    showModeBar("Select any text to highlight it");
    document.addEventListener("mouseup", handleSelectionChange);
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "tabcom:exit-annotate-mode") {
    exitMode();
    sendResponse({ ok: true });
    return true;
  }

  return undefined;
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && activeMode) exitMode();
});

export default defineContentScript({
  matches: ["<all_urls>"],
  main() {
    if (document.readyState === "complete") void renderExisting();
    else window.addEventListener("load", () => void renderExisting());

    // Re-render on SPA navigations (Airbnb, Amazon are client-routed).
    let lastHref = window.location.href;
    setInterval(() => {
      if (window.location.href !== lastHref) {
        lastHref = window.location.href;
        void renderExisting();
      }
    }, 1000);
  },
});
