import { useEffect } from "react";

import AppShell from "../../components/layout/AppShell";
import { useChatStore } from "../../stores/chat.store";
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
 * Views are placeholders that fill in through Phase 2 and 3.
 */
export default function WorkspaceScreen() {
  const tab = useWorkspaceStore((state) => state.tab);
  const ensureSeeded = useChatStore((state) => state.ensureSeeded);

  useEffect(() => {
    ensureSeeded();
  }, [ensureSeeded]);

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
