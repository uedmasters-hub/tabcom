import { useEffect } from "react";
import { browser } from "wxt/browser";

import AppShell from "../../components/layout/AppShell";
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

  // Drain messages the background buffered while only the pill was
  // online (zero server retention — they exist nowhere else), then
  // honor a chat target chosen from the pill's chat menu.
  useEffect(() => {
    let cancelled = false;

    const drainAndTarget = async () => {
      try {
        const result = await browser.storage.local.get([
          "tabcom:inbox-buffer",
          "tabcom:open-target",
        ]);
        if (cancelled) return;

        const rawBuffer = result["tabcom:inbox-buffer"] as string | undefined;
        if (rawBuffer) {
          await browser.storage.local.remove("tabcom:inbox-buffer");
          const state = useChatStore.getState();
          for (const entry of JSON.parse(rawBuffer)) {
            if (entry.kind === "dm") {
              state.receiveDm(entry.from, entry.message);
            } else if (entry.kind === "community") {
              state.receiveCommunityMessage(
                entry.communityId,
                entry.from,
                entry.message
              );
            }
          }
        }

        const rawTarget = result["tabcom:open-target"] as string | undefined;
        if (rawTarget) {
          await browser.storage.local.remove("tabcom:open-target");
          const target = JSON.parse(rawTarget) as {
            kind: "dm" | "community";
            id: string;
          };
          const { conversations, contacts, openConversation } =
            useChatStore.getState();
          const conversation =
            target.kind === "community"
              ? conversations.find((c) => c.communityId === target.id)
              : conversations.find((c) => {
                  const contact = contacts.find(
                    (item) => item.id === c.contactId
                  );
                  return contact?.username === target.id;
                });
          if (conversation) openConversation(conversation.id);
        }
      } catch {
        // best effort — the panel still works without either
      }
    };

    void drainAndTarget();
    return () => {
      cancelled = true;
    };
  }, []);

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

        onCommunityMessage: (communityId, from, message) =>
          useChatStore.getState().receiveCommunityMessage(communityId, from, message),

        onCommunityError: (payload) =>
          useChatStore.getState().receiveCommunityError(payload),
      }
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
