import { browser } from "wxt/browser";

import type { WireCommunity } from "../../src/lib/realtime";
import { readPageAnchor } from "../../src/lib/anchor";
import { resolveTextQuote } from "../../src/lib/text-quote";
import { anchorForPoint } from "../../src/lib/element-anchor";
import {
  getCursorsEnabled,
  onCursorsEnabledChange,
} from "../../src/lib/cursor-settings";

/**
 * On-page annotation overlay.
 *
 * READ (passive, on every page load): looks up the page's canonical key
 * against communities already synced to local storage and renders any
 * existing pins/areas/highlights. No network activity — this must be
 * free for every page a person browses.
 *
 * WRITE (only when the person actually annotates something): relays
 * through the background service worker's persistent connection (see
 * that file for why it's persistent, not on-demand) — writes there,
 * confirmation comes back via community_update, which updates storage
 * and re-renders every open tab, this one included.
 *
 * One unified "annotate" mode replaces separate pin/highlight modes:
 * a single click drops a pin, click-and-drag draws a rectangular area
 * annotation. Existing text-quote highlights (the older mechanism)
 * still render for backward compatibility but are no longer created
 * through this UI — areas are the general-purpose replacement, since
 * they work over any content, not just selectable text.
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

let shadowHost: HTMLDivElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let activeMode: { kind: "annotate"; communityId: string } | null = null;
let dragState: {
  startPageX: number;
  startPageY: number;
  startClientX: number;
  startClientY: number;
} | null = null;
const DRAG_THRESHOLD_PX = 6;

async function readStoredProfile(): Promise<StoredProfile | null> {
  try {
    const result = await browser.storage.local.get("tabcom:profile");
    const raw = result["tabcom:profile"] as string | undefined;
    if (!raw) return null;
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
  try {
    const result = await browser.storage.local.get("tabcom:chat");
    const raw = result["tabcom:chat"] as string | undefined;
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const state = (parsed.state ?? parsed) as StoredChatState;
    return state.communities ?? {};
  } catch {
    return {};
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
    .fixed-layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; }
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

    .drag-rect { position: fixed; pointer-events: none; z-index: 2147483001;
      border: 2px dashed #2563EB; background: rgba(37,99,235,.10); border-radius: 4px; }

    .area-box { position: fixed; pointer-events: auto; cursor: pointer;
      border: 2px solid #7C3AED; background: rgba(124,58,237,.08); border-radius: 6px;
      transition: background .15s ease; }
    .area-box:hover { background: rgba(124,58,237,.16); }
    .area-box .area-label { position: absolute; top: -22px; left: -2px; pointer-events: none;
      background: #7C3AED; color: white; font-size: 10px; font-weight: 700; padding: 2px 7px;
      border-radius: 999px 999px 999px 2px; white-space: nowrap; }

    @keyframes tabcom-pulse { 0%,100% { transform: rotate(-45deg) scale(1); }
      50% { transform: rotate(-45deg) scale(1.45); } }
    .pin.pulsing .pin-dot { animation: tabcom-pulse .7s ease 3; }

    .flash-box { position: fixed; pointer-events: none; z-index: 2147483001;
      border: 2.5px solid #2563EB; border-radius: 6px; background: rgba(37,99,235,.14);
      transition: opacity .5s ease; }

    .peer-cursor { position: absolute; pointer-events: none; z-index: 2147483001;
      transition: left .09s linear, top .09s linear; will-change: left, top; }
    .peer-cursor svg { display: block; filter: drop-shadow(0 1px 2px rgba(0,0,0,.3)); }
    .peer-cursor .plabel { margin: 2px 0 0 12px; padding: 2px 7px; border-radius: 999px;
      color: white; font-size: 10px; font-weight: 700; white-space: nowrap; width: fit-content; }
  `;
  shadowRoot.append(style);

  const layer = document.createElement("div");
  layer.className = "layer";
  layer.id = "layer";
  shadowRoot.append(layer);

  // Viewport-locked layer for pins/cursors: many sites (Flipkart, most
  // SPAs) scroll an INNER container, not the document — document-space
  // coordinates never move there and overlays look glued to the screen.
  // A fixed layer + live element rects works on every scroll model.
  const fixedLayer = document.createElement("div");
  fixedLayer.className = "fixed-layer";
  fixedLayer.id = "fixed-layer";
  shadowRoot.append(fixedLayer);

  return shadowRoot;
}

function layerEl(): HTMLDivElement {
  return ensureShadowRoot().getElementById("layer") as HTMLDivElement;
}

function fixedLayerEl(): HTMLDivElement {
  return ensureShadowRoot().getElementById("fixed-layer") as HTMLDivElement;
}

function documentHeight(): number {
  return Math.max(document.documentElement.scrollHeight, window.innerHeight);
}

function clearChildren(el: Element) {
  while (el.firstChild) el.firstChild.remove();
}

// ---- Read mode: render existing pins + highlights --------------------

let renderInFlight = false;
let renderQueued = false;

async function renderExisting(): Promise<void> {
  // Async render with await-points: two overlapping calls interleave as
  // clear/clear/append/append and duplicate every marker. Serialize —
  // one render at a time, with at most one queued rerun.
  if (renderInFlight) {
    renderQueued = true;
    return;
  }
  renderInFlight = true;
  try {
    await renderExistingInner();
  } finally {
    renderInFlight = false;
    if (renderQueued) {
      renderQueued = false;
      void renderExisting();
    }
  }
}

async function renderExistingInner() {
  const [profile, communities] = await Promise.all([
    readStoredProfile(),
    readStoredCommunities(),
  ]);
  if (!profile) {
    console.debug("[tabcom] renderExisting: no stored profile yet");
    return;
  }

  const anchor = readPageAnchor();
  console.debug(
    "[tabcom] renderExisting: canonicalKey =",
    anchor.canonicalKey,
    "communities known =",
    Object.keys(communities).length
  );
  const layer = layerEl();
  clearChildren(layer);
  layer.style.height = `${documentHeight()}px`;

  // Pins/popovers live in the fixed layer — clear stale ones on
  // re-render, but never touch live peer cursors.
  fixedLayerEl()
    .querySelectorAll(".pin, .area-box, .popover")
    .forEach((el) => el.remove());

  removeHighlightStyle();
  const ranges: Range[] = [];
  highlightRanges.clear();
  renderedPins.clear();
  renderedAreas.clear();
  ensureRepositionObserver();
  let boardScope: { communityId: string; canonicalKey: string } | null = null;

  for (const community of Object.values(communities)) {
    const isMember = community.members.some((m) => m.username === profile.username);
    if (!isMember) continue;

    const item = community.board.find((i) => i.canonicalKey === anchor.canonicalKey);
    if (!item) continue;
    console.debug(
      "[tabcom] found matching item in",
      community.name,
      "- pins:", (item.pins ?? []).length,
      "highlights:", (item.highlights ?? []).length
    );

    // This page is on a board — live cursors are in scope here.
    if (!boardScope) {
      boardScope = { communityId: community.id, canonicalKey: anchor.canonicalKey };
    }

    for (const pin of item.pins ?? []) {
      const marker = document.createElement("div");
      marker.className = "pin";
      marker.dataset.pinId = pin.id;
      renderedPins.set(pin.id, { marker, pin });
      positionPinMarker(marker, pin);
      marker.innerHTML = `<div class="pin-dot"><span>${pin.author.charAt(0).toUpperCase()}</span></div>`;

      marker.addEventListener("click", (event) => {
        event.stopPropagation();
        showPinPopover(marker, pin, community.id, item.id);
      });

      fixedLayerEl().append(marker);
    }

    for (const area of item.areas ?? []) {
      const box = document.createElement("div");
      box.className = "area-box";
      box.dataset.areaId = area.id;
      renderedAreas.set(area.id, { box, area });
      positionAreaBox(box, area);
      box.innerHTML = `<span class="area-label">@${area.author}</span>`;

      box.addEventListener("click", (event) => {
        event.stopPropagation();
        showAreaPopover(box, area, community.id, item.id);
      });

      fixedLayerEl().append(box);
    }

    for (const highlight of item.highlights ?? []) {
      const range = resolveTextQuote(highlight);
      if (range) {
        ranges.push(range);
        highlightRanges.set(highlight.id, range);
      }
    }
  }

  // Cursor sharing follows board scope: on when this page is on a board
  // the user's community tracks, off otherwise.
  void syncCursorScope(boardScope);

  // A navigation may be waiting for this page (panel click-through).
  void consumePendingNavigation(anchor.canonicalKey);

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
  popover.style.left = `${Math.min(rect.left, window.innerWidth - 236)}px`;
  popover.style.top = `${rect.bottom + 6}px`;
  popover.innerHTML = `
    <div class="author">@${pin.author}</div>
    <div>${pin.text.replace(/</g, "&lt;")}</div>
    <button class="remove">Remove pin</button>
  `;
  popover.querySelector(".remove")?.addEventListener("click", async () => {
    await boardWrite("pin_remove", { communityId, itemId, pinId: pin.id });
    popover.remove();
  });

  document.addEventListener("click", () => popover.remove(), { once: true });
  fixedLayerEl().append(popover);
}

function showAreaPopover(
  anchorEl: HTMLElement,
  area: { id: string; author: string; text: string },
  communityId: string,
  itemId: string
) {
  const root = ensureShadowRoot();
  root.querySelectorAll(".popover").forEach((el) => el.remove());

  const rect = anchorEl.getBoundingClientRect();
  const popover = document.createElement("div");
  popover.className = "popover";
  popover.style.left = `${Math.min(rect.left, window.innerWidth - 236)}px`;
  popover.style.top = `${rect.bottom + 6}px`;
  popover.innerHTML = `
    <div class="author">@${area.author}</div>
    <div>${area.text.replace(/</g, "&lt;")}</div>
    <button class="remove">Remove area</button>
  `;
  popover.querySelector(".remove")?.addEventListener("click", async () => {
    await boardWrite("area_remove", { communityId, itemId, areaId: area.id });
    popover.remove();
  });

  document.addEventListener("click", () => popover.remove(), { once: true });
  fixedLayerEl().append(popover);
}

// ---- Write path: relay to the background service worker ---------------
//
// Content scripts run inside a webpage's context and can be subject to
// that page's Content-Security-Policy, which could silently block a
// direct WebSocket connection on a strict site. The background service
// worker is an extension page, never subject to any website's CSP, and
// serves every tab from one connection — so writes are relayed there.

// ---- Orphan detection ------------------------------------------------
//
// Reloading the extension leaves content scripts already injected into
// open tabs running as zombies — every browser.* call throws "Extension
// context invalidated". This predates and is independent of the pill;
// the annotation overlay (pin/highlight/cursor writes below) needs it
// on its own.

function extensionAlive(): boolean {
  try {
    return !!browser.runtime?.id;
  } catch {
    return false;
  }
}

let refreshChipShown = false;

function showRefreshChip(): void {
  if (refreshChipShown) return;
  refreshChipShown = true;

  const chip = document.createElement("button");
  chip.textContent = "↻ Tabcom was updated — click to refresh this page";
  chip.style.cssText =
    "position:fixed;bottom:20px;right:20px;z-index:2147483647;" +
    "background:#D97706;color:#fff;border:none;border-radius:999px;" +
    "padding:10px 16px;font:600 12.5px -apple-system,sans-serif;" +
    "cursor:pointer;box-shadow:0 10px 30px rgba(120,53,15,.35);";
  chip.addEventListener("click", () => window.location.reload());
  document.documentElement.append(chip);
}

function orphanCheck(): boolean {
  if (extensionAlive()) return false;
  showRefreshChip();
  return true;
}

async function boardWrite(
  action:
    | "pin_add"
    | "pin_remove"
    | "area_add"
    | "area_remove"
    | "highlight_add"
    | "highlight_remove"
    | "item_add"
    | "dm_send"
    | "typing_send"
    | "community_message",
  payload: Record<string, unknown>
): Promise<boolean> {
  if (orphanCheck()) return false;
  try {
    const response = await browser.runtime.sendMessage({
      type: "tabcom:board-write",
      action,
      payload,
    });
    return !!response?.ok;
  } catch (error) {
    if (String(error).includes("context invalidated")) showRefreshChip();
    return false;
  }
}

// ---- Active modes: pin / highlight ------------------------------------

/**
 * Shadow DOM retargets event.target for listeners outside the shadow
 * tree — every click on our overlay reports the same generic host
 * element from document's perspective. composedPath() reveals the true
 * path through the shadow boundary, which is what these checks need.
 */
function eventTouchesOwnUI(event: Event): boolean {
  return event
    .composedPath()
    .some(
      (node) =>
        node instanceof Element &&
        (node.classList?.contains("composer") ||
          node.classList?.contains("mode-bar") ||
          node.classList?.contains("pin") ||
          node.classList?.contains("popover") ||
          node.classList?.contains("area-box") ||
          node.classList?.contains("highlight-btn"))
    );
}

function exitMode() {
  activeMode = null;
  dragState = null;
  ensureShadowRoot()
    .querySelectorAll(".mode-bar, .composer, .highlight-btn, .drag-rect")
    .forEach((el) => el.remove());
  document.removeEventListener("mousedown", handleAnnotateMouseDown, true);
  document.removeEventListener("mousemove", handleAnnotateMouseMove, true);
  document.removeEventListener("mouseup", handleAnnotateMouseUp, true);
  document.removeEventListener("dragstart", suppressNativeDrag, true);
}

function showModeBar(label: string) {
  const root = ensureShadowRoot();
  const bar = document.createElement("div");
  bar.className = "mode-bar";
  bar.innerHTML = `<span>${label}</span><button>Cancel</button>`;
  bar.querySelector("button")?.addEventListener("click", exitMode);
  root.append(bar);
}

function createPinAt(pageX: number, pageY: number, clientX: number, clientY: number) {
  console.debug("[tabcom] dropping pin at", pageX, pageY);

  const pageWidth = Math.max(document.documentElement.scrollWidth, 1);
  const xPercent = Math.min(100, (pageX / pageWidth) * 100) || 0;
  const yPercent = Math.min(100, (pageY / documentHeight()) * 100) || 0;

  // Element anchor captured at click time — the pin sticks to this
  // element even as lazy-loading reshapes everything around it.
  const elementAnchor = anchorForPoint(clientX, clientY);

  showComposer(clientX, clientY, async (text) => {
    const anchor = readPageAnchor();
    const ok = await boardWrite("pin_add", {
      communityId: activeMode!.communityId,
      ...anchor,
      text,
      xPercent,
      yPercent,
      pageX,
      pageY,
      anchorSelector: elementAnchor?.selector,
      elXPercent: elementAnchor?.elXPercent,
      elYPercent: elementAnchor?.elYPercent,
    });
    console.debug("[tabcom] pin_add result:", ok, "anchored:", !!elementAnchor);
    exitMode();
  });
}

function createAreaAt(
  startPageX: number,
  startPageY: number,
  endPageX: number,
  endPageY: number,
  startClientX: number,
  startClientY: number
) {
  const left = Math.min(startPageX, endPageX);
  const top = Math.min(startPageY, endPageY);
  const width = Math.abs(endPageX - startPageX);
  const height = Math.abs(endPageY - startPageY);

  const pageWidth = Math.max(document.documentElement.scrollWidth, 1);
  const pageHeight = documentHeight();
  const xPercent = Math.min(100, (left / pageWidth) * 100) || 0;
  const yPercent = Math.min(100, (top / pageHeight) * 100) || 0;
  const widthPercent = Math.min(100, (width / pageWidth) * 100) || 0.5;
  const heightPercent = Math.min(100, (height / pageHeight) * 100) || 0.5;

  // Anchor to the element under the START corner — same reasoning as
  // pins, keeps the box attached to content rather than a raw coordinate.
  const elementAnchor = anchorForPoint(startClientX, startClientY);

  console.debug("[tabcom] drawing area", { xPercent, yPercent, widthPercent, heightPercent });

  showComposer(startClientX, startClientY, async (text) => {
    const anchor = readPageAnchor();
    const ok = await boardWrite("area_add", {
      communityId: activeMode!.communityId,
      ...anchor,
      text,
      xPercent,
      yPercent,
      widthPercent,
      heightPercent,
      pageX: left,
      pageY: top,
      pageWidth: width,
      pageHeight: height,
      anchorSelector: elementAnchor?.selector,
      elXPercent: elementAnchor?.elXPercent,
      elYPercent: elementAnchor?.elYPercent,
    });
    console.debug("[tabcom] area_add result:", ok, "anchored:", !!elementAnchor);
    exitMode();
  });
}

/**
 * Single click -> pin. Click and drag past a small threshold -> a
 * rectangular area selection, Figma-comment style. One entry point
 * instead of separate pin/highlight modes — the gesture itself decides
 * which annotation type gets created, nothing to pick beforehand.
 */
function handleAnnotateMouseDown(event: MouseEvent) {
  if (!activeMode || activeMode.kind !== "annotate") return;
  if (eventTouchesOwnUI(event)) return;
  if (event.button !== 0) return; // left button only — right-click/middle-click pass through

  event.preventDefault();
  event.stopPropagation();

  dragState = {
    startPageX: event.pageX,
    startPageY: event.pageY,
    startClientX: event.clientX,
    startClientY: event.clientY,
  };

  document.addEventListener("mousemove", handleAnnotateMouseMove, true);
  document.addEventListener("mouseup", handleAnnotateMouseUp, true);
}

function handleAnnotateMouseMove(event: MouseEvent) {
  if (!dragState) return;

  const dx = Math.abs(event.clientX - dragState.startClientX);
  const dy = Math.abs(event.clientY - dragState.startClientY);
  if (dx < DRAG_THRESHOLD_PX && dy < DRAG_THRESHOLD_PX) return; // still within click tolerance

  updateDragRectangle(
    dragState.startClientX,
    dragState.startClientY,
    event.clientX,
    event.clientY
  );
}

function handleAnnotateMouseUp(event: MouseEvent) {
  if (!dragState) return;
  const start = dragState;
  dragState = null;

  document.removeEventListener("mousemove", handleAnnotateMouseMove, true);
  document.removeEventListener("mouseup", handleAnnotateMouseUp, true);
  removeDragRectangle();

  const dx = Math.abs(event.clientX - start.startClientX);
  const dy = Math.abs(event.clientY - start.startClientY);

  if (dx < DRAG_THRESHOLD_PX && dy < DRAG_THRESHOLD_PX) {
    createPinAt(start.startPageX, start.startPageY, start.startClientX, start.startClientY);
  } else {
    createAreaAt(
      start.startPageX,
      start.startPageY,
      event.pageX,
      event.pageY,
      start.startClientX,
      start.startClientY
    );
  }
}

function updateDragRectangle(x1: number, y1: number, x2: number, y2: number) {
  const root = ensureShadowRoot();
  let rect = root.querySelector(".drag-rect") as HTMLDivElement | null;
  if (!rect) {
    rect = document.createElement("div");
    rect.className = "drag-rect";
    root.append(rect);
  }
  rect.style.left = `${Math.min(x1, x2)}px`;
  rect.style.top = `${Math.min(y1, y2)}px`;
  rect.style.width = `${Math.abs(x2 - x1)}px`;
  rect.style.height = `${Math.abs(y2 - y1)}px`;
}

function removeDragRectangle() {
  ensureShadowRoot()
    .querySelectorAll(".drag-rect")
    .forEach((el) => el.remove());
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

  // KEYBOARD ISOLATION: host pages (Airbnb galleries, video players)
  // listen for Space/arrow shortcuts at the document level. Typing in
  // this composer must never reach them — otherwise Space triggers the
  // site's shortcut, focus gets stolen, and the pin is lost.
  for (const type of ["keydown", "keyup", "keypress"] as const) {
    composer.addEventListener(type, (e) => e.stopPropagation());
  }
  composer.addEventListener("mousedown", (e) => e.stopPropagation());

  // If the site steals focus anyway, take it back while composing.
  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (composer.isConnected) input.focus();
    }, 0);
  });

  root.append(composer);
  setTimeout(() => input.focus(), 0);
}

/**
 * <img> and <a> elements are draggable by default in every browser —
 * mousedown+move over one starts a NATIVE drag operation instead of
 * firing mousemove/mouseup at all, which is a completely different
 * event sequence (dragstart/drag/dragend) our handlers never see.
 * Without this, area selection silently fails on any image-heavy page
 * (which is most of them) while a plain click elsewhere still works
 * fine — exactly the "pins work, areas don't" symptom this fixes.
 */
function suppressNativeDrag(event: DragEvent) {
  if (!activeMode || activeMode.kind !== "annotate") return;
  event.preventDefault();
}

function enterAnnotateMode(communityId: string) {
  exitMode();
  activeMode = { kind: "annotate", communityId };
  showModeBar("Click to pin, or click and drag to select an area");
  document.addEventListener("mousedown", handleAnnotateMouseDown, true);
  document.addEventListener("dragstart", suppressNativeDrag, true);
}

// ---- Pin positioning: element-anchored, self-correcting ------------------
//
// A pin anchored to a page-percent floats away as lazy-loading reshapes
// the document. Pins therefore position from their ELEMENT anchor when
// it resolves (falling back to page-percent), and reposition whenever
// the document resizes — the pin sticks to the content it was placed on.

interface PinLike {
  xPercent: number;
  yPercent: number;
  pageX?: number;
  pageY?: number;
  anchorSelector?: string;
  elXPercent?: number;
  elYPercent?: number;
}

interface AreaLike {
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  pageX?: number;
  pageY?: number;
  pageWidth?: number;
  pageHeight?: number;
  anchorSelector?: string;
  elXPercent?: number;
  elYPercent?: number;
}

const renderedPins = new Map<string, { marker: HTMLElement; pin: PinLike }>();
const renderedAreas = new Map<string, { box: HTMLElement; area: AreaLike }>();
let repositionObserver: ResizeObserver | null = null;

/** Viewport position from an element anchor's LIVE on-screen rect —
 *  correct under document scrolling AND inner-container scrolling. */
function anchorViewportPoint(pin: {
  anchorSelector?: string;
  elXPercent?: number;
  elYPercent?: number;
}): { x: number; y: number } | null {
  if (!pin.anchorSelector || pin.elXPercent == null || pin.elYPercent == null) {
    return null;
  }
  let element: Element | null = null;
  try {
    element = document.querySelector(pin.anchorSelector);
  } catch {
    return null;
  }
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  return {
    x: rect.left + (rect.width * pin.elXPercent) / 100,
    y: rect.top + (rect.height * pin.elYPercent) / 100,
  };
}

function positionPinMarker(marker: HTMLElement, pin: PinLike) {
  const point = anchorViewportPoint(pin);
  if (point) {
    marker.style.left = `${point.x}px`;
    marker.style.top = `${point.y}px`;
    marker.style.display = "";
    return;
  }
  if (pin.pageX != null && pin.pageY != null) {
    // Absolute document-pixel fallback: immune to the page's total
    // height/width changing later (infinite scroll, lazy-loaded
    // content appended below) since this was captured once, at
    // creation, and doesn't get reinterpreted against a moving target.
    marker.style.left = `${pin.pageX - window.scrollX}px`;
    marker.style.top = `${pin.pageY - window.scrollY}px`;
    return;
  }
  // Legacy percentage fallback, for pins created before pageX/pageY
  // existed. Drifts as the page's total dimensions change over time —
  // correct at creation, best-effort after significant page growth.
  marker.style.left = `${(pin.xPercent / 100) * Math.max(document.documentElement.scrollWidth, 1) - window.scrollX}px`;
  marker.style.top = `${(pin.yPercent / 100) * documentHeight() - window.scrollY}px`;
}

/** Top-left corner anchors the same way a pin does (element anchor,
 *  falling back to page-percent); width/height stay page-percent-based
 *  always, since a dragged rectangle can span multiple elements and has
 *  no single element to size itself against. */
function positionAreaBox(box: HTMLElement, area: AreaLike) {
  const pageWidth = Math.max(document.documentElement.scrollWidth, 1);
  const pageHeight = documentHeight();

  // Size: prefer the absolute pixel dimensions captured at creation —
  // same drift reasoning as position below. Percentage-based size
  // additionally has its own subtler issue: even if position stayed
  // correct, a percentage width recalculated against a since-changed
  // pageWidth would stretch or shrink the box from its original shape.
  const width = area.pageWidth ?? (area.widthPercent / 100) * pageWidth;
  const height = area.pageHeight ?? (area.heightPercent / 100) * pageHeight;

  const point = anchorViewportPoint(area);
  if (point) {
    box.style.left = `${point.x}px`;
    box.style.top = `${point.y}px`;
  } else if (area.pageX != null && area.pageY != null) {
    // Absolute document-pixel fallback: immune to the page's total
    // height/width changing later (infinite scroll, lazy-loaded
    // content appended below) since this was captured once, at
    // creation, and doesn't get reinterpreted against a moving target.
    box.style.left = `${area.pageX - window.scrollX}px`;
    box.style.top = `${area.pageY - window.scrollY}px`;
  } else {
    // Legacy percentage fallback, for areas created before pageX/pageY
    // existed. Drifts as the page's total dimensions change over time.
    box.style.left = `${(area.xPercent / 100) * pageWidth - window.scrollX}px`;
    box.style.top = `${(area.yPercent / 100) * pageHeight - window.scrollY}px`;
  }
  box.style.width = `${width}px`;
  box.style.height = `${height}px`;
}

function repositionAllPins() {
  for (const { marker, pin } of renderedPins.values()) {
    positionPinMarker(marker, pin);
  }
  for (const { box, area } of renderedAreas.values()) {
    positionAreaBox(box, area);
  }
  repositionAllCursors();
}

let repositionScheduled = false;
function scheduleReposition() {
  if (repositionScheduled) return;
  repositionScheduled = true;
  requestAnimationFrame(() => {
    repositionScheduled = false;
    repositionAllPins();
  });
}

function ensureRepositionObserver() {
  if (repositionObserver) return;
  if (typeof ResizeObserver !== "undefined") {
    repositionObserver = new ResizeObserver(scheduleReposition);
    repositionObserver.observe(document.body);
  } else {
    repositionObserver = { disconnect() {} } as ResizeObserver;
  }
  // capture:true sees scrolls of INNER containers, not just the window —
  // this is what keeps overlays tracking on Flipkart-style pages.
  window.addEventListener("scroll", scheduleReposition, {
    capture: true,
    passive: true,
  });
  window.addEventListener("resize", scheduleReposition);
}

// ---- Click-to-anchor navigation ----------------------------------------

const highlightRanges = new Map<string, Range>();

function pulsePin(pinId: string) {
  const entry = [...renderedPins.entries()].find(([id]) => id === pinId)?.[1];
  const marker = fixedLayerEl().querySelector(
    `[data-pin-id="${pinId}"]`
  ) as HTMLElement | null;
  if (!marker) return false;

  // Scroll the anchored ELEMENT into view (works with inner scrollers);
  // fall back to document scroll from the legacy percent.
  let element: Element | null = null;
  if (entry?.pin.anchorSelector) {
    try {
      element = document.querySelector(entry.pin.anchorSelector);
    } catch {
      element = null;
    }
  }
  if (element) {
    element.scrollIntoView({ behavior: "smooth", block: "center" });
  } else if (entry) {
    window.scrollTo({
      top:
        entry.pin.pageY != null
          ? entry.pin.pageY - window.innerHeight / 2
          : (entry.pin.yPercent / 100) * documentHeight() - window.innerHeight / 2,
      behavior: "smooth",
    });
  }

  marker.classList.add("pulsing");
  setTimeout(() => marker.classList.remove("pulsing"), 2400);
  return true;
}

function pulseArea(areaId: string): boolean {
  const entry = renderedAreas.get(areaId);
  const box = fixedLayerEl().querySelector(
    `[data-area-id="${areaId}"]`
  ) as HTMLElement | null;
  if (!box || !entry) return false;

  let element: Element | null = null;
  if (entry.area.anchorSelector) {
    try {
      element = document.querySelector(entry.area.anchorSelector);
    } catch {
      element = null;
    }
  }
  if (element) {
    element.scrollIntoView({ behavior: "smooth", block: "center" });
  } else {
    window.scrollTo({
      top:
        entry.area.pageY != null
          ? entry.area.pageY - window.innerHeight / 2
          : (entry.area.yPercent / 100) * documentHeight() - window.innerHeight / 2,
      behavior: "smooth",
    });
  }

  // area-box has no built-in pulse keyframe (it's a differently-shaped
  // element than a pin marker) — a brief box-shadow flash reads clearly
  // enough without needing a dedicated animation.
  const originalShadow = box.style.boxShadow;
  box.style.boxShadow = "0 0 0 4px rgba(124,58,237,.35)";
  setTimeout(() => {
    box.style.boxShadow = originalShadow;
  }, 900);
  return true;
}

function flashHighlight(highlightId: string) {
  const range = highlightRanges.get(highlightId);
  if (!range) return false;

  // Scroll the highlighted node into view (handles inner scrollers).
  const node =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  node?.scrollIntoView({ behavior: "smooth", block: "center" });

  // Flash after the scroll settles, at the range's LIVE viewport rect.
  setTimeout(() => {
    const rect = range.getBoundingClientRect();
    const box = document.createElement("div");
    box.className = "flash-box";
    box.style.left = `${rect.left - 4}px`;
    box.style.top = `${rect.top - 4}px`;
    box.style.width = `${rect.width + 8}px`;
    box.style.height = `${rect.height + 8}px`;
    fixedLayerEl().append(box);
    setTimeout(() => (box.style.opacity = "0"), 1800);
    setTimeout(() => box.remove(), 2400);
  }, 500);
  return true;
}

function performNavigation(target: { kind: "pin" | "highlight" | "area"; id: string }) {
  const attempt = () => {
    try {
      if (target.kind === "pin") return pulsePin(target.id);
      if (target.kind === "area") return pulseArea(target.id);
      return flashHighlight(target.id);
    } catch {
      return false; // never let a hostile/odd page break navigation
    }
  };
  if (!attempt()) {
    // Annotations render after load; retry once they likely exist.
    setTimeout(attempt, 1200);
  }
}

/** The panel stores a pending target before opening/focusing the tab. */
async function consumePendingNavigation(canonicalKey: string) {
  try {
    const result = await browser.storage.local.get("tabcom:pending-nav");
    const raw = result["tabcom:pending-nav"] as string | undefined;
    if (!raw) return;
    const pending = JSON.parse(raw);
    if (pending.canonicalKey !== canonicalKey) return;
    if (Date.now() - pending.ts > 60_000) return;
    await browser.storage.local.remove("tabcom:pending-nav");
    performNavigation(pending);
  } catch {
    // ignore
  }
}

// ---- Live peer cursors (only on pages that are on a board) --------------

interface PeerPayload {
  xPercent: number;
  yPercent: number;
  anchorSelector?: string;
  elXPercent?: number;
  elYPercent?: number;
}

const peerCursors = new Map<
  string,
  {
    el: HTMLDivElement;
    expireTimer: ReturnType<typeof setTimeout>;
    last: PeerPayload;
  }
>();

function positionCursor(el: HTMLElement, payload: PeerPayload) {
  const point = anchorViewportPoint(payload);
  if (point) {
    el.style.left = `${point.x}px`;
    el.style.top = `${point.y}px`;
    return;
  }
  el.style.left = `${(payload.xPercent / 100) * Math.max(document.documentElement.scrollWidth, 1) - window.scrollX}px`;
  el.style.top = `${(payload.yPercent / 100) * documentHeight() - window.scrollY}px`;
}

function repositionAllCursors() {
  for (const entry of peerCursors.values()) {
    positionCursor(entry.el, entry.last);
  }
}
let cursorScope: { communityId: string; canonicalKey: string } | null = null;
let lastCursorSent = 0;

async function syncCursorScope(
  next: { communityId: string; canonicalKey: string } | null
) {
  const same =
    (!next && !cursorScope) ||
    (next &&
      cursorScope &&
      next.communityId === cursorScope.communityId &&
      next.canonicalKey === cursorScope.canonicalKey);
  if (same) return;

  if (cursorScope) {
    document.removeEventListener("mousemove", handleCursorMove);
    void browser.runtime.sendMessage({ type: "tabcom:cursor-stop" }).catch(() => {});
    for (const [username, entry] of peerCursors) {
      clearTimeout(entry.expireTimer);
      entry.el.remove();
      peerCursors.delete(username);
    }
  }

  cursorScope = next;
  if (!next) return;

  // Respect the pill-menu toggle: cursors can be turned off entirely.
  if (!(await getCursorsEnabled())) {
    cursorScope = null;
    return;
  }

  const response = await browser.runtime
    .sendMessage({
      type: "tabcom:cursor-start",
      communityId: next.communityId,
      canonicalKey: next.canonicalKey,
    })
    .catch(() => ({ ok: false }));

  if (response?.ok) {
    document.addEventListener("mousemove", handleCursorMove);
    console.debug("[tabcom] live cursors ON for", next.canonicalKey);
  } else {
    cursorScope = null;
  }
}

function handleCursorMove(event: MouseEvent) {
  const now = Date.now();
  if (now - lastCursorSent < 90) return; // ~11 updates/sec max
  lastCursorSent = now;

  if (orphanCheck()) {
    document.removeEventListener("mousemove", handleCursorMove);
    return;
  }

  // Content-anchored: the receiver positions this cursor on the SAME
  // element in THEIR page, not at the same raw coordinates — so "I'm
  // looking at section 4" reads as section 4 on every screen, no
  // matter how differently the pages have loaded.
  const elementAnchor = anchorForPoint(event.clientX, event.clientY);

  browser.runtime
    .sendMessage({
      type: "tabcom:cursor-move",
      xPercent:
        Math.min(100, (event.pageX / Math.max(document.documentElement.scrollWidth, 1)) * 100) || 0,
      yPercent: Math.min(100, (event.pageY / documentHeight()) * 100) || 0,
      anchorSelector: elementAnchor?.selector,
      elXPercent: elementAnchor?.elXPercent,
      elYPercent: elementAnchor?.elYPercent,
    })
    .catch(() => {});
}

function upsertPeerCursor(peer: {
  from: { username: string; name: string; color: string };
  xPercent: number;
  yPercent: number;
  anchorSelector?: string;
  elXPercent?: number;
  elYPercent?: number;
}) {
  let entry = peerCursors.get(peer.from.username);

  if (!entry) {
    const el = document.createElement("div");
    el.className = "peer-cursor";
    el.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16">
        <path d="M2 1 L14 8 L8.5 9.5 L6 15 Z" fill="${peer.from.color}" stroke="white" stroke-width="1.2"/>
      </svg>
      <div class="plabel" style="background:${peer.from.color}">${peer.from.name.replace(/</g, "&lt;")}</div>
    `;
    fixedLayerEl().append(el);
    entry = {
      el,
      expireTimer: setTimeout(() => {}, 0),
      last: peer,
    };
    peerCursors.set(peer.from.username, entry);
  }

  entry.last = peer;
  positionCursor(entry.el, peer);

  clearTimeout(entry.expireTimer);
  entry.expireTimer = setTimeout(() => removePeerCursor(peer.from.username), 4000);
}

function removePeerCursor(username: string) {
  const entry = peerCursors.get(username);
  if (!entry) return;
  clearTimeout(entry.expireTimer);
  entry.el.remove();
  peerCursors.delete(username);
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

  if (message?.type === "tabcom:enter-annotate-mode") {
    enterAnnotateMode(message.communityId);
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "tabcom:exit-annotate-mode") {
    exitMode();
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "tabcom:community-updated") {
    void renderExisting();
    return undefined;
  }

  if (message?.type === "tabcom:navigate-to") {
    performNavigation(message);
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "tabcom:cursor-peer") {
    upsertPeerCursor(message.peer);
    return undefined;
  }

  if (message?.type === "tabcom:cursor-peer-leave") {
    removePeerCursor(message.from);
    return undefined;
  }

  return undefined;
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && activeMode) exitMode();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") void syncCursorScope(null);
  else void renderExisting(); // re-detect scope + re-render
});

export default defineContentScript({
  matches: ["<all_urls>"],
  main() {
    onCursorsEnabledChange((enabled) => {
      if (!enabled) void syncCursorScope(null);
      else void renderExisting(); // re-arm scope detection
    });

    const boot = () => {
      void renderExisting();
    };
    if (document.readyState === "complete") boot();
    else window.addEventListener("load", boot);

    // Re-render on SPA navigations (Airbnb, Amazon are client-routed).
    let lastHref = window.location.href;
    const spaPoll = setInterval(() => {
      if (!extensionAlive()) {
        clearInterval(spaPoll);
        showRefreshChip();
        return;
      }
      if (window.location.href !== lastHref) {
        lastHref = window.location.href;
        void renderExisting();
      }
    }, 1000);
  },
});
