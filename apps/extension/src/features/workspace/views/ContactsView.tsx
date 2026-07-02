import { Users } from "lucide-react";

import { Avatar, EmptyState } from "../../../components/ui";
import { cn } from "../../../lib/cn";
import { useChatStore } from "../../../stores/chat.store";
import { useWorkspaceStore } from "../../../stores/workspace.store";

const presenceColors = {
  online: "bg-emerald-500",
  away: "bg-amber-400",
  busy: "bg-red-500",
  offline: "bg-slate-300",
} as const;

export default function ContactsView() {
  const contacts = useChatStore((state) => state.contacts);
  const startConversation = useChatStore((state) => state.startConversation);
  const setTab = useWorkspaceStore((state) => state.setTab);

  if (contacts.length === 0) {
    return (
      <EmptyState
        icon={<Users size={24} />}
        title="No contacts yet"
        description="Invite people or discover public profiles to start building your network."
      />
    );
  }

  const message = (contactId: string) => {
    startConversation(contactId);
    setTab("inbox");
  };

  return (
    <ul className="flex-1 overflow-y-auto">
      {contacts.map((contact) => (
        <li key={contact.id}>
          <button
            type="button"
            onClick={() => message(contact.id)}
            className="flex w-full items-center gap-3 border-b border-slate-100 px-6 py-4 text-left transition hover:bg-slate-50"
          >
            <div className="relative">
              <Avatar name={contact.name} color={contact.color} size="md" />
              <span
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white",
                  presenceColors[contact.presence]
                )}
              />
            </div>

            <span className="min-w-0 flex-1">
              <span className="block font-medium">{contact.name}</span>
              <span className="block text-sm text-slate-500">
                @{contact.username} · {contact.presence}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
