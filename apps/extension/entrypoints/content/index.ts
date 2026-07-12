import { browser } from "wxt/browser";

import type { AnnotationPeer, WireCommunity } from "../../src/lib/realtime";
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

/** Bumped with every content-script change. Logged on load and returned
 *  by the ping handler, so "which version is actually running in this
 *  tab" is a one-glance check instead of a guessing game. */
const CONTENT_SCRIPT_VERSION = "7";

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

// ---- Quick annotations ("/" bubble): ephemeral speech bubbles + the
// @-prefixed shortcut into a persistent pin. See buildQuickAnnotations
// section below for the full flow. ---------------------------------------

/** Mirrors cursorScope but tracked independently — quick-annotation
 *  availability depends only on "is this page on a board", never on the
 *  unrelated live-cursors preference toggle. Set in renderExistingInner
 *  alongside boardScope. */
let annotationScope: { communityId: string; canonicalKey: string } | null = null;

/** Updated on every mousemove so "/" can open the bubble beside wherever
 *  the cursor actually is, without needing a click first. */
let lastMouseClientX = 0;
let lastMouseClientY = 0;

const QUICK_ANNOTATION_MAX_LENGTH = 50;
const EPHEMERAL_DISSOLVE_MS = 4000;
const EPHEMERAL_ANIMATION_MS = 180;

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
    .pin.pin-pending { pointer-events: none; }
    .pin.pin-pending .pin-dot { background: #64748B; animation: tabcom-pin-pulse 1.1s ease-in-out infinite; }
    @keyframes tabcom-pin-pulse { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
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

    /* Full-viewport interaction layer, mounted for the whole annotate
       session. All pointer events for pin/area creation happen HERE,
       never on the page — so a site's own capture-phase handlers,
       draggable images, and focus-stealing scripts can't break the
       tool, and the crosshair cursor stays visible no matter how many
       annotations get created. Sits just BELOW the fixed layer so
       existing pins/areas (pointer-events: auto) stay clickable. */
    .capture-layer { position: fixed; inset: 0; pointer-events: auto;
      z-index: 2147482999; cursor: crosshair; touch-action: none;
      background: transparent; }

    .save-toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
      pointer-events: none; z-index: 2147483002; background: #DC2626; color: white;
      padding: 9px 16px; border-radius: 999px; font-size: 12.5px; font-weight: 600;
      box-shadow: 0 10px 30px rgba(127,29,29,.35); opacity: 0; transition: opacity .2s ease; }
    .save-toast.in { opacity: 1; }
    .save-toast.pending { background: #0F172A; box-shadow: 0 10px 30px rgba(15,23,42,.35); }

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

    /* Quick annotation bubble — the "/" composer. Single-line by
       construction (a plain <input>), positioned beside the cursor,
       never centered/modal. */
    .quick-bubble { position: fixed; pointer-events: auto; background: white; border-radius: 14px;
      box-shadow: 0 10px 28px rgba(0,0,0,.22); padding: 8px; width: 240px; z-index: 2147483002;
      opacity: 0; transform: scale(.94); transition: opacity .16s ease, transform .16s ease; }
    .quick-bubble.in { opacity: 1; transform: scale(1); }
    .quick-bubble .row { display: flex; align-items: center; gap: 6px; }
    .quick-bubble input { flex: 1; min-width: 0; border: none; outline: none; font-size: 13px;
      padding: 4px 2px; color: #0F172A; background: transparent; }
    .quick-bubble .counter { font-size: 10px; color: #94A3B8; font-variant-numeric: tabular-nums;
      flex-shrink: 0; transition: color .15s ease; }
    .quick-bubble .counter.limit { color: #DC2626; font-weight: 700; }
    .quick-bubble .hint { margin-top: 5px; font-size: 10.5px; color: #94A3B8; line-height: 14px; }
    .quick-bubble .hint b { color: #64748B; }

    /* Ephemeral speech bubble — never stored, dissolves on its own.
       Distinct visual language from persistent pins (rounded speech-
       bubble tail vs. the teardrop pin shape) so the two are never
       confused at a glance. */
    .speech-bubble { position: fixed; pointer-events: none; z-index: 2147483001;
      display: flex; flex-direction: column; align-items: flex-start; gap: 3px;
      opacity: 0; transform: scale(.9) translateY(3px);
      transition: opacity .18s ease, transform .18s ease; }
    .speech-bubble.in { opacity: 1; transform: scale(1) translateY(0); }
    .speech-bubble.out { opacity: 0; transform: scale(.92) translateY(-2px); }
    .speech-bubble .author { font-size: 10px; font-weight: 700; padding: 1px 8px;
      border-radius: 999px; color: white; white-space: nowrap; }
    .speech-bubble .bubble { position: relative; background: #0F172A; color: white; font-size: 12.5px;
      font-weight: 500; padding: 7px 12px; border-radius: 14px 14px 14px 3px;
      max-width: 260px; word-break: break-word; box-shadow: 0 6px 16px rgba(0,0,0,.22); }

    @media (prefers-reduced-motion: reduce) {
      .quick-bubble, .speech-bubble { transition: opacity .01ms !important; transform: none !important; }
    }
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

// ---- Popover positioning: follows its anchor pin/area on scroll/resize --
//
// A popover opened at click-time used to freeze at that viewport
// position — as the page scrolled, the pin/area marker (which DOES
// reposition every frame) moved out from under it, leaving the comment
// visually detached from its pin. Tracking the currently-open popover
// alongside its anchor element and re-measuring on every reposition pass
// keeps the two glued together, the same way peer cursors and pins
// already stay glued to the viewport.

let openPopover: { el: HTMLDivElement; anchorEl: HTMLElement } | null = null;

function positionPopover(popover: HTMLDivElement, anchorEl: HTMLElement) {
  const rect = anchorEl.getBoundingClientRect();
  popover.style.left = `${Math.min(rect.left, window.innerWidth - 236)}px`;
  popover.style.top = `${rect.bottom + 6}px`;
}

function closeOpenPopover() {
  if (!openPopover) return;
  openPopover.el.remove();
  openPopover = null;
}

function repositionOpenPopover() {
  if (!openPopover) return;
  // The anchored pin/area was removed from the DOM (e.g. a re-render
  // beat us to it) — nothing sensible left to follow.
  if (!openPopover.anchorEl.isConnected) {
    closeOpenPopover();
    return;
  }
  positionPopover(openPopover.el, openPopover.anchorEl);
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
  openPopover = null;

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
      "areas:", (item.areas ?? []).length,
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

  // Quick annotations follow the SAME board scope, but registered
  // unconditionally — unlike cursors, this isn't gated by a preference
  // toggle, so it's a separate call rather than piggybacking on the one
  // above (which the cursors-enabled toggle can force back to null).
  void syncAnnotationScope(boardScope);

  // A navigation may be waiting for this page (panel click-through).
  void consumePendingNavigation(anchor.canonicalKey);

  if (ranges.length > 0 && "highlights" in CSS) {
    injectHighlightStyle();
    const HighlightCtor = (window as unknown as { Highlight: new (...r: Range[]) => unknown })
      .Highlight;
    const registry = (CSS as unknown as { highlights: Map<string, unknown> }).highlights;
    registry.set("tabcom-highlight", new HighlightCtor(...ranges));
  }

  // Re-draw anything still optimistically pending — the wipe above just
  // cleared its DOM node along with everything else, but the write it
  // represents may still be in flight (this render pass could have been
  // triggered by someone ELSE'S unrelated community update, not by this
  // pin's own write settling).
  renderPendingPins();
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

  const popover = document.createElement("div");
  popover.className = "popover";
  positionPopover(popover, anchorEl);
  popover.innerHTML = `
    <div class="author">@${pin.author}</div>
    <div>${pin.text.replace(/</g, "&lt;")}</div>
    <button class="remove">Remove pin</button>
  `;
  popover.querySelector(".remove")?.addEventListener("click", async () => {
    await boardWrite("pin_remove", { communityId, itemId, pinId: pin.id });
    closeOpenPopover();
  });

  document.addEventListener("click", () => closeOpenPopover(), { once: true });
  fixedLayerEl().append(popover);
  openPopover = { el: popover, anchorEl };
}

function showAreaPopover(
  anchorEl: HTMLElement,
  area: { id: string; author: string; text: string },
  communityId: string,
  itemId: string
) {
  const root = ensureShadowRoot();
  root.querySelectorAll(".popover").forEach((el) => el.remove());

  const popover = document.createElement("div");
  popover.className = "popover";
  positionPopover(popover, anchorEl);
  popover.innerHTML = `
    <div class="author">@${area.author}</div>
    <div>${area.text.replace(/</g, "&lt;")}</div>
    <button class="remove">Remove area</button>
  `;
  popover.querySelector(".remove")?.addEventListener("click", async () => {
    await boardWrite("area_remove", { communityId, itemId, areaId: area.id });
    closeOpenPopover();
  });

  document.addEventListener("click", () => closeOpenPopover(), { once: true });
  fixedLayerEl().append(popover);
  openPopover = { el: popover, anchorEl };
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

/**
 * Minimal, permanently-docked indicator — deliberately NOT a toast that
 * appears/vanishes/reappears. Sits quietly at low opacity until
 * hovered (full opacity + a small tooltip), same idea as an OS tray
 * icon: always available, never demanding attention until you look
 * at it. Click reloads the page.
 *
 * Injected directly onto the raw page (not the shadow-root UI
 * everything else in this file uses) on purpose — this specifically
 * fires when the extension context may be degraded, so it can't
 * depend on any of that infrastructure still working. Every style is
 * inline and self-contained; no external stylesheet, no shared class
 * names that a host page's CSS could accidentally clobber.
 */
function showRefreshChip(): void {
  if (refreshChipShown) return;
  refreshChipShown = true;

  const dot = document.createElement("button");
  dot.setAttribute("aria-label", "Tabcom was updated — click to refresh this page");
  dot.style.cssText =
    "all:initial;position:fixed;bottom:20px;right:20px;z-index:2147483647;" +
    "width:32px;height:32px;border-radius:50%;box-sizing:border-box;" +
    "background:rgba(15,23,42,.55);border:1px solid rgba(255,255,255,.25);" +
    "display:flex;align-items:center;justify-content:center;" +
    "cursor:pointer;opacity:.55;transition:opacity .15s ease;" +
    "font-family:-apple-system,BlinkMacSystemFont,sans-serif;";

  const icon = document.createElement("span");
  icon.textContent = "↻";
  icon.style.cssText = "font-size:15px;line-height:1;color:#fff;pointer-events:none;";
  dot.append(icon);

  // Small always-on badge — the one persistent signal that something
  // needs attention, without any text at all.
  const badge = document.createElement("span");
  badge.style.cssText =
    "position:absolute;top:-2px;right:-2px;width:8px;height:8px;" +
    "border-radius:50%;background:#F59E0B;border:1.5px solid rgba(15,23,42,.9);" +
    "pointer-events:none;";
  dot.append(badge);

  const tooltip = document.createElement("span");
  tooltip.textContent = "Update ready — refresh";
  tooltip.style.cssText =
    "position:absolute;top:50%;right:calc(100% + 8px);transform:translateY(-50%);" +
    "background:#0F172A;color:#fff;padding:6px 10px;border-radius:8px;" +
    "font-size:12px;font-weight:600;white-space:nowrap;" +
    "opacity:0;pointer-events:none;transition:opacity .15s ease;" +
    "box-shadow:0 10px 30px rgba(0,0,0,.35);";
  dot.append(tooltip);

  dot.addEventListener("mouseenter", () => {
    dot.style.opacity = "1";
    tooltip.style.opacity = "1";
  });
  dot.addEventListener("mouseleave", () => {
    dot.style.opacity = ".55";
    tooltip.style.opacity = "0";
  });

  dot.addEventListener("click", () => window.location.reload());
  document.documentElement.append(dot);
}

function orphanCheck(): boolean {
  if (extensionAlive()) return false;
  showRefreshChip();
  return true;
}

/** Populated when a board write fails, so call-site error toasts can
 *  say WHICH server was unreachable — instantly distinguishing "built
 *  with the localhost fallback" from "production server is down". */
let lastWriteFailureTarget: string | null = null;

function failureHost(): string {
  if (!lastWriteFailureTarget) return "Tabcom server";
  try {
    return new URL(lastWriteFailureTarget).host;
  } catch {
    return lastWriteFailureTarget;
  }
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

  // The background now WAITS OUT server cold starts (up to ~45s for a
  // sleeping Render instance) instead of failing fast — much better
  // odds of the write landing, but the person needs to know why
  // nothing has happened yet. Neutral toast after a short beat.
  const pendingTimer = setTimeout(() => {
    showSaveToast("Connecting to Tabcom server — waking it up…", "pending");
  }, 1500);

  try {
    const response = await browser.runtime.sendMessage({
      type: "tabcom:board-write",
      action,
      payload,
    });
    lastWriteFailureTarget =
      response?.ok ? null : ((response?.target as string | undefined) ?? null);
    return !!response?.ok;
  } catch (error) {
    if (String(error).includes("context invalidated")) showRefreshChip();
    return false;
  } finally {
    clearTimeout(pendingTimer);
    removePendingToast();
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
  removeDragRectangle();
  unmountCaptureLayer();
  ensureShadowRoot()
    .querySelectorAll(".mode-bar, .composer, .highlight-btn, .drag-rect")
    .forEach((el) => el.remove());
}

function showModeBar(label: string) {
  const root = ensureShadowRoot();
  const bar = document.createElement("div");
  bar.className = "mode-bar";
  bar.innerHTML = `<span>${label}</span><button>Done</button>`;
  bar.querySelector("button")?.addEventListener("click", exitMode);
  root.append(bar);
}

// ---- Annotate-mode capture layer -----------------------------------------
//
// Why an overlay instead of document-level listeners: pages can defeat
// document listeners in several independent ways — capture-phase
// handlers registered earlier calling stopImmediatePropagation, native
// image/link drags swallowing the mousemove/mouseup sequence, focus
// stealing, aggressive event delegation. Any one of those makes the
// tool work "sometimes" and die mid-session. With a full-viewport
// element in OUR shadow root receiving the pointer events, the page
// never sees them at all — nothing it does can interfere. Pointer
// capture (setPointerCapture) additionally guarantees move/up arrive
// even if the pointer leaves the layer mid-drag.

let captureLayerEl: HTMLDivElement | null = null;

function mountCaptureLayer() {
  if (captureLayerEl) return;
  const root = ensureShadowRoot();
  const layer = document.createElement("div");
  layer.className = "capture-layer";
  layer.addEventListener("pointerdown", handleCapturePointerDown);
  layer.addEventListener("pointermove", handleCapturePointerMove);
  layer.addEventListener("pointerup", handleCapturePointerUp);
  layer.addEventListener("pointercancel", handleCapturePointerCancel);
  // passive:false — we preventDefault only when forwarding to an inner
  // scroller, otherwise the browser's default (document scroll) runs.
  layer.addEventListener("wheel", handleCaptureWheel, { passive: false });
  root.append(layer);
  captureLayerEl = layer;
}

/**
 * The overlay covers the viewport, so the browser's default wheel
 * action scrolls the DOCUMENT — correct for most pages, wrong on sites
 * that scroll an inner container (the same inner-scroller model the
 * reposition observer already handles). Find the real scrollable under
 * the pointer and forward the delta to it; fall through to the default
 * document scroll when there isn't one.
 */
function handleCaptureWheel(event: WheelEvent) {
  const target = withOverlayTransparent(() =>
    document.elementFromPoint(event.clientX, event.clientY)
  );
  let node: Element | null = target;
  while (node && node !== document.body && node !== document.documentElement) {
    if (node instanceof HTMLElement) {
      const style = getComputedStyle(node);
      const scrollableY =
        /(auto|scroll|overlay)/.test(style.overflowY) &&
        node.scrollHeight > node.clientHeight + 1;
      const scrollableX =
        /(auto|scroll|overlay)/.test(style.overflowX) &&
        node.scrollWidth > node.clientWidth + 1;
      if (scrollableY || scrollableX) {
        event.preventDefault();
        node.scrollBy({ left: event.deltaX, top: event.deltaY });
        return;
      }
    }
    node = node.parentElement;
  }
  // No inner scroller under the pointer — let the default action
  // scroll the document as usual.
}

function unmountCaptureLayer() {
  captureLayerEl?.remove();
  captureLayerEl = null;
}

/** Run fn with the capture layer hit-test-transparent, so
 *  document.elementFromPoint (inside anchorForPoint) reaches the real
 *  page content underneath instead of our overlay's shadow host. */
function withOverlayTransparent<T>(fn: () => T): T {
  if (!captureLayerEl) return fn();
  const previous = captureLayerEl.style.pointerEvents;
  captureLayerEl.style.pointerEvents = "none";
  try {
    return fn();
  } finally {
    captureLayerEl.style.pointerEvents = previous || "";
  }
}

function handleCapturePointerDown(event: PointerEvent) {
  if (!activeMode || activeMode.kind !== "annotate") return;
  if (event.button !== 0) return; // left button / primary touch only

  event.preventDefault();

  // If a composer is open, this click just dismisses it — starting a
  // brand-new annotation on the same click would silently discard
  // whatever was typed there.
  const openComposer = ensureShadowRoot().querySelector(".composer");
  if (openComposer) {
    openComposer.remove();
    return;
  }

  try {
    captureLayerEl?.setPointerCapture(event.pointerId);
  } catch {
    // capture is best-effort; the handlers still work without it
  }

  dragState = {
    startPageX: event.pageX,
    startPageY: event.pageY,
    startClientX: event.clientX,
    startClientY: event.clientY,
  };
}

function handleCapturePointerMove(event: PointerEvent) {
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

function handleCapturePointerUp(event: PointerEvent) {
  if (!dragState) return;
  const start = dragState;
  dragState = null;
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

function handleCapturePointerCancel() {
  dragState = null;
  removeDragRectangle();
}

/** A write that fails (server unreachable, misconfigured realtime URL,
 *  offline) used to fail SILENTLY — the composer closed and the pin
 *  just never existed, which reads as "annotations are broken" with no
 *  clue why. Surface it. The "pending" variant is the neutral
 *  "connecting…" state shown while the background waits out a server
 *  cold start; error toasts replace it. */
function showSaveToast(text: string, kind: "error" | "pending" = "error") {
  const root = ensureShadowRoot();
  root.querySelectorAll(".save-toast").forEach((el) => el.remove());
  const toast = document.createElement("div");
  toast.className = kind === "pending" ? "save-toast pending" : "save-toast";
  toast.textContent = text;
  root.append(toast);
  requestAnimationFrame(() => toast.classList.add("in"));
  if (kind === "error") {
    setTimeout(() => {
      toast.classList.remove("in");
      setTimeout(() => toast.remove(), 250);
    }, 5000);
  }
}

function removePendingToast() {
  ensureShadowRoot()
    .querySelectorAll(".save-toast.pending")
    .forEach((el) => el.remove());
}

function createPinAt(pageX: number, pageY: number, clientX: number, clientY: number) {
  console.debug("[tabcom] dropping pin at", pageX, pageY);

  const pageWidth = Math.max(document.documentElement.scrollWidth, 1);
  const xPercent = Math.min(100, (pageX / pageWidth) * 100) || 0;
  const yPercent = Math.min(100, (pageY / documentHeight()) * 100) || 0;

  // Element anchor captured at click time — the pin sticks to this
  // element even as lazy-loading reshapes everything around it. The
  // overlay must be hit-test-transparent for this to see the page.
  const elementAnchor = withOverlayTransparent(() => anchorForPoint(clientX, clientY));

  showComposer(clientX, clientY, async (text) => {
    const anchor = readPageAnchor();
    const pendingId = `pending-${Date.now()}-${++pendingPinSeq}`;
    pendingPins.set(pendingId, {
      text,
      xPercent,
      yPercent,
      pageX,
      pageY,
      anchorSelector: elementAnchor?.selector,
      elXPercent: elementAnchor?.elXPercent,
      elYPercent: elementAnchor?.elYPercent,
    });
    renderPendingPins(); // visible immediately — never wait on the round trip

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

    pendingPins.delete(pendingId);
    if (ok) {
      // The real, confirmed pin should already be in storage by now (the
      // server's ack and its community_update broadcast travel over the
      // same connection, effectively back to back) — pull it in now
      // rather than waiting for that broadcast's own round trip back
      // through the background script, so the swap from "pending" to
      // "confirmed" is immediate rather than one more network hop away.
      void renderExisting();
    } else {
      renderedPins.get(pendingId)?.marker.remove();
      renderedPins.delete(pendingId);
      showSaveToast(`Pin not saved — can't reach ${failureHost()}`);
    }
    // Deliberately NOT exiting annotate mode here — the tool stays live
    // so the person can drop as many pins/areas as they want in one
    // sitting. Mode only ends on explicit Cancel/Escape.
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
  const elementAnchor = withOverlayTransparent(() =>
    anchorForPoint(startClientX, startClientY)
  );

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
    if (!ok) showSaveToast(`Area not saved — can't reach ${failureHost()}`);
    // Same reasoning as createPinAt — stay in annotate mode so multiple
    // areas/pins can be created back to back without re-arming the tool.
  });
}

/**
 * Single click -> pin. Click and drag past a small threshold -> a
 * rectangular area selection, Figma-comment style. One entry point
 * instead of separate pin/highlight modes — the gesture itself decides
 * which annotation type gets created, nothing to pick beforehand.
 * The gesture handlers live on the capture layer (see mountCaptureLayer
 * above) rather than on document.
 */
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

function enterAnnotateMode(communityId: string) {
  exitMode();
  activeMode = { kind: "annotate", communityId };
  // The capture layer IS the annotate cursor: mounted once for the whole
  // session, it shows the crosshair and receives every gesture until
  // Done/Esc. Creating pins or areas never touches it — the cursor's
  // lifecycle is fully separate from annotation creation. Native image
  // drags can't occur either, since the page never receives pointerdown.
  mountCaptureLayer();
  showModeBar("Click to pin · drag to select an area");
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

// ---- Optimistic pin state --------------------------------------------
//
// A pin write can legitimately take up to ~45s (a Render cold start) to
// resolve. Waiting for that round trip before showing ANYTHING made the
// tool feel broken even when it was working correctly — the person
// clicks, types, hits enter, and nothing happens for the better part of
// a minute. This map holds pins optimistically, drawn the instant the
// composer submits, independent of renderExistingInner's normal
// authoritative loop (which only knows about pins the server has
// already confirmed). Survives across re-renders (unlike renderedPins,
// which gets wiped and rebuilt every pass) so a pending pin doesn't
// vanish if an unrelated community update triggers a refresh while this
// write is still in flight. Cleared the moment the write settles either
// way: on success the next authoritative render supersedes it with the
// real, confirmed pin; on failure it just disappears, alongside the
// existing red toast explaining why.
interface PendingPin extends PinLike {
  text: string;
}
const pendingPins = new Map<string, PendingPin>();
let pendingPinSeq = 0;

function renderPendingPins() {
  for (const [id, pending] of pendingPins) {
    if (renderedPins.has(id)) continue; // already drawn this pass
    const marker = document.createElement("div");
    marker.className = "pin pin-pending";
    marker.dataset.pinId = id;
    marker.title = `Saving: ${pending.text}`;
    marker.innerHTML = `<div class="pin-dot"><span>…</span></div>`;
    positionPinMarker(marker, pending);
    fixedLayerEl().append(marker);
    renderedPins.set(id, { marker, pin: pending });
  }
}

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
  repositionOpenPopover();
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

// Annotations render asynchronously (storage read + DOM query), and on
// a heavy or slow-settling page the target element may not resolve on
// the very first try. A short burst of retries with increasing delay
// covers that window without the multi-second dead air a single fixed
// retry left when it also missed.
const NAVIGATION_RETRY_DELAYS_MS = [150, 400, 900, 1600, 3000];

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

  if (attempt()) return;

  let i = 0;
  const retry = () => {
    if (attempt()) return;
    if (i >= NAVIGATION_RETRY_DELAYS_MS.length) return; // gave it a real shot; stop
    setTimeout(retry, NAVIGATION_RETRY_DELAYS_MS[i]);
    i += 1;
  };
  setTimeout(retry, NAVIGATION_RETRY_DELAYS_MS[i]);
  i += 1;
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
let cursorHeartbeatTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Registers this tab's cursor scope with the background script. This is
 * NOT gated on the connection being up yet — cursorTabs.set() happens
 * in the background on receipt regardless of socket state, and outgoing
 * cursor-move sends are already fire-and-forget (background silently
 * drops them until writeConnected flips true). Requiring a live
 * connection here just to attach the local mousemove listener was the
 * actual bug: a Render cold start (up to ~50s) made cursor-start's
 * short wait time out, which then disabled the LOCAL cursor for the
 * rest of that page load with no retry — nothing about the eventual
 * successful connection ever re-enabled it. Now the listener always
 * attaches; the connection catching up later "just works" because
 * writeConnected is checked live on every send, not cached from here.
 */
async function registerCursorScope(scope: { communityId: string; canonicalKey: string }) {
  const response = await browser.runtime
    .sendMessage({
      type: "tabcom:cursor-start",
      communityId: scope.communityId,
      canonicalKey: scope.canonicalKey,
    })
    .catch(() => ({ ok: false }));
  console.debug(
    "[tabcom] cursor-start ->",
    response?.ok ? "server connected" : "server not connected yet (will retry)"
  );
}

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
    if (cursorHeartbeatTimer) {
      clearInterval(cursorHeartbeatTimer);
      cursorHeartbeatTimer = null;
    }
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

  document.addEventListener("mousemove", handleCursorMove);
  console.debug("[tabcom] live cursors ON for", next.canonicalKey);
  void registerCursorScope(next);

  // MV3 can suspend the background service worker independently of
  // anything on this page; a suspend+wake cycle wipes its in-memory
  // cursorTabs map, silently un-registering this tab until something
  // re-sends cursor-start. Re-affirming periodically means a session
  // that started before a SW restart keeps working through it with no
  // reload — "active for the entire duration of the shared session"
  // without relying on a revisit to trigger recovery.
  cursorHeartbeatTimer = setInterval(() => {
    if (cursorScope) void registerCursorScope(cursorScope);
  }, 20_000);
}

/**
 * Same idea as syncCursorScope, but unconditional — no preference
 * toggle gates whether a page qualifies for quick annotations, only
 * whether it's actually on a board. Registers/clears this tab's scope
 * with the background script so incoming annotation_peer broadcasts
 * get relayed here.
 */
async function syncAnnotationScope(
  next: { communityId: string; canonicalKey: string } | null
) {
  const same =
    (!next && !annotationScope) ||
    (next &&
      annotationScope &&
      next.communityId === annotationScope.communityId &&
      next.canonicalKey === annotationScope.canonicalKey);
  if (same) return;

  annotationScope = next;

  if (next) {
    ensureMouseTracker();
  } else {
    closeQuickBubble();
    if (lastMouseTrackerAttached) {
      document.removeEventListener("mousemove", trackMousePosition);
      lastMouseTrackerAttached = false;
    }
  }

  await browser.runtime
    .sendMessage({ type: "tabcom:annotation-scope", scope: next })
    .catch(() => {});
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
  // matter how differently the pages have loaded. Overlay-transparent
  // so anchoring keeps working while annotate mode is active.
  const elementAnchor = withOverlayTransparent(() =>
    anchorForPoint(event.clientX, event.clientY)
  );

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

// ---- Quick annotations: the "/" bubble ---------------------------------
//
// Two outcomes from one input, decided by the first character:
//   "Looks good"        -> ephemeral speech bubble, broadcast, never stored
//   "@todo Fix spacing" -> persistent pin, reuses the exact same pin_add
//                          path the click-to-pin composer already uses
//
// Deliberately NOT a rich editor: a plain <input> is single-line by
// construction, so there is no multiline state to guard against beyond
// stripping the rare injected newline (IME edge cases). Paste/cut/drop
// are disabled to keep this a quick note, not a text-dump destination.

const RICH_EDITOR_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable]",
  "[contenteditable='true']",
  ".monaco-editor",
  ".CodeMirror",
  ".cm-editor",
  ".ace_editor",
  ".ProseMirror",
  "[data-slate-editor='true']",
  ".tiptap",
  ".ql-editor",
  "[role='textbox']",
  "[role='searchbox']",
  "[role='combobox']",
].join(", ");

/**
 * Whether the CURRENT focus should keep "/" (or any single-key
 * shortcut) working normally. Two checks: is the focused element
 * itself (or an ancestor, for editors that focus an inner node) an
 * editable/rich-text surface, and separately, is focus captured inside
 * an open dialog/modal at all (even a non-input control there shouldn't
 * lose its keystrokes to this feature).
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(RICH_EDITOR_SELECTOR)) return true;
  if (target.closest("dialog[open], [role='dialog'], [aria-modal='true']")) return true;
  return false;
}

let lastMouseTrackerAttached = false;
function trackMousePosition(event: MouseEvent) {
  lastMouseClientX = event.clientX;
  lastMouseClientY = event.clientY;
}

function ensureMouseTracker() {
  if (lastMouseTrackerAttached) return;
  lastMouseTrackerAttached = true;
  document.addEventListener("mousemove", trackMousePosition, { passive: true });
}

/** Parses raw bubble input into either an ephemeral note or a
 *  persistent annotation. "@" is a pure trigger — it (and any leading
 *  whitespace after it) is stripped before the text is ever stored or
 *  displayed, so it never shows up in the saved comment. */
function parseQuickAnnotation(
  raw: string
): { kind: "ephemeral"; text: string } | { kind: "persistent"; text: string } {
  const trimmed = raw.trim();
  if (trimmed.startsWith("@")) {
    const rest = trimmed.slice(1).trim();
    if (rest) return { kind: "persistent", text: rest };
  }
  return { kind: "ephemeral", text: trimmed };
}

let quickBubbleEl: HTMLDivElement | null = null;

function closeQuickBubble() {
  if (!quickBubbleEl) return;
  quickBubbleEl.remove();
  quickBubbleEl = null;
}

function openQuickBubble(
  clientX: number,
  clientY: number,
  forcedKind?: "ephemeral" | "persistent"
) {
  if (quickBubbleEl) return; // only one at a time
  if (!annotationScope) return;

  const root = ensureShadowRoot();
  const scope = annotationScope; // captured — a mid-composition page nav shouldn't repoint this

  const bubble = document.createElement("div");
  bubble.className = "quick-bubble";
  bubble.setAttribute("role", "dialog");
  bubble.setAttribute(
    "aria-label",
    forcedKind === "persistent" ? "Pinned note" : "Quick annotation"
  );
  bubble.style.left = `${Math.min(clientX, window.innerWidth - 256)}px`;
  bubble.style.top = `${Math.min(clientY, window.innerHeight - 90)}px`;
  bubble.innerHTML =
    forcedKind === "persistent"
      ? `
    <div class="row">
      <input type="text" placeholder="Add a pinned note…" maxlength="${QUICK_ANNOTATION_MAX_LENGTH}" autofocus aria-label="Pinned note text, 50 characters maximum" />
      <span class="counter" aria-hidden="true">0/${QUICK_ANNOTATION_MAX_LENGTH}</span>
    </div>
    <div class="hint">Enter pins this here for good</div>
  `
      : `
    <div class="row">
      <input type="text" placeholder="Quick note or @todo…" maxlength="${QUICK_ANNOTATION_MAX_LENGTH}" autofocus aria-label="Annotation text, 50 characters maximum" />
      <span class="counter" aria-hidden="true">0/${QUICK_ANNOTATION_MAX_LENGTH}</span>
    </div>
    <div class="hint"><b>@name</b> pins it here for good · everything else just floats by</div>
  `;

  const input = bubble.querySelector("input") as HTMLInputElement;
  const counter = bubble.querySelector(".counter") as HTMLSpanElement;

  const updateCounter = () => {
    const len = input.value.length;
    counter.textContent = `${len}/${QUICK_ANNOTATION_MAX_LENGTH}`;
    counter.classList.toggle("limit", len >= QUICK_ANNOTATION_MAX_LENGTH);
  };

  const submit = () => {
    const value = input.value.trim();
    closeQuickBubble();
    if (!value) return;

    if (forcedKind === "persistent") {
      // "@" opened this bubble directly in note mode — the trigger
      // character was never typed into the field, so whatever the
      // person types IS the comment, verbatim.
      void createPersistentQuickAnnotation(value, clientX, clientY, scope);
      return;
    }

    const parsed = parseQuickAnnotation(value);
    if (parsed.kind === "ephemeral") {
      void sendEphemeralAnnotation(parsed.text, clientX, clientY, scope);
    } else {
      void createPersistentQuickAnnotation(parsed.text, clientX, clientY, scope);
    }
  };

  input.addEventListener("input", () => {
    // Belt-and-suspenders beyond the maxlength attribute (spec: "stop
    // accepting additional characters, preserve cursor position") and a
    // guard against a stray newline from an IME composing across Enter.
    if (input.value.includes("\n")) {
      const pos = input.selectionStart ?? input.value.length;
      input.value = input.value.replace(/\n/g, " ");
      input.setSelectionRange(pos, pos);
    }
    if (input.value.length > QUICK_ANNOTATION_MAX_LENGTH) {
      input.value = input.value.slice(0, QUICK_ANNOTATION_MAX_LENGTH);
    }
    updateCounter();
  });

  // Enter and Shift+Enter are deliberately identical — neither should
  // ever insert a line, both submit immediately.
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeQuickBubble();
    }
  });

  // Lightweight, intentionally: no large-paste path to guard against
  // when paste itself is disabled outright.
  input.addEventListener("paste", (event) => event.preventDefault());
  input.addEventListener("cut", (event) => event.preventDefault());
  input.addEventListener("drop", (event) => event.preventDefault());
  input.addEventListener("dragover", (event) => event.preventDefault());

  // Same keyboard/mouse isolation as the pin composer — host-page
  // shortcuts must never see keystrokes meant for this bubble.
  for (const type of ["keydown", "keyup", "keypress"] as const) {
    bubble.addEventListener(type, (event) => event.stopPropagation());
  }
  bubble.addEventListener("mousedown", (event) => event.stopPropagation());

  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (bubble.isConnected) input.focus();
    }, 0);
  });

  // Dismiss on an outside click, same convention as the pin popover.
  const onOutsideClick = (event: MouseEvent) => {
    if (eventTouchesOwnUI(event)) return;
    closeQuickBubble();
    document.removeEventListener("mousedown", onOutsideClick, true);
  };
  document.addEventListener("mousedown", onOutsideClick, true);

  root.append(bubble);
  quickBubbleEl = bubble;
  requestAnimationFrame(() => bubble.classList.add("in"));
  setTimeout(() => input.focus(), 0);
}

// ---- Ephemeral: send, and render (mine + peers') -----------------------

function renderSpeechBubble(payload: {
  text: string;
  name: string;
  color: string;
  clientX: number;
  clientY: number;
  anchorSelector?: string;
  elXPercent?: number;
  elYPercent?: number;
}) {
  const el = document.createElement("div");
  el.className = "speech-bubble";
  el.setAttribute("role", "status");

  const point = anchorViewportPoint(payload) ?? { x: payload.clientX, y: payload.clientY };
  el.style.left = `${Math.min(point.x, window.innerWidth - 20)}px`;
  el.style.top = `${Math.max(point.y - 12, 10)}px`;

  el.innerHTML = `
    <span class="author" style="background:${payload.color}">${payload.name.replace(/</g, "&lt;")}</span>
    <span class="bubble">${payload.text.replace(/</g, "&lt;")}</span>
  `;

  fixedLayerEl().append(el);
  requestAnimationFrame(() => el.classList.add("in"));

  setTimeout(() => {
    el.classList.remove("in");
    el.classList.add("out");
    setTimeout(() => el.remove(), EPHEMERAL_ANIMATION_MS);
  }, EPHEMERAL_DISSOLVE_MS);
}

async function sendEphemeralAnnotation(
  text: string,
  clientX: number,
  clientY: number,
  scope: { communityId: string; canonicalKey: string }
) {
  if (orphanCheck()) return;

  const elementAnchor = anchorForPoint(clientX, clientY);
  const pageWidth = Math.max(document.documentElement.scrollWidth, 1);
  const xPercent = Math.min(100, ((clientX + window.scrollX) / pageWidth) * 100) || 0;
  const yPercent = Math.min(100, ((clientY + window.scrollY) / documentHeight()) * 100) || 0;

  // Optimistic: show my own bubble immediately rather than waiting on a
  // round trip — this is a "everyone sees it right away" feature, and
  // that includes the sender seeing their own note land instantly.
  const profile = await readStoredProfile();
  if (profile) {
    renderSpeechBubble({
      text,
      name: profile.displayName,
      color: profile.avatarColor,
      clientX,
      clientY,
      anchorSelector: elementAnchor?.selector,
      elXPercent: elementAnchor?.elXPercent,
      elYPercent: elementAnchor?.elYPercent,
    });
  }

  void browser.runtime
    .sendMessage({
      type: "tabcom:annotation-send",
      communityId: scope.communityId,
      canonicalKey: scope.canonicalKey,
      text,
      xPercent,
      yPercent,
      anchorSelector: elementAnchor?.selector,
      elXPercent: elementAnchor?.elXPercent,
      elYPercent: elementAnchor?.elYPercent,
    })
    .catch(() => {});
}

function handleAnnotationPeer(peer: AnnotationPeer) {
  if (!annotationScope) return;
  if (peer.canonicalKey !== annotationScope.canonicalKey) return;
  if (peer.communityId !== annotationScope.communityId) return;

  const point = anchorViewportPoint(peer);
  const fallback = point ?? {
    x: (peer.xPercent / 100) * window.innerWidth,
    y: (peer.yPercent / 100) * window.innerHeight,
  };

  renderSpeechBubble({
    text: peer.text,
    name: peer.from.name,
    color: peer.from.color,
    clientX: fallback.x,
    clientY: fallback.y,
    anchorSelector: peer.anchorSelector,
    elXPercent: peer.elXPercent,
    elYPercent: peer.elYPercent,
  });
}

// ---- Persistent: @-prefixed quick annotation reuses pin_add exactly ----

async function createPersistentQuickAnnotation(
  text: string,
  clientX: number,
  clientY: number,
  scope: { communityId: string; canonicalKey: string }
) {
  const pageX = clientX + window.scrollX;
  const pageY = clientY + window.scrollY;
  const pageWidth = Math.max(document.documentElement.scrollWidth, 1);
  const xPercent = Math.min(100, (pageX / pageWidth) * 100) || 0;
  const yPercent = Math.min(100, (pageY / documentHeight()) * 100) || 0;
  const elementAnchor = anchorForPoint(clientX, clientY);
  const anchor = readPageAnchor();

  const pendingId = `pending-${Date.now()}-${++pendingPinSeq}`;
  pendingPins.set(pendingId, {
    text,
    xPercent,
    yPercent,
    pageX,
    pageY,
    anchorSelector: elementAnchor?.selector,
    elXPercent: elementAnchor?.elXPercent,
    elYPercent: elementAnchor?.elYPercent,
  });
  renderPendingPins();

  const ok = await boardWrite("pin_add", {
    communityId: scope.communityId,
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
  console.debug("[tabcom] quick persistent annotation pin_add result:", ok);

  pendingPins.delete(pendingId);
  if (ok) {
    void renderExisting();
  } else {
    renderedPins.get(pendingId)?.marker.remove();
    renderedPins.delete(pendingId);
    showSaveToast(`Note not saved — can't reach ${failureHost()}`);
  }
}

// ---- Global "/" shortcut ------------------------------------------------

document.addEventListener(
  "keydown",
  (event) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isEditableTarget(document.activeElement)) return; // page's own input wins, always
    if (!annotationScope) return; // this page isn't shared — "/" does nothing
    if (quickBubbleEl) return; // one bubble at a time
    if (activeMode) return; // don't fight the click-to-pin/area tool

    event.preventDefault();
    openQuickBubble(lastMouseClientX, lastMouseClientY);
  },
  true
);

// "@" is the second global trigger: same gating as "/", but opens the
// bubble already in persistent-note mode. Since the "@" here is a
// keydown that opens the UI (never typed into the input itself), it
// can never end up inside the saved comment.
document.addEventListener(
  "keydown",
  (event) => {
    if (event.key !== "@" || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isEditableTarget(document.activeElement)) return;
    if (!annotationScope) return;
    if (quickBubbleEl) return;
    if (activeMode) return;

    event.preventDefault();
    openQuickBubble(lastMouseClientX, lastMouseClientY, "persistent");
  },
  true
);

// ---- Messages from the side panel --------------------------------------

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "tabcom:ping") {
    sendResponse({ ok: true, version: CONTENT_SCRIPT_VERSION });
    return true;
  }

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

  if (message?.type === "tabcom:annotation-peer") {
    handleAnnotationPeer(message.peer);
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
    console.info(`[tabcom] content script v${CONTENT_SCRIPT_VERSION} loaded`);
    onCursorsEnabledChange((enabled) => {
      if (!enabled) void syncCursorScope(null);
      else void renderExisting(); // re-arm scope detection
    });

    // Annotations only need the DOM to exist, not every image/font/iframe
    // on the page to finish loading — waiting for the full "load" event
    // (the previous behavior) made the annotate cursor and pin anchoring
    // take as long as the slowest resource on the page, sometimes 10+
    // seconds on media-heavy sites. "loading" -> not yet safe to query
    // the DOM; anything past that ("interactive" or "complete") is.
    const boot = () => {
      void renderExisting();
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
      boot();
    }

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
