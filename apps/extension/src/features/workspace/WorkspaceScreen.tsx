import { useEffect, useState } from "react";
import { browser } from "wxt/browser";

import AppShell from "../../components/layout/AppShell";
import { fetchMe, endGuestSessionOnServer } from "../../lib/auth-client";
import { loadSettingsFromServer } from "../../lib/settings-sync";
import { disconnectAllContexts, REALTIME_URL, updatePresence } from "../../lib/realtime";
import { initRealtimeFromStores } from "../../lib/realtime-wiring";
import { useAppStore } from "../../stores/app.store";
import { useChatStore } from "../../stores/chat.store";
import { useProfileStore } from "../../stores/profile.store";
import { useWorkspaceStore } from "../../stores/workspace.store";

import TabBar from "./components/TabBar";
import WorkspaceHeader from "./components/WorkspaceHeader";

import CommunitiesView from "./views/CommunitiesView";
import ContactsView from "./views/ContactsView";
import InboxView from "./views/InboxView";
import SettingsView from "./views/SettingsView";

const titles = {
  inbox: "Inbox",
  contacts: "Contacts",
  communities: "Communities",
  settings: "Settings",
} as const;

/**
 * Workspace shell: header + active view + bottom tab navigation.
 * Connects to the realtime server on mount; falls back to local demo
 * mode when the server is unreachable.
 */
  // Chrome (unlike Brave's default) frequently has extension
// notifications disabled — in that state, alerts for messages/calls
// while Tabcom is closed silently never appear. Proactively surface
// a one-tap path to fix it. Dismissal is remembered per session so
// this never turns into a nag.
function NotificationPermissionBanner() {
  const [denied, setDenied] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    void browser.runtime
      .sendMessage({ type: "tabcom:notification-permission" })
      .then((response: { level?: string } | undefined) => {
        if (response?.level === "denied") setDenied(true);
      })
      .catch(() => {});
  }, []);

  if (!denied || dismissed) return null;

  return (
    <div className="flex items-start gap-2.5 border-b border-amber-100 bg-amber-50 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold leading-4 text-amber-800">
          Desktop notifications are off
        </p>
        <p className="mt-0.5 text-[11px] leading-4 text-amber-700">
          You won't see message or call alerts while Tabcom is closed.
          Allow notifications for this extension in your browser settings
          (and check your system notification settings for the browser too).
        </p>
      </div>
      <button
        type="button"
        onClick={() =>
          void browser.runtime
            .sendMessage({ type: "tabcom:open-notification-settings" })
            .catch(() => {})
        }
        className="shrink-0 rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-amber-700"
      >
        Open settings
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded-lg px-1.5 py-1 text-[13px] leading-none text-amber-500 transition hover:bg-amber-100 hover:text-amber-700"
      >
        ×
      </button>
    </div>
  );
}


export default function WorkspaceScreen() {
  const tab = useWorkspaceStore((state) => state.tab);
  const ensureSeeded = useChatStore((state) => state.ensureSeeded);
  const restoreConnections = useChatStore((state) => state.restoreConnections);

  // Drilling into a conversation replaces the shell chrome rather than
  // stacking on top of it: the thread's own header (back arrow + name)
  // takes over from the workspace header, and the bottom tab bar hides
  // since the back arrow is the way out — same pattern as WhatsApp,
  // Telegram, and Slack threads. This alone reclaims ~130-170px of a
  // ~600px-tall popup that was previously spent on duplicate chrome.
  const activeConversationId = useChatStore(
    (state) => state.activeConversationId
  );
  const inThread = tab === "inbox" && !!activeConversationId;

  const username = useProfileStore((state) => state.username);
  const displayName = useProfileStore((state) => state.displayName);
  const avatarColor = useProfileStore((state) => state.avatarColor);
  const visibility = useProfileStore((state) => state.visibility);
  const photo = useProfileStore((state) => state.photo);
  const myPresence = useProfileStore((state) => state.presence);
  const sessionToken = useProfileStore((state) => state.sessionToken);
  const guestInstanceId = useProfileStore((state) => state.guestInstanceId);
  const setVerified = useProfileStore((state) => state.setVerified);
  const isGuest = useProfileStore((state) => state.isGuest);
  const isGuestSessionExpired = useProfileStore(
    (state) => state.isGuestSessionExpired
  );
  const endGuestSession = useProfileStore((state) => state.endGuestSession);
  const setScreen = useAppStore((state) => state.setScreen);
  const resetChat = useChatStore((state) => state.resetChat);

  // Guest sessions are time-boxed to 30 minutes (see profile.store's
  // GUEST_SESSION_DURATION_MS). Checked on an interval rather than a
  // single timeout so it still fires correctly even if the machine was
  // asleep or the popup was closed and reopened mid-session — a plain
  // setTimeout scheduled at mount would drift or simply never fire in
  // those cases. A guest identity is fully disposable by design, so
  // expiry clears chat.store completely too — contacts, conversations,
  // messages, communities, everything — rather than leaving anything
  // for a future session (guest or otherwise) to inherit.
  useEffect(() => {
    if (!isGuest) return;

    const checkExpiry = () => {
      if (isGuestSessionExpired()) {
        endGuestSession();
        void endGuestSessionOnServer().catch(() => {});
        resetChat();
        disconnectAllContexts();
        setScreen("guest-expired");
      }
    };

    checkExpiry(); // catch an expiry that already happened before mount
    const interval = setInterval(checkExpiry, 15_000);
    return () => clearInterval(interval);
  }, [isGuest, isGuestSessionExpired, endGuestSession, resetChat, setScreen]);

  // Pick up a verification that happened elsewhere (another tab, or
  // between extension launches) — the socket's own per-hello
  // revalidation keeps OTHER people's view of you fresh in real time,
  // this is what keeps your OWN Settings badge fresh on this device.
  useEffect(() => {
    if (!sessionToken) return;
    void fetchMe(sessionToken).then((result) => {
      if (result.ok) setVerified(result.user.verified);
    });
    // Phase 2 of session management: restore settings/preferences
    // (visibility, live cursors, animations, floating chat, photo)
    // from the server on every app open for a registered user —
    // "restore everything exactly as it was" from any device, not
    // just whatever this browser's local storage happens to have.
    void loadSettingsFromServer(sessionToken);
    // Extends the same idea to contacts — merges in accepted
    // connections the server remembers durably but this client's
    // local list might have lost (fresh device, or this one after a
    // reinstall). No-op for any connection already known locally.
    void restoreConnections();
  }, [sessionToken, setVerified, restoreConnections]);

  // Render's free tier spins the backend down after inactivity; the
  // first request wakes it, but the cold start can take 30–60s. A
  // cheap fetch on panel open starts that clock immediately (the
  // websocket retry loop alone also wakes it, just later), and the
  // grace timer below keeps the UI in "connecting" for the whole
  // cold-start window instead of flashing offline/demo instantly.
  useEffect(() => {
    void fetch(`${REALTIME_URL}/health`).catch(() => {});
  }, []);

  const live = useChatStore((state) => state.live);
  useEffect(() => {
    if (live) return;
    const timer = setTimeout(() => {
      if (!useChatStore.getState().live) {
        useChatStore.getState().setConnectionPhase("offline");
      }
    }, 60_000);
    return () => clearTimeout(timer);
  }, [live]);

  // Auto-presence from the background (calls flip the account Busy for
  // their duration, then restore) — mirror it into the panel's own
  // profile store + socket so every surface agrees.
  useEffect(() => {
    const listener = (message: { type?: string; presence?: "online" | "away" | "busy" | "offline" }) => {
      if (message?.type !== "tabcom:presence-auto" || !message.presence) return;
      useProfileStore.getState().setPresence(message.presence);
      updatePresence(message.presence);
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  // Announce "a Tabcom UI is open" to the background for as long as
  // this screen is mounted. Port disconnect on close is automatic and
  // instant — the background uses this to suppress notifications and
  // skip the pending queue while the user is already looking at chat.
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

  // Drain messages the background socket received while no UI was open.
  // The server keeps no history (zero retention), so this queue is the
  // only copy — apply into the store (receiveDm/receiveCommunityMessage
  // are id-idempotent, so overlap with the live socket is harmless),
  // then clear it, which also resets the action badge.
  useEffect(() => {
    const drain = async () => {
      try {
        const KEY = "tabcom:pending-inbox";
        const result = await browser.storage.local.get(KEY);
        const pending = (result[KEY] as
          | Array<{
              kind: "dm" | "community";
              from: Parameters<ReturnType<typeof useChatStore.getState>["receiveDm"]>[0];
              communityId?: string;
              message: Parameters<ReturnType<typeof useChatStore.getState>["receiveDm"]>[1];
            }>
          | undefined) ?? [];
        if (pending.length === 0) return;
        const store = useChatStore.getState();
        for (const item of pending) {
          if (item.kind === "dm") store.receiveDm(item.from, item.message);
          else if (item.communityId)
            store.receiveCommunityMessage(item.communityId, item.from, item.message);
        }
        await browser.storage.local.remove(KEY);
      } catch (error) {
        console.error("[tabcom] pending inbox drain failed:", error);
      }
    };
    void drain();
    // Coming back to an already-open panel counts as "reading" too —
    // re-drain so the badge/unread state clears without a remount.
    const onFocus = () => void drain();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    ensureSeeded();

    initRealtimeFromStores();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- connect once; visibility changes push via updateVisibility
  }, []);

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        {!inThread && <WorkspaceHeader title={titles[tab]} />}
        {!inThread && <NotificationPermissionBanner />}

        <div className="flex min-h-0 flex-1 flex-col">
          {tab === "inbox" && <InboxView />}
          {tab === "contacts" && <ContactsView />}
          {tab === "communities" && <CommunitiesView />}
          {tab === "settings" && <SettingsView />}
        </div>

        {!inThread && <TabBar />}
      </div>
    </AppShell>
  );
}
