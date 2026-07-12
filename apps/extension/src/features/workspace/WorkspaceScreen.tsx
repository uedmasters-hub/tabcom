import { useEffect } from "react";

import AppShell from "../../components/layout/AppShell";
import { fetchMe } from "../../lib/auth-client";
import { loadSettingsFromServer } from "../../lib/settings-sync";
import { disconnectAllContexts, initRealtime } from "../../lib/realtime";
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

  useEffect(() => {
    ensureSeeded();

    initRealtime(
      {
        username,
        name: displayName,
        color: avatarColor,
        visibility,
        photo,
        presence: myPresence,
      },
      {
        onConnectionChange: (live) =>
          useChatStore.getState().setLiveStatus(live),

        onUsernameAssigned: (assignedUsername) => {
          const profile = useProfileStore.getState();
          // Only guests can actually hit this (see realtime.ts's
          // comment on the ack) — but the check is by identity, not by
          // trusting that invariant blindly: only ever touch the
          // locally-stored username if we're not authenticated, so a
          // real account's username can never be silently overwritten.
          if (!profile.sessionToken) {
            profile.setIdentity({
              displayName: profile.displayName,
              username: assignedUsername,
            });
          }
        },

        onRoster: (users) =>
          useChatStore
            .getState()
            .applyRoster(users.filter((user) => user.username !== username)),

        onDm: (from, message) =>
          useChatStore.getState().receiveDm(from, message),

        onDmEdited: (from, messageId, text, editedAt) =>
          useChatStore.getState().receiveDmEdited(from, messageId, text, editedAt),

        onDmDeleted: (from, messageId) =>
          useChatStore.getState().receiveDmDeleted(from, messageId),

        onDmReaction: (from, messageId, emoji) =>
          useChatStore.getState().receiveDmReaction(from, messageId, emoji),

        onDmReadReceipt: (from, messageId, readAt) =>
          useChatStore.getState().receiveDmReadReceipt(from, messageId, readAt),

        onCommunityMessageEdited: (communityId, from, messageId, text, editedAt) =>
          useChatStore
            .getState()
            .receiveCommunityMessageEdited(communityId, from, messageId, text, editedAt),

        onCommunityMessageDeleted: (communityId, from, messageId) =>
          useChatStore
            .getState()
            .receiveCommunityMessageDeleted(communityId, from, messageId),

        onCommunityReaction: (communityId, from, messageId, emoji) =>
          useChatStore
            .getState()
            .receiveCommunityReaction(communityId, from, messageId, emoji),

        onTyping: (fromUsername) =>
          useChatStore.getState().receiveTyping(fromUsername),

        onDmError: (toUsername, reason) =>
          useChatStore.getState().receiveDmError(toUsername, reason),

        onConnections: (snapshot) =>
          useChatStore.getState().receiveConnections(snapshot),

        onConnectRequest: (from) =>
          useChatStore.getState().receiveConnectRequest(from),

        onConnectUpdate: (username, status) =>
          useChatStore.getState().receiveConnectUpdate(username, status),

        onConnectRequestError: (username, reason) =>
          useChatStore.getState().receiveConnectRequestError(username, reason),

        onCommunities: (list) =>
          useChatStore.getState().receiveCommunities(list),

        onCommunityUpdate: (community) =>
          useChatStore.getState().receiveCommunityUpdate(community),

        onCommunityInvite: (community, from, attempt) =>
          useChatStore.getState().receiveCommunityInvite(community, from, attempt),

        onCommunityDeclined: (payload) =>
          useChatStore.getState().receiveCommunityDeclined(payload),

        onCommunityLeft: (communityId) =>
          useChatStore.getState().receiveCommunityLeft(communityId),

        onCommunityDeleted: (communityId) =>
          useChatStore.getState().receiveCommunityDeleted(communityId),

        onCommunityInviteCancelled: (communityId) =>
          useChatStore.getState().receiveCommunityInviteCancelled(communityId),

        onCommunityMessage: (communityId, from, message) =>
          useChatStore.getState().receiveCommunityMessage(communityId, from, message),

        onCommunityError: (payload) =>
          useChatStore.getState().receiveCommunityError(payload),
      },
      sessionToken,
      guestInstanceId
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- connect once; visibility changes push via updateVisibility
  }, []);

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        {!inThread && <WorkspaceHeader title={titles[tab]} />}

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
