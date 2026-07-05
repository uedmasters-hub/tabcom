import { browser } from "wxt/browser";
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
    if (cursorTabs.size > 0) {
      scheduleIdleDisconnect(); // someone is live — check again later
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
          onDm: () => {},
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
          onCommunityMessage: () => {},
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
  });
});
