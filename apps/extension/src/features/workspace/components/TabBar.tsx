import { Globe, Inbox, Settings, Users } from "lucide-react";

import { cn } from "../../../lib/cn";
import {
  useWorkspaceStore,
  type WorkspaceTab,
} from "../../../stores/workspace.store";

const tabs: Array<{
  id: WorkspaceTab;
  label: string;
  icon: typeof Inbox;
}> = [
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "contacts", label: "Contacts", icon: Users },
  { id: "communities", label: "Communities", icon: Globe },
  { id: "settings", label: "Settings", icon: Settings },
];

/** Bottom navigation for the workspace shell. */
export default function TabBar() {
  const tab = useWorkspaceStore((state) => state.tab);
  const setTab = useWorkspaceStore((state) => state.setTab);

  return (
    <nav
      aria-label="Workspace"
      className="grid grid-cols-4 border-t border-slate-200 bg-white"
    >
      {tabs.map(({ id, label, icon: Icon }) => {
        const isActive = tab === id;

        return (
          <button
            key={id}
            type="button"
            aria-current={isActive ? "page" : undefined}
            onClick={() => setTab(id)}
            className={cn(
              "flex flex-col items-center gap-1 py-3 text-[11px] font-medium transition-colors",
              isActive
                ? "text-slate-900"
                : "text-slate-400 hover:text-slate-600"
            )}
          >
            <Icon size={20} strokeWidth={isActive ? 2.4 : 2} />
            {label}
          </button>
        );
      })}
    </nav>
  );
}
