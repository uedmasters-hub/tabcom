import { useEffect } from "react";

import AppShell from "../../components/layout/AppShell";
import { fetchMe } from "../../lib/auth-client";
import { initRealtime } from "../../lib/realtime";
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

  const username = useProfileStore((state) => state.username);
  const displayName = useProfileStore((state) => state.displayName);
  const avatarColor = useProfileStore((state) => state.avatarColor);
  const visibility = useProfileStore((state) => state.visibility);
  const photo = useProfileStore((state) => state.photo);
  const myPresence = useProfileStore((state) => state.presence);
  const sessionToken = useProfileStore((state) => state.sessionToken);
  const setVerified = useProfileStore((state) => state.setVerified);

  // Pick up a verification that happened elsewhere (another tab, or
  // between extension launches) — the socket's own per-hello
  // revalidation keeps OTHER people's view of you fresh in real time,
  // this is what keeps your OWN Settings badge fresh on this device.
  useEffect(() => {
    if (!sessionToken) return;
    void fetchMe(sessionToken).then((result) => {
      if (result.ok) setVerified(result.user.verified);
    });
  }, [sessionToken, setVerified]);

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
      sessionToken
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- connect once; visibility changes push via updateVisibility
  }, []);

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        <WorkspaceHeader title={titles[tab]} />

        <div className="flex min-h-0 flex-1 flex-col">
          {tab === "inbox" && <InboxView />}
          {tab === "contacts" && <ContactsView />}
          {tab === "communities" && <CommunitiesView />}
          {tab === "settings" && <SettingsView />}
        </div>

        <TabBar />
      </div>
    </AppShell>
  );
}
