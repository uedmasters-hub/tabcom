import { browser } from "wxt/browser";
import {
  addBoardHighlight,
  addBoardItem,
  addBoardPin,
  addBoardArea,
  disconnectRealtime,
  initRealtime,
  isRealtimeConnected,
  waitForRealtimeConnection,
  REALTIME_URL,
  removeBoardHighlight,
  removeBoardPin,
  removeBoardArea,
  sendAnnotationEphemeral,
  sendCallSignal,
  sendCommunityMessage,
  sendCursorLeave,
  sendCursorMove,
  updatePresence,
  type AnnotationPeer,
  type IncomingCallSignal,
  type WireCommunity,
  type WireMessage,
  type WireUser,
} from "../../src/lib/realtime";

/**
 * Board write relay AND live-update receiver.
 *
 * Content scripts (which run inside a webpage's context and can be
 * subject to that page's Content-Security-Policy) never open their own
 * network connection. Instead they send a runtime message here — the
 * background service worker is an extension page, never subject to any
 * website's CSP, and serves every tab from a single shared connection
 * instead of one per tab.
 *
 * This connection is established proactively (not just when this user
 * writes something) and kept open, because it's also how OTHER
 * people's board changes reach this browser at all — a write-only,
 * idle-disconnecting connection can only ever reflect this user's own
 * actions, never a teammate's.
 *
 * Flow: content script -> runtime message -> background emits to the
 * relay server -> server confirms via community_update -> written to
 * storage -> broadcast to all tabs so their overlays re-render
 * immediately. The same storage write happens on the full "communities"
 * snapshot every (re)connection sends, so a service-worker restart
 * (MV3 can suspend these independent of anything this code does)
 * always catches up on anything missed while it was down.
 */

interface StoredProfile {
  username: string;
  displayName: string;
  avatarColor: string;
  photo?: string;
  guestInstanceId?: string;
  /**
   * Was missing entirely before this fix — background's write
   * connection never presented a session token, so even a REGISTERED
   * account's background socket went through the unauthenticated path
   * and could get its OWN real username suffixed by the server's guest
   * collision check (colliding against the panel's correctly
   * authenticated connection using the exact same username). Board
   * writes and cursor moves from a real account could end up signed
   * under a randomly-mangled identity instead of the account's actual
   * one. Threading this through makes background authenticate exactly
   * like the panel and pip window already do.
   */
  sessionToken?: string;
  presence?: "online" | "away" | "busy" | "offline";
}

// Previously disconnected after 5s of write-inactivity to avoid
// holding an idle connection per user. That optimization directly
// broke real-time collaboration: this connection is also how OTHER
// people's pins/highlights/board changes reach this browser at all,
// and it was disconnected the vast majority of the time, so updates
// were missed unless something else (page reload, SPA nav) happened
// to trigger a fresh fetch. A single persistent connection per
// browser session is cheap; a collaborative board that only updates
// on refresh is the actual cost of getting this "optimization" wrong.
let writeConnected = false;

/** Tabs currently sharing live cursors: tabId -> scope. Used to target
 *  cursor-move broadcasts to only the tabs actually viewing that page —
 *  unrelated to connection lifecycle now that the connection stays open
 *  regardless. */
const cursorTabs = new Map<number, { communityId: string; canonicalKey: string }>();

/** Tabs currently eligible for quick annotations: tabId -> scope.
 *  Deliberately separate from cursorTabs — annotation availability
 *  depends only on "is this page on a board", not on the unrelated
 *  live-cursors preference toggle, so it's tracked independently and
 *  registered unconditionally whenever the content script finds a
 *  matching board item (see content/index.ts's annotationScope). */
const annotationTabs = new Map<number, { communityId: string; canonicalKey: string }>();

// ---- Call session routing ----------------------------------------------
//
// The call WINDOW (entrypoints/call) owns getUserMedia + the
// RTCPeerConnection; this background script only routes signaling
// between that window (via a long-lived Port) and the socket. One call
// at a time: a second incoming offer while a session exists gets an
// automatic "busy" back, per the spec's busy-state requirement.

let callPort: ReturnType<typeof browser.runtime.connect> | null = null;
let callSession: { peer: string; windowId?: number } | null = null;
/** Signals that arrived after the window was opened but before its
 *  port connected — replayed on connect so the offer isn't lost. */
let pendingCallSignals: IncomingCallSignal[] = [];

async function openCallWindow(params: {
  peer: string;
  peerName: string;
  peerColor: string;
  video: boolean;
  role: "caller" | "callee";
}) {
  // browser.runtime.getURL's generated PublicPath type only covers bare
  // entrypoint paths — a query string can never literally match it, so
  // this is cast rather than made to depend on wxt prepare/dev/build
  // having regenerated types since call.html was added (tsc --noEmit
  // alone doesn't trigger that regeneration, which is exactly what
  // produced the "Found 1 error" compile failure here).
  const url = browser.runtime.getURL("/call.html" as never) +
    `?peer=${encodeURIComponent(params.peer)}&peerName=${encodeURIComponent(params.peerName)}&peerColor=${encodeURIComponent(params.peerColor)}&video=${params.video ? "1" : "0"}&role=${params.role}`;
  const win = await browser.windows.create({
    url,
    type: "popup",
    width: params.video ? 420 : 340,
    height: params.video ? 520 : 300,
  });
  callSession = { peer: params.peer, windowId: win?.id ?? undefined };
  beginCallBusy();
}

function handleIncomingCallSignal(payload: IncomingCallSignal) {
  const { from, signal } = payload;

  if (signal.kind === "offer") {
    if (callSession) {
      // Already in (or setting up) a call — auto-busy, don't interrupt.
      if (callSession.peer !== from.username) {
        sendCallSignal(from.username, { kind: "busy" });
      }
      return;
    }
    callSession = { peer: from.username };
    pendingCallSignals = [payload];
    notify(
      `call:${from.username}:${Date.now()}`,
      signal.video ? "Incoming video call" : "Incoming call",
      `${from.name || from.username} is calling you`
    );
    void openCallWindow({
      peer: from.username,
      peerName: from.name,
      peerColor: from.color,
      video: signal.video === true,
      role: "callee",
    });
    return;
  }

  // Non-offer signals only matter for the active session's peer.
  if (!callSession || callSession.peer !== from.username) return;

  if (callPort) {
    callPort.postMessage({ type: "signal", payload });
  } else {
    pendingCallSignals.push(payload);
  }
}

/** Registered inside defineBackground() — browser API listeners must
 *  not run at module top level (WXT imports this module at build time
 *  in a mock environment where they'd throw). */
function registerCallPortListener() {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== "tabcom-call") return;

    callPort = port;
    for (const queued of pendingCallSignals) {
      port.postMessage({ type: "signal", payload: queued });
    }
    pendingCallSignals = [];

    port.onMessage.addListener((message: { type: string; to?: string; signal?: unknown }) => {
      if (message.type === "signal" && message.to && message.signal) {
        void ensureWriteConnection().then((connected) => {
          if (connected) {
            sendCallSignal(message.to!, message.signal as Parameters<typeof sendCallSignal>[1]);
          }
        });
      }
    });

    // Window closed (hang up, or just closed): tell the peer the call is
    // over — a vanished window must never leave the other side ringing.
    port.onDisconnect.addListener(() => {
      if (callPort === port) {
        const peer = callSession?.peer;
        callPort = null;
        callSession = null;
        pendingCallSignals = [];
        if (peer && writeConnected) sendCallSignal(peer, { kind: "end" });
        endCallBusy();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Presence lifecycle (background side)
//
// The panel's socket and this background socket both carry a presence;
// the server resolves per-account presence with deliberate statuses
// winning over "online". Two jobs here:
//   1. Mirror the user's chosen status onto THIS socket whenever the
//      profile changes (the panel may be closed later — this socket is
//      then the only one representing the account).
//   2. Auto-busy: any call session flips this socket to "busy" for the
//      call's duration and restores the chosen status afterwards. One
//      busy socket is enough to flip the whole account (server rule),
//      and this hook sits at call-session level, so 1:1 today and any
//      future community calls inherit it identically.
// ---------------------------------------------------------------------------

type StoredPresence = "online" | "away" | "busy" | "offline";

let callAutoBusy = false;

async function chosenPresence(): Promise<StoredPresence> {
  const profile = await readStoredProfile();
  return profile?.presence ?? "online";
}

function beginCallBusy(): void {
  if (callAutoBusy) return;
  callAutoBusy = true;
  void (async () => {
    // Appear-offline users can't be in a call in the first place
    // (server gates offers both ways) — but guard anyway.
    if ((await chosenPresence()) === "offline") return;
    updatePresence("busy");
    void browser.runtime
      .sendMessage({ type: "tabcom:presence-auto", presence: "busy" })
      .catch(() => {}); // no panel open — fine
  })();
}

function endCallBusy(): void {
  if (!callAutoBusy) return;
  callAutoBusy = false;
  void (async () => {
    const restore = await chosenPresence();
    // The user's stored choice may itself have been overwritten to
    // "busy" by the panel mirroring the auto-busy — restoring "busy"
    // forever would wedge the account. Busy-by-call restores to online.
    const target = restore === "busy" ? "online" : restore;
    updatePresence(target);
    void browser.runtime
      .sendMessage({ type: "tabcom:presence-auto", presence: target })
      .catch(() => {});
  })();
}

function registerPresenceSyncListener(): void {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes["tabcom:profile"]) return;
    if (callAutoBusy) return; // during a call, busy wins until it ends
    try {
      const raw = changes["tabcom:profile"].newValue as string | undefined;
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const presence = (parsed.state ?? parsed)?.presence as StoredPresence | undefined;
      if (presence) updatePresence(presence);
    } catch {
      // malformed — ignore
    }
  });
}

async function readStoredProfile(): Promise<StoredProfile | null> {
  const result = await browser.storage.local.get("tabcom:profile");
  const raw = result["tabcom:profile"] as string | undefined;
  if (!raw) {
    console.log(
      "[tabcom:background] no stored profile found — open the panel at least once first"
    );
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    const state = parsed.state ?? parsed;
    if (!state?.username) return null;
    return {
      username: state.username,
      displayName: state.displayName,
      avatarColor: state.avatarColor,
      photo: state.photo,
      guestInstanceId: state.guestInstanceId,
      sessionToken: state.sessionToken,
      presence: state.presence,
    };
  } catch {
    return null;
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
    // best-effort cache write; the panel's own sync will correct it
  }
}

async function broadcastToAllTabs(message: Record<string, unknown>): Promise<void> {
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    if (tab.id == null) continue;
    browser.tabs.sendMessage(tab.id, message).catch(() => {
      // no content script on that tab (chrome://, extension pages, etc.)
    });
  }
}

// ---------------------------------------------------------------------------
// Always-online: pending inbox + notifications + badge
//
// The background socket is the one that's ALWAYS connected (server ping
// every 10s keeps this MV3 worker alive; the keepalive alarm resurrects
// it if Chrome kills it anyway). Anything user-facing that arrives while
// no Tabcom UI is open gets (a) queued durably so the panel shows it on
// next open — the server keeps no history, so this queue is the only
// place a "message received while closed" survives — and (b) surfaced
// as a system notification immediately.
// ---------------------------------------------------------------------------

const PENDING_INBOX_KEY = "tabcom:pending-inbox";
const PENDING_INBOX_CAP = 500;

export interface PendingInboxItem {
  kind: "dm" | "community";
  from: WireUser;
  communityId?: string;
  message: WireMessage;
  receivedAt: number;
}

let inboxWriteChain: Promise<void> = Promise.resolve();

/** Serialized read-modify-write — DMs and community messages can land
 *  concurrently and storage.local has no transactions. */
function queuePendingInbox(item: PendingInboxItem): void {
  inboxWriteChain = inboxWriteChain.then(async () => {
    try {
      const result = await browser.storage.local.get(PENDING_INBOX_KEY);
      const list = (result[PENDING_INBOX_KEY] as PendingInboxItem[] | undefined) ?? [];
      list.push(item);
      await browser.storage.local.set({
        [PENDING_INBOX_KEY]: list.slice(-PENDING_INBOX_CAP),
      });
      void updateBadge(list.length);
    } catch (error) {
      console.error("[tabcom:background] pending inbox write failed:", error);
    }
  });
}

async function updateBadge(count: number): Promise<void> {
  try {
    await browser.action.setBadgeBackgroundColor({ color: "#dc2626" });
    await browser.action.setBadgeText({ text: count > 0 ? String(Math.min(count, 99)) : "" });
  } catch {
    // badge is best-effort
  }
}

/** Live Ports held by open Tabcom UI surfaces (panel/popup). The port
 *  disconnects automatically the instant the surface closes, so
 *  `uiPorts.size > 0` is a deterministic, zero-API-sniffing answer to
 *  "is the user already looking at Tabcom?" — unlike
 *  runtime.getContexts, which doesn't exist / misbehaves on some
 *  Chrome and Brave versions and made notifications fire while the
 *  chat was open. */
const uiPorts = new Set<ReturnType<typeof browser.runtime.connect>>();

function isUiOpen(): boolean {
  return uiPorts.size > 0;
}

function registerUiPortListener() {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== "tabcom-ui") return;
    uiPorts.add(port);
    // The user is looking at Tabcom now — anything we notified about
    // is being read. Clear system notifications; the panel drains the
    // pending queue itself (which resets the badge via storage change).
    void clearAllNotifications();
    port.onDisconnect.addListener(() => {
      uiPorts.delete(port);
    });
  });
}

async function clearAllNotifications(): Promise<void> {
  try {
    const all = await browser.notifications.getAll();
    for (const id of Object.keys(all)) void browser.notifications.clear(id);
  } catch {
    // best-effort
  }
}

function notify(id: string, title: string, message: string): void {
  if (isUiOpen()) return;
  void (async () => {
    try {
      await browser.notifications.create(id, {
        type: "basic",
        iconUrl: browser.runtime.getURL("/icon/128.png" as never),
        title,
        message,
      });
    } catch (error) {
      console.error("[tabcom:background] notification failed:", error);
    }
  })();
}

function previewText(message: WireMessage): string {
  if (message.kind === "voice") return "🎤 Voice message";
  if (message.kind === "image") return "📷 Photo";
  return message.text.length > 80 ? `${message.text.slice(0, 77)}…` : message.text;
}

/** Notification click → bring the user into Tabcom. Chrome only allows
 *  action.openPopup() sometimes; a small focused window is the fallback
 *  that always works. */
function registerNotificationClickListener() {
  browser.notifications.onClicked.addListener((notificationId) => {
    void (async () => {
      try {
        await browser.notifications.clear(notificationId);
        const openPopup = (browser.action as unknown as { openPopup?: () => Promise<void> })
          .openPopup;
        if (openPopup) {
          await openPopup.call(browser.action);
          return;
        }
        throw new Error("openPopup unavailable");
      } catch {
        await browser.windows.create({
          url: browser.runtime.getURL("/popup.html" as never),
          type: "popup",
          width: 400,
          height: 640,
        });
      }
    })();
  });
}

/** Default write patience: long enough for a sleeping Render free
 *  instance to cold-start (observed 30-60s). A write made during the
 *  wake-up window WAITS for the server instead of being rejected. */
const WRITE_WAIT_MS = 45_000;

let realtimeInitialized = false;

async function ensureWriteConnection(waitMs: number = WRITE_WAIT_MS): Promise<boolean> {
  const profile = await readStoredProfile();
  if (!profile) return false;

  if (!realtimeInitialized) {
    realtimeInitialized = true;
    console.info("[tabcom:background] realtime server:", REALTIME_URL);
    initRealtime(
      {
        username: profile.username,
        name: profile.displayName,
        color: profile.avatarColor,
        visibility: "public",
        presence: profile.presence ?? "online",
        photo: profile.photo,
      },
      {
        onConnectionChange: (live) => {
          writeConnected = live;
          console.info(
            `[tabcom:background] realtime ${live ? "CONNECTED" : "disconnected"} (${REALTIME_URL})`
          );
        },
        onRoster: () => {},
          onDm: (from, message) => {
            if (isUiOpen()) return; // panel's live socket already delivered it
            queuePendingInbox({ kind: "dm", from, message, receivedAt: Date.now() });
            notify(`dm:${from.username}:${message.id}`, from.name || from.username, previewText(message));
          },
          onTyping: () => {},
          onDmError: () => {},
          onConnections: () => {},
          onConnectRequest: (from) => {
            notify(
              `connect:${from.username}`,
              "Connection request",
              `${from.name || from.username} wants to connect on Tabcom`
            );
          },
          onConnectUpdate: () => {},
          onCommunities: (list) => {
            console.log(
              "[tabcom:background] communities snapshot received on connect:",
              list.length
            );
            void (async () => {
              for (const community of list) {
                await writeStoredCommunity(community);
              }
              await broadcastToAllTabs({ type: "tabcom:community-updated" });
            })();
          },
          onCommunityUpdate: (community) => {
            console.log(
              "[tabcom:background] community_update received, board items:",
              community.board.length
            );
            void writeStoredCommunity(community);
            void broadcastToAllTabs({
              type: "tabcom:community-updated",
              communityId: community.id,
            });
          },
          onCursorPeer: (peer) => {
            for (const [tabId, scope] of cursorTabs) {
              if (scope.canonicalKey !== peer.canonicalKey) continue;
              if (scope.communityId !== peer.communityId) continue;
              browser.tabs
                .sendMessage(tabId, { type: "tabcom:cursor-peer", peer })
                .catch(() => cursorTabs.delete(tabId));
            }
          },
          onCursorPeerLeave: (payload) => {
            for (const [tabId, scope] of cursorTabs) {
              if (scope.canonicalKey !== payload.canonicalKey) continue;
              browser.tabs
                .sendMessage(tabId, {
                  type: "tabcom:cursor-peer-leave",
                  from: payload.from,
                })
                .catch(() => cursorTabs.delete(tabId));
            }
          },
          onAnnotationPeer: (peer: AnnotationPeer) => {
            for (const [tabId, scope] of annotationTabs) {
              if (scope.canonicalKey !== peer.canonicalKey) continue;
              if (scope.communityId !== peer.communityId) continue;
              browser.tabs
                .sendMessage(tabId, { type: "tabcom:annotation-peer", peer })
                .catch(() => annotationTabs.delete(tabId));
            }
          },
          onCallSignal: handleIncomingCallSignal,
          onCommunityInvite: (community, from) => {
            notify(
              `invite:${community.id}`,
              "Community invite",
              `${from.name || from.username} invited you to ${community.name}`
            );
          },
          onCommunityDeclined: () => {},
          onCommunityLeft: () => {},
          onCommunityMessage: (communityId, from, message) => {
            if (isUiOpen()) return; // panel's live socket already delivered it
            queuePendingInbox({ kind: "community", from, communityId, message, receivedAt: Date.now() });
            notify(
              `community:${communityId}:${message.id}`,
              `${from.name || from.username} in community`,
              previewText(message)
            );
          },
          onCommunityError: () => {},
      },
      profile.sessionToken,
      profile.guestInstanceId
    );
  }

  if (isRealtimeConnected()) return true;

  // Waiting out a server cold start can exceed MV3's ~30s service
  // worker idle timeout. Touching an extension API resets that timer,
  // so a periodic no-op call keeps this worker (and the pending
  // sendResponse the caller is holding) alive until the wait settles.
  const keepalive = setInterval(() => {
    void browser.runtime.getPlatformInfo().catch(() => {});
  }, 20_000);

  try {
    const connected = await waitForRealtimeConnection(waitMs);
    writeConnected = connected;
    return connected;
  } finally {
    clearInterval(keepalive);
  }
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "tabcom:notification-permission") {
    // Chrome exposes whether ITS OWN setting allows this extension to
    // show notifications ("granted" | "denied"). This does not cover
    // the OS layer (macOS System Settings can still mute Chrome
    // itself) — the banner copy mentions both.
    void (async () => {
      try {
        const level = await (browser.notifications as unknown as {
          getPermissionLevel: () => Promise<string>;
        }).getPermissionLevel();
        sendResponse({ level });
      } catch {
        sendResponse({ level: "granted" }); // unsupported (Firefox etc.) — don't nag
      }
    })();
    return true;
  }
  if (message?.type === "tabcom:open-notification-settings") {
    void browser.tabs.create({ url: "chrome://settings/content/notifications" }).catch(() => {
      // Some browsers refuse chrome:// from extensions — fall back to
      // the extension's own settings page for this extension.
      void browser.tabs.create({ url: `chrome://extensions/?id=${browser.runtime.id}` }).catch(() => {});
    });
    sendResponse({ ok: true });
    return true;
  }

  // Background maintains its OWN persistent connection (for board
  // writes / cursors while the panel is closed), entirely separate
  // from — and with zero built-in awareness of — whatever ended the
  // session in the panel's UI (guest timer running out, manual sign
  // out, ending a guest session, or deleting the account). Without
  // this, that connection stayed alive indefinitely regardless of WHY
  // the session ended, which is exactly why an ended identity kept
  // showing up as online to everyone else. The server's own periodic
  // sweep (see index.ts) is a backing safety net for the guest-timer
  // case specifically; this is what makes it instant, and covers
  // every OTHER way a session can end too.
  if (message?.type === "tabcom:session-ended") {
    disconnectRealtime();
    realtimeInitialized = false;
    writeConnected = false;
    return undefined;
  }

  if (message?.type === "tabcom:cursor-start") {
    const tabId = sender.tab?.id;
    if (tabId != null) {
      cursorTabs.set(tabId, {
        communityId: message.communityId,
        canonicalKey: message.canonicalKey,
      });
      void ensureWriteConnection(5_000).then((connected) =>
        sendResponse({ ok: connected })
      );
      return true;
    }
    sendResponse({ ok: false });
    return true;
  }

  if (message?.type === "tabcom:cursor-move") {
    const tabId = sender.tab?.id;
    const scope = tabId != null ? cursorTabs.get(tabId) : undefined;
    if (scope && writeConnected) {
      sendCursorMove(scope.communityId, scope.canonicalKey, {
        xPercent: message.xPercent,
        yPercent: message.yPercent,
        pageX: message.pageX,
        pageY: message.pageY,
        anchorSelector: message.anchorSelector,
        elXPercent: message.elXPercent,
        elYPercent: message.elYPercent,
      });
    }
    return undefined; // fire-and-forget
  }

  if (message?.type === "tabcom:cursor-stop") {
    const tabId = sender.tab?.id;
    const scope = tabId != null ? cursorTabs.get(tabId) : undefined;
    if (tabId != null && scope) {
      if (writeConnected) sendCursorLeave(scope.communityId, scope.canonicalKey);
      cursorTabs.delete(tabId);
    }
    sendResponse({ ok: true });
    return true;
  }

  // Registered unconditionally whenever the content script's own board-
  // scope detection changes (renderExistingInner) — NOT gated by the
  // cursors-enabled toggle, since quick annotations are a separate
  // feature from live cursor sharing. `scope: null` clears it (page no
  // longer on a board, e.g. an SPA nav away from a shared page).
  if (message?.type === "tabcom:annotation-scope") {
    const tabId = sender.tab?.id;
    if (tabId != null) {
      if (message.scope) {
        annotationTabs.set(tabId, message.scope);
      } else {
        annotationTabs.delete(tabId);
      }
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "tabcom:call-start") {
    (async () => {
      if (callSession) {
        sendResponse({ ok: false, reason: "call_in_progress" });
        return;
      }
      const connected = await ensureWriteConnection(15_000);
      if (!connected) {
        sendResponse({ ok: false, reason: "offline" });
        return;
      }
      await openCallWindow({
        peer: message.peer,
        peerName: message.peerName,
        peerColor: message.peerColor,
        video: message.video === true,
        role: "caller",
      });
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message?.type === "tabcom:annotation-send") {
    (async () => {
      const connected = await ensureWriteConnection(10_000);
      if (connected) {
        sendAnnotationEphemeral(message.communityId, message.canonicalKey, {
          text: message.text,
          xPercent: message.xPercent,
          yPercent: message.yPercent,
          pageX: message.pageX,
          pageY: message.pageY,
          anchorSelector: message.anchorSelector,
          elXPercent: message.elXPercent,
          elYPercent: message.elYPercent,
        });
      }
      sendResponse({ ok: connected });
    })();
    return true;
  }

  if (message?.type !== "tabcom:board-write") return undefined;

  console.log("[tabcom:background] board-write received:", message.action, message.payload);

  (async () => {
    const connected = await ensureWriteConnection();
    console.log("[tabcom:background] write connection status:", connected);
    if (!connected) {
      sendResponse({ ok: false, reason: "offline", target: REALTIME_URL });
      return;
    }

    switch (message.action) {
      case "pin_add":
        addBoardPin(message.payload);
        break;
      case "pin_remove":
        removeBoardPin(message.payload.communityId, message.payload.itemId, message.payload.pinId);
        break;
      case "area_add":
        addBoardArea(message.payload);
        break;
      case "area_remove":
        removeBoardArea(
          message.payload.communityId,
          message.payload.itemId,
          message.payload.areaId
        );
        break;
      case "highlight_add":
        addBoardHighlight(message.payload);
        break;
      case "highlight_remove":
        removeBoardHighlight(
          message.payload.communityId,
          message.payload.itemId,
          message.payload.highlightId
        );
        break;
      case "item_add":
        addBoardItem(message.payload);
        break;
      case "community_message":
        sendCommunityMessage(message.payload.communityId, {
          id: crypto.randomUUID(),
          kind: "text",
          text: String(message.payload.text ?? "").slice(0, 2000),
          sentAt: Date.now(),
        });
        break;
    }

    console.log("[tabcom:background] board-write completed:", message.action);
    sendResponse({ ok: true });
  })();

  return true; // keep the message channel open for the async response
});

export default defineBackground(() => {
  registerCallPortListener();

  browser.runtime.onInstalled.addListener(async () => {
    // NOTE: this call is currently a no-op. The UI entrypoint is
    // entrypoints/popup, which makes WXT generate action.default_popup
    // in the manifest — and Chrome's rule is that default_popup wins
    // outright over setPanelBehavior, silently, with no error anywhere.
    // To actually get a persistent side panel (stays open while
    // interacting with the page, rather than closing on every outside
    // click), rename entrypoints/popup -> entrypoints/sidepanel and
    // this call starts working immediately, unchanged. Left in place
    // on purpose rather than removed, since the sidePanel permission
    // is also already declared in wxt.config.ts for the same reason —
    // this was the original intent, reverted back to a popup on
    // request, not abandoned.
    await browser.sidePanel.setPanelBehavior({
      openPanelOnActionClick: true,
    });
  });

  // Connect as soon as the background script starts (extension load,
  // browser start, or MV3 waking the service worker back up) rather
  // than waiting for this user's first write — this is what lets
  // teammates' pins/highlights/messages actually reach an open tab
  // without that person having to do anything first themselves.
  void ensureWriteConnection();
  browser.runtime.onStartup.addListener(() => void ensureWriteConnection());

  registerNotificationClickListener();
  registerUiPortListener();
  registerPresenceSyncListener();

  // Belt-and-braces "always online": the server's 10s socket ping keeps
  // this worker alive (Chrome ≥116 extends SW life on WebSocket
  // activity), but if Chrome kills it anyway — crash, aggressive memory
  // pressure, older Chrome — this alarm resurrects the worker every 30s
  // and re-establishes the connection. Alarm handlers firing IS the
  // wake-up; the ensureWriteConnection call reconnects if needed.
  void browser.alarms.create("tabcom-keepalive", { periodInMinutes: 0.5 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== "tabcom-keepalive") return;
    void ensureWriteConnection();
  });

  // Panel drains the pending inbox on open; keep the badge honest when
  // it does (or when anything else clears/changes the queue).
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[PENDING_INBOX_KEY]) return;
    const next = (changes[PENDING_INBOX_KEY].newValue as PendingInboxItem[] | undefined) ?? [];
    void updateBadge(next.length);
  });
});
