import { browser } from "wxt/browser";
import {
  addBoardHighlight,
  addBoardItem,
  addBoardPin,
  addBoardArea,
  initRealtime,
  removeBoardHighlight,
  removeBoardPin,
  removeBoardArea,
  sendCommunityMessage,
  sendCursorLeave,
  sendCursorMove,
  type WireCommunity,
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
});
