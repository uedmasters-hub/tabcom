import { Inbox as InboxIcon } from "lucide-react";

import { Avatar, CommunityAvatar, EmptyState } from "../../../../components/ui";
import { useChatStore } from "../../../../stores/chat.store";
import { formatRelativeTime } from "../../../../utils/time";

export default function ConversationList() {
  const conversations = useChatStore((state) => state.conversations);
  const contacts = useChatStore((state) => state.contacts);
  const communities = useChatStore((state) => state.communities);
  const messages = useChatStore((state) => state.messages);
  const muted = useChatStore((state) => state.muted);
  const openConversation = useChatStore((state) => state.openConversation);

  if (conversations.length === 0) {
    return (
      <EmptyState
        icon={<InboxIcon size={24} />}
        title="No conversations yet"
        description="Discover people in Communities, send a connection request, and chat once they accept."
      />
    );
  }

  return (
    <ul className="flex-1 overflow-y-auto">
      {conversations.map((conversation) => {
        const community = conversation.communityId
          ? communities[conversation.communityId]
          : undefined;
        const contact = conversation.contactId
          ? contacts.find((item) => item.id === conversation.contactId)
          : undefined;

        if (!community && !contact) return null;

        const thread = messages[conversation.id] ?? [];
        const last = thread[thread.length - 1];
        const hasUnread = conversation.unread > 0;
        const targetId =
          conversation.communityId ?? conversation.contactId ?? "";
        const isMutedRow = muted.includes(targetId);

        return (
          <li key={conversation.id}>
            <button
              type="button"
              onClick={() => openConversation(conversation.id)}
              className="flex w-full items-center gap-3 border-b border-slate-100 px-6 py-4 text-left transition hover:bg-slate-50"
            >
              {community ? (
                <CommunityAvatar
                  name={community.name}
                  imageVersion={community.imageVersion}
                  communityId={community.id}
                  size="md"
                />
              ) : (
                <Avatar
                  name={contact!.name}
                  color={contact!.color}
                  photo={contact!.photo}
                  size="md"
                />
              )}

              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={hasUnread ? "font-semibold" : "font-medium"}>
                    {community ? community.name : contact!.name}
                    {isMutedRow && (
                      <span className="ml-1.5 text-xs font-normal text-slate-400">
                        🔕
                      </span>
                    )}
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
                          : community && last.authorName
                            ? `${last.authorName.split(" ")[0]}: ${last.text}`
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
