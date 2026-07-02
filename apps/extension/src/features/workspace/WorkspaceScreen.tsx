import { useEffect } from "react";

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

  useEffect(() => {
    ensureSeeded();

    initRealtime(
      { username, name: displayName, color: avatarColor },
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
      }
    );
  }, [ensureSeeded, username, displayName, avatarColor]);

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
