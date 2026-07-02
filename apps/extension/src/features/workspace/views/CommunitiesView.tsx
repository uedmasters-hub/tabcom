import { Globe, MessageSquare, ShieldOff, Wifi } from "lucide-react";

import { Avatar, Button, EmptyState } from "../../../components/ui";
import { updateVisibility } from "../../../lib/realtime";
import { useChatStore } from "../../../stores/chat.store";
import { useProfileStore } from "../../../stores/profile.store";
import { useWorkspaceStore } from "../../../stores/workspace.store";

/**
 * Community — live discovery directory.
 *
 * Shows every PUBLIC user currently online (the server never sends
 * private users). If you are in private mode, discovery and messaging
 * are a complete end, so this surface explains that instead.
 */
export default function CommunitiesView() {
  const live = useChatStore((state) => state.live);
  const contacts = useChatStore((state) => state.contacts);
  const startConversation = useChatStore((state) => state.startConversation);
  const setTab = useWorkspaceStore((state) => state.setTab);

  const visibility = useProfileStore((state) => state.visibility);
  const setVisibilityLocal = useProfileStore((state) => state.setVisibility);

  const goPublic = () => {
    setVisibilityLocal("public");
    updateVisibility("public");
  };

  // Live, online people only — the discovery surface.
  const people = contacts.filter(
    (contact) => contact.id.startsWith("u-") && contact.presence === "online"
  );

  if (!live) {
    return (
      <EmptyState
        icon={<Wifi size={24} />}
        title="Offline — demo mode"
        description="Start the Tabcom realtime server and reopen the panel to discover people. Run: pnpm --filter @tabcom/backend dev"
      />
    );
  }

  if (visibility === "private") {
    return (
      <EmptyState
        icon={<ShieldOff size={24} />}
        title="You're in private mode"
        description="Private is a complete end: you don't appear here, you can't be messaged, and you can't message anyone. Go public to join the community."
        action={
          <Button size="md" onClick={goPublic}>
            Switch to public
          </Button>
        }
      />
    );
  }

  if (people.length === 0) {
    return (
      <EmptyState
        icon={<Globe size={24} />}
        title="No one else is online"
        description="You're visible to the community. People who sign in on public will appear here instantly — try another browser."
      />
    );
  }

  const message = (contactId: string) => {
    startConversation(contactId);
    setTab("inbox");
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <p className="border-b border-slate-100 px-6 py-3 text-xs font-medium uppercase tracking-wide text-slate-400">
        Online now — {people.length}
      </p>

      <ul>
        {people.map((contact) => (
          <li key={contact.id}>
            <button
              type="button"
              onClick={() => message(contact.id)}
              className="flex w-full items-center gap-3 border-b border-slate-100 px-6 py-4 text-left transition hover:bg-slate-50"
            >
              <div className="relative">
                <Avatar name={contact.name} color={contact.color} size="md" />
                <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
              </div>

              <span className="min-w-0 flex-1">
                <span className="block font-medium">{contact.name}</span>
                <span className="block text-sm text-slate-500">
                  @{contact.username}
                </span>
              </span>

              <MessageSquare size={18} className="shrink-0 text-slate-400" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
