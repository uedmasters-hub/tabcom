import { Pin, PinOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { createPortal } from "react-dom";
import { browser } from "wxt/browser";

import "../../src/styles/tailwind.css";
import "../../src/styles/globals.css";

import ChatView from "../../src/features/workspace/views/chat/ChatView";
import InboxView from "../../src/features/workspace/views/InboxView";
import { cn } from "../../src/lib/cn";
import { disconnectRealtime, updatePresence } from "../../src/lib/realtime";
import { initRealtimeFromStores } from "../../src/lib/realtime-wiring";
import { useChatStore } from "../../src/stores/chat.store";
import { useProfileStore } from "../../src/stores/profile.store";

/**
 * Floating chat window.
 *
 * DELIBERATELY a thin shell: everything inside — the inbox, the
 * thread, message rendering and actions, status indicators, unread
 * handling, the appear-offline gates — is the SAME ChatView/InboxView
 * the panel renders, connected through the same realtime-wiring
 * module. This window only contributes the window chrome (pin-on-top)
 * and conversation targeting. The previous version re-implemented a
 * mini chat UI here and inevitably drifted behind the panel (no edits,
 * deletions, reactions, or read receipts, stale presence behavior);
 * this structure makes that class of drift impossible for both direct
 * chats and community chats.
 */

interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

/** Copy this document's styles into the always-on-top window. */
function cloneStyles(target: Window): void {
  for (const sheet of [...document.styleSheets]) {
    try {
      const css = [...sheet.cssRules].map((rule) => rule.cssText).join("");
      const style = target.document.createElement("style");
      style.textContent = css;
      target.document.head.append(style);
    } catch {
      if (sheet.href) {
        const link = target.document.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        target.document.head.append(link);
      }
    }
  }
}

function requestedConversationId(): string | null {
  return new URLSearchParams(window.location.search).get("conversation");
}

/** Slim chrome above the shared views: connection state + pin toggle. */
function FloatTopBar({
  pinSupported,
  pinned,
  onTogglePin,
}: {
  pinSupported: boolean;
  pinned: boolean;
  onTogglePin: () => void;
}) {
  const phase = useChatStore((state) => state.connectionPhase);

  return (
    <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-1.5">
      <span className="text-[11px] font-bold tracking-tight text-slate-900">
        Tabcom
      </span>
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
          phase === "live"
            ? "bg-emerald-50 text-emerald-600"
            : phase === "connecting"
              ? "bg-amber-50 text-amber-600"
              : "bg-slate-100 text-slate-400"
        )}
      >
        {phase === "live" ? "Live" : phase === "connecting" ? "Connecting" : "Offline"}
      </span>

      <div className="flex-1" />

      {pinSupported && (
        <button
          type="button"
          onClick={onTogglePin}
          aria-label={pinned ? "Unpin from top" : "Pin on top of all windows"}
          title={pinned ? "Unpin from top" : "Pin on top of all windows"}
          className="rounded-lg p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
        >
          {pinned ? <PinOff size={14} /> : <Pin size={14} />}
        </button>
      )}
    </div>
  );
}

/** The unified body: exact same components as the panel. Back in the
 *  thread header clears the active conversation → the shared inbox. */
function UnifiedBody() {
  const activeConversationId = useChatStore((state) => state.activeConversationId);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {activeConversationId ? (
        <ChatView conversationId={activeConversationId} />
      ) : (
        <InboxView />
      )}
    </div>
  );
}

function FloatApp() {
  const hasHydrated = useChatStore((state) => state.hasHydrated);
  const profileHydrated = useProfileStore((state) => state.hasHydrated);
  const username = useProfileStore((state) => state.username);

  // Same socket wiring as the panel — one shared function, full
  // handler set, correct presence/visibility from the profile store.
  useEffect(() => {
    if (!profileHydrated || !username) return;
    initRealtimeFromStores();
  }, [profileHydrated, username]);

  // This window counts as "a Tabcom UI is open": suppresses system
  // notifications and background queueing for its lifetime.
  useEffect(() => {
    const port = browser.runtime.connect({ name: "tabcom-ui" });
    return () => {
      try {
        port.disconnect();
      } catch {
        // already gone
      }
    };
  }, []);

  // Drain anything the background buffered while no UI was open —
  // intake actions are id-idempotent, so overlap with the panel or the
  // live socket is harmless.
  useEffect(() => {
    void (async () => {
      try {
        const KEY = "tabcom:pending-inbox";
        const result = await browser.storage.local.get(KEY);
        const pending = (result[KEY] as
          | Array<{
              kind: "dm" | "community" | "connect_request";
              from: Parameters<ReturnType<typeof useChatStore.getState>["receiveDm"]>[0];
              communityId?: string;
              message?: Parameters<ReturnType<typeof useChatStore.getState>["receiveDm"]>[1];
            }>
          | undefined) ?? [];
        if (pending.length === 0) return;
        const store = useChatStore.getState();
        for (const item of pending) {
          if (item.kind === "connect_request") store.receiveConnectRequest(item.from);
          else if (item.kind === "dm" && item.message) store.receiveDm(item.from, item.message);
          else if (item.kind === "community" && item.communityId && item.message)
            store.receiveCommunityMessage(item.communityId, item.from, item.message);
        }
        await browser.storage.local.remove(KEY);
      } catch (error) {
        console.error("[tabcom:pip] pending inbox drain failed:", error);
      }
    })();
  }, []);

  // Session end + auto-presence: identical contracts to the panel.
  useEffect(() => {
    const listener = (message: {
      type?: string;
      presence?: "online" | "away" | "busy" | "offline";
    }) => {
      if (message?.type === "tabcom:session-ended") {
        disconnectRealtime();
        return;
      }
      if (message?.type === "tabcom:presence-auto" && message.presence) {
        useProfileStore.getState().setPresence(message.presence);
        updatePresence(message.presence);
      }
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  // Open the requested conversation once hydrated (falls back to the
  // inbox rather than force-picking one — same as the panel's home).
  const openedRequested = useRef(false);
  useEffect(() => {
    if (!hasHydrated || openedRequested.current) return;
    openedRequested.current = true;
    const requested = requestedConversationId();
    if (!requested) return;
    const exists = useChatStore
      .getState()
      .conversations.some((item) => item.id === requested);
    if (exists) useChatStore.getState().openConversation(requested);
  }, [hasHydrated]);

  // Hooks must run unconditionally and in the same order every render —
  // declared before any early return below.
  const [pinWindow, setPinWindow] = useState<Window | null>(null);
  const popupWindowId = useRef<number | null>(null);

  if (!hasHydrated || !profileHydrated) return null;

  const pinSupported =
    typeof window !== "undefined" && !!window.documentPictureInPicture;

  const restorePopup = async () => {
    const id = popupWindowId.current;
    if (id != null) {
      try {
        await browser.windows.update(id, { state: "normal", focused: true });
      } catch {
        // popup already gone
      }
    }
  };

  const pinToTop = async () => {
    if (!window.documentPictureInPicture || pinWindow) return;

    const win = await window.documentPictureInPicture.requestWindow({
      width: 360,
      height: 560,
    });

    cloneStyles(win);
    win.document.title = "Tabcom — Pinned chat";
    win.document.body.style.margin = "0";
    win.document.body.style.height = "100vh";
    win.document.body.style.overflow = "hidden";

    win.addEventListener("pagehide", () => {
      setPinWindow(null);
      void restorePopup();
    });

    setPinWindow(win);

    // The PiP window dies with its opener, so keep this popup alive
    // but tuck it away.
    const current = await browser.windows.getCurrent();
    popupWindowId.current = current.id ?? null;
    if (current.id != null) {
      void browser.windows.update(current.id, { state: "minimized" });
    }
  };

  const unpin = () => pinWindow?.close();

  const app = (
    // `fixed inset-0` (not h-screen): ChatView's autoscroll uses
    // scrollIntoView, which programmatically scrolls ANY ancestor —
    // including overflow-hidden html/body. A normal-flow full-height
    // column gets displaced by that (header shoved off-top, composer
    // stranded mid-window); a fixed, viewport-pinned box cannot be.
    // Inside it, the only scrollable region is the message list itself.
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-white">
      <FloatTopBar
        pinSupported={pinSupported}
        pinned={!!pinWindow}
        onTogglePin={() => (pinWindow ? unpin() : void pinToTop())}
      />
      <UnifiedBody />
    </div>
  );

  if (pinWindow) {
    return (
      <>
        {createPortal(app, pinWindow.document.body)}

        <div className="fixed inset-0 flex flex-col items-center justify-center bg-white px-8 text-center">
          <Pin size={22} className="text-blue-600" />
          <p className="mt-3 text-sm font-semibold">Chat is pinned on top</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            The conversation is floating above all your apps. Closing this
            window closes the pin too.
          </p>
          <button
            type="button"
            onClick={unpin}
            className="mt-4 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold transition hover:border-slate-300"
          >
            Bring it back here
          </button>
        </div>
      </>
    );
  }

  return app;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<FloatApp />);
