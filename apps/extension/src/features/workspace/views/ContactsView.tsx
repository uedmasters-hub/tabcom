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

/**
 * Contacts — strictly people you've CONNECTED with (accepted) and
 * actually chatted with, plus demo contacts in offline mode.
 * Discovery of new people lives in Communities.
 */
export default function ContactsView() {
  const contacts = useChatStore((state) => state.contacts);
  const connections = useChatStore((state) => state.connections);
  const conversations = useChatStore((state) => state.conversations);
  const messages = useChatStore((state) => state.messages);
  const startConversation = useChatStore((state) => state.startConversation);
  const setTab = useWorkspaceStore((state) => state.setTab);

  const hasChatted = (contactId: string) => {
    const conversation = conversations.find(
      (item) => item.contactId === contactId
    );
    if (!conversation) return false;
    return (messages[conversation.id] ?? []).some(
      (message) => message.kind !== "system"
    );
  };

  const list = contacts.filter((contact) =>
    contact.id.startsWith("u-")
      ? connections[contact.username] === "accepted" && hasChatted(contact.id)
      : true
  );

  if (list.length === 0) {
    return (
      <EmptyState
        icon={<Users size={24} />}
        title="No contacts yet"
        description="People appear here once you've connected AND exchanged messages. Find people in Communities → Discover."
      />
    );
  }

  const message = (contactId: string) => {
    startConversation(contactId);
    setTab("inbox");
  };

  return (
    <ul className="flex-1 overflow-y-auto">
      {list.map((contact) => (
        <li key={contact.id}>
          <button
            type="button"
            onClick={() => message(contact.id)}
            className="flex w-full items-center gap-3 border-b border-slate-100 px-6 py-4 text-left transition hover:bg-slate-50"
          >
            <div className="relative">
              <Avatar
                name={contact.name}
                color={contact.color}
                photo={contact.photo}
                size="md"
              />
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
