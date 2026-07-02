import { Inbox as InboxIcon } from "lucide-react";

import { Avatar, EmptyState } from "../../../../components/ui";
import { useChatStore } from "../../../../stores/chat.store";
import { formatRelativeTime } from "../../../../utils/time";

export default function ConversationList() {
  const conversations = useChatStore((state) => state.conversations);
  const contacts = useChatStore((state) => state.contacts);
  const messages = useChatStore((state) => state.messages);
  const openConversation = useChatStore((state) => state.openConversation);

  if (conversations.length === 0) {
    return (
      <EmptyState
        icon={<InboxIcon size={24} />}
        title="No conversations yet"
        description="Start one from the Contacts tab — pick a person and say hi."
      />
    );
  }

  return (
    <ul className="flex-1 overflow-y-auto">
      {conversations.map((conversation) => {
        const contact = contacts.find(
          (item) => item.id === conversation.contactId
        );
        if (!contact) return null;

        const thread = messages[conversation.id] ?? [];
        const last = thread[thread.length - 1];
        const hasUnread = conversation.unread > 0;

        return (
          <li key={conversation.id}>
            <button
              type="button"
              onClick={() => openConversation(conversation.id)}
              className="flex w-full items-center gap-3 border-b border-slate-100 px-6 py-4 text-left transition hover:bg-slate-50"
            >
              <Avatar name={contact.name} color={contact.color} size="md" />

              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span
                    className={
                      hasUnread ? "font-semibold" : "font-medium"
                    }
                  >
                    {contact.name}
                  </span>

                  <span className="shrink-0 text-xs text-slate-400">
                    {formatRelativeTime(conversation.lastMessageAt)}
                  </span>
                </span>

                <span className="mt-0.5 flex items-center justify-between gap-2">
                  <span
                    className={`truncate text-sm ${
                      hasUnread
                        ? "font-medium text-slate-700"
                        : "text-slate-500"
                    }`}
                  >
                    {last
                      ? last.kind === "link"
                        ? `🔗 ${last.text}`
                        : last.kind === "system"
                          ? `⚠︎ ${last.text}`
                          : last.text
                      : "Say hi 👋"}
                  </span>

                  {hasUnread && (
                    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[11px] font-semibold text-white">
                      {conversation.unread}
                    </span>
                  )}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
