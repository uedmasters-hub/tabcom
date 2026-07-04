import { browser } from "wxt/browser";
import { getPillEnabled } from "../../src/lib/pill-settings";
import {
  addBoardHighlight,
  addBoardItem,
  addBoardPin,
  disconnectRealtime,
  initRealtime,
  removeBoardHighlight,
  removeBoardPin,
  sendCommunityMessage,
  sendCursorLeave,
  sendCursorMove,
  type WireCommunity,
} from "../../src/lib/realtime";

/**
 * Board write relay.
 *
 * Content scripts (which run inside a webpage's context and can be
 * subject to that page's Content-Security-Policy) never open their own
 * network connection. Instead they send a runtime message here — the
 * background service worker is an extension page, never subject to any
 * website's CSP, and serves every tab from a single on-demand
 * connection instead of one per tab.
 *
 * Flow: content script -> runtime message -> background connects (if
 * needed) -> emits to the relay server -> server confirms via
 * community_update -> written to storage -> broadcast to all tabs so
 * their overlays re-render immediately.
 */

interface StoredProfile {
  username: string;
  displayName: string;
  avatarColor: string;
  photo?: string;
}

const IDLE_DISCONNECT_MS = 5000;

let writeConnected = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

/** Presence follows the pill: while it's enabled, this connection is
 *  held open (socket.io's 25s protocol pings keep the MV3 service
 *  worker alive under Chrome's WebSocket-activity rule), so the person
 *  reads as Online without the panel. Pill off -> disconnect -> Offline
 *  (unless the panel is open with its own socket). */
let persistentPresence = false;

/** Windows opened from the pill — focused instead of duplicated. */
let panelWindowId: number | null = null;
let floatWindowId: number | null = null;

/** Messages arriving while only the pill holds the connection would
 *  otherwise be lost (zero server retention). Buffer them; the panel
 *  drains the buffer into its store on next open. Doubles as the data
 *  source for the pill's unread badge. */
async function bufferIncoming(entry: Record<string, unknown>): Promise<void> {
  try {
    const result = await browser.storage.local.get("tabcom:inbox-buffer");
    const raw = result["tabcom:inbox-buffer"] as string | undefined;
    const buffer: unknown[] = raw ? JSON.parse(raw) : [];
    buffer.push({ ...entry, receivedAt: Date.now() });
    await browser.storage.local.set({
      "tabcom:inbox-buffer": JSON.stringify(buffer.slice(-200)),
    });
  } catch {
    // best effort
  }
}

async function syncPresenceMode(): Promise<void> {
  const enabled = await getPillEnabled();
  const profile = await readStoredProfile();
  persistentPresence = enabled && !!profile;

  console.log("[tabcom:background] presence mode:", persistentPresence ? "persistent (pill on)" : "on-demand");

  if (persistentPresence) {
    await ensureWriteConnection();
  } else {
    // The pill is the presence switch — turning it off means offline,
    // full stop. Cursor streams don't get to hold the connection open.
    cursorTabs.clear();
    disconnectRealtime();
    writeConnected = false;
  }
}

/** Tabs currently sharing live cursors: tabId -> scope. While any tab
 *  is sharing, the connection is kept alive instead of idle-closing. */
const cursorTabs = new Map<number, { communityId: string; canonicalKey: string }>();

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

function scheduleIdleDisconnect() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (persistentPresence || cursorTabs.size > 0) {
      scheduleIdleDisconnect(); // presence held or someone is live
      return;
    }
    disconnectRealtime();
    writeConnected = false;
  }, IDLE_DISCONNECT_MS);
}

async function ensureWriteConnection(): Promise<boolean> {
  const profile = await readStoredProfile();
  if (!profile) return false;

  if (!writeConnected) {
    let resolved = false;

    await new Promise<void>((resolve) => {
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
            if (!resolved) {
              resolved = true;
              resolve();
            }
          },
          onRoster: () => {},
          onDm: (from, message) => {
            void bufferIncoming({ kind: "dm", from, message });
          },
          onTyping: () => {},
          onDmError: () => {},
          onConnections: () => {},
          onConnectRequest: () => {},
          onConnectUpdate: () => {},
          onCommunities: () => {},
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
          onCommunityInvite: () => {},
          onCommunityDeclined: () => {},
          onCommunityLeft: () => {},
          onCommunityMessage: (communityId, from, message) => {
            void bufferIncoming({ kind: "community", communityId, from, message });
          },
          onCommunityError: () => {},
        }
      );

      // Don't hang forever if the server is unreachable.
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      }, 3000);
    });
  }

  scheduleIdleDisconnect();
  return writeConnected;
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Open the side panel for the tab the pill was clicked in. Chrome
  // permits sidePanel.open here because it's in response to a user
  // gesture relayed from the content script (documented pattern).
  if (message?.type === "tabcom:open-panel") {
    // Deterministic: a standalone Tabcom window. (sidePanel.open had
    // nothing to open — there is no side_panel manifest entry — and
    // action.openPopup is inconsistent across Chrome/Brave.) Focus the
    // existing window instead of duplicating.
    void (async () => {
      try {
        if (panelWindowId != null) {
          try {
            await browser.windows.update(panelWindowId, { focused: true });
            sendResponse({ ok: true });
            return;
          } catch {
            panelWindowId = null; // window was closed
          }
        }
        const win = await browser.windows.create({
          url: browser.runtime.getURL("/popup.html"),
          type: "popup",
          width: 420,
          height: 680,
          focused: true,
        });
        panelWindowId = win?.id ?? null;
        console.log("[tabcom:background] panel window opened:", panelWindowId);
        sendResponse({ ok: true });
      } catch (error) {
        console.log("[tabcom:background] open-panel failed:", error);
        sendResponse({ ok: false, reason: String(error) });
      }
    })();
    return true;
  }

  if (message?.type === "tabcom:open-float") {
    // Floating Chat PiP on a specific conversation.
    void (async () => {
      try {
        if (floatWindowId != null) {
          try {
            await browser.windows.remove(floatWindowId);
          } catch {
            // already gone
          }
          floatWindowId = null;
        }
        const win = await browser.windows.create({
          url: browser.runtime.getURL(
            `/pip.html?conversation=${encodeURIComponent(message.conversationId ?? "")}` as "/pip.html"
          ),
          type: "popup",
          width: 360,
          height: 540,
          focused: true,
        });
        floatWindowId = win?.id ?? null;
        console.log("[tabcom:background] float window opened:", floatWindowId);
        sendResponse({ ok: true });
      } catch (error) {
        console.log("[tabcom:background] open-float failed:", error);
        sendResponse({ ok: false, reason: String(error) });
      }
    })();
    return true;
  }

  if (message?.type === "tabcom:cursor-start") {
    const tabId = sender.tab?.id;
    if (tabId != null) {
      cursorTabs.set(tabId, {
        communityId: message.communityId,
        canonicalKey: message.canonicalKey,
      });
      void ensureWriteConnection().then((connected) =>
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
        anchorSelector: message.anchorSelector,
        elXPercent: message.elXPercent,
        elYPercent: message.elYPercent,
      });
      scheduleIdleDisconnect();
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

  if (message?.type !== "tabcom:board-write") return undefined;

  console.log("[tabcom:background] board-write received:", message.action, message.payload);

  (async () => {
    const connected = await ensureWriteConnection();
    console.log("[tabcom:background] write connection status:", connected);
    if (!connected) {
      sendResponse({ ok: false, reason: "offline" });
      return;
    }

    switch (message.action) {
      case "pin_add":
        addBoardPin(message.payload);
        break;
      case "pin_remove":
        removeBoardPin(message.payload.communityId, message.payload.itemId, message.payload.pinId);
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
  browser.runtime.onInstalled.addListener(async () => {
    await browser.sidePanel.setPanelBehavior({
      openPanelOnActionClick: true,
    });
    void syncPresenceMode();
  });

  browser.runtime.onStartup.addListener(() => void syncPresenceMode());

  // React live: pill toggled anywhere, or profile created/changed.
  browser.storage.onChanged.addListener((changes, area) => {
    if (
      area === "local" &&
      ("tabcom:pill-enabled" in changes || "tabcom:profile" in changes)
    ) {
      void syncPresenceMode();
    }
  });

  void syncPresenceMode();
});
