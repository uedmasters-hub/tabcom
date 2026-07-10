import { Bell, BellOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "../../lib/cn";
import { useChatStore } from "../../stores/chat.store";
import { useWorkspaceStore } from "../../stores/workspace.store";
import { contactLabel } from "../../types/chat";
import { formatRelativeTime } from "../../utils/time";
import { Avatar } from "../ui";

interface FeedItem {
  key: string;
  at: number;
  unreadCount: number;
  title: string;
  preview: string;
  avatar:
    | { kind: "community"; initial: string }
    | { kind: "contact"; name: string; color: string; photo?: string };
  onSelect: () => void;
}

/**
 * Global notification bell — shown in every header, main pages and
 * thread pages alike. Aggregates unread conversations (DM + community)
 * and pending community invites into one dropdown; picking an item
 * navigates straight to it (thread or Communities tab).
 *
 * Deliberately reads from existing store state rather than keeping its
 * own copy — conversations[].unread and communityInvites are already
 * the source of truth (and already persisted), so there's nothing new
 * to keep in sync and nothing new that can drift out of sync.
 */
export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const conversations = useChatStore((state) => state.conversations);
  const contacts = useChatStore((state) => state.contacts);
  const communities = useChatStore((state) => state.communities);
  const messages = useChatStore((state) => state.messages);
  const communityInvites = useChatStore((state) => state.communityInvites);
  const openConversation = useChatStore((state) => state.openConversation);
  const setTab = useWorkspaceStore((state) => state.setTab);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const { feed, badgeCount } = useMemo(() => {
    const conversationItems: FeedItem[] = conversations
      .filter((conversation) => conversation.unread > 0)
      .map((conversation) => {
        const community = conversation.communityId
          ? communities[conversation.communityId]
          : undefined;
        const contact = conversation.contactId
          ? contacts.find((item) => item.id === conversation.contactId)
          : undefined;

        if (!community && !contact) return null;

        const thread = messages[conversation.id] ?? [];
        const last = thread[thread.length - 1];
        const preview = last
          ? last.kind === "link"
            ? `🔗 ${last.text}`
            : last.kind === "system"
              ? last.text
              : community && last.authorName
                ? `${last.authorName.split(" ")[0]}: ${last.text}`
                : last.text
          : "New activity";

        const item: FeedItem = {
          key: `conversation-${conversation.id}`,
          at: conversation.lastMessageAt,
          unreadCount: conversation.unread,
          title: community ? community.name : contactLabel(contact!),
          preview,
          avatar: community
            ? { kind: "community", initial: community.name.charAt(0).toUpperCase() }
            : {
                kind: "contact",
                name: contact!.name,
                color: contact!.color,
                photo: contact!.photo,
              },
          onSelect: () => {
            setTab("inbox");
            openConversation(conversation.id);
            setOpen(false);
          },
        };
        return item;
      })
      .filter((item): item is FeedItem => item !== null);

    const inviteItems: FeedItem[] = Object.values(communityInvites).map((invite) => ({
      key: `invite-${invite.community.id}`,
      // Invites don't carry their own timestamp; keep them pinned above
      // conversations by sorting them first rather than guessing an age.
      at: Infinity,
      unreadCount: 1,
      title: invite.community.name,
      preview: `Invite from @${invite.from.username}`,
      avatar: { kind: "community", initial: invite.community.name.charAt(0).toUpperCase() },
      onSelect: () => {
        setTab("communities");
        setOpen(false);
      },
    }));

    const combined = [...inviteItems, ...conversationItems].sort((a, b) => b.at - a.at);
    const count =
      conversationItems.reduce((sum, item) => sum + item.unreadCount, 0) + inviteItems.length;

    return { feed: combined, badgeCount: count };
  }, [conversations, contacts, communities, messages, communityInvites, openConversation, setTab]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Notifications"
        aria-expanded={open}
        aria-haspopup="true"
        className="relative rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
      >
        <Bell size={18} />
        {badgeCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
            {badgeCount > 9 ? "9+" : badgeCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Notifications"
          className="absolute right-0 top-11 z-30 max-h-80 w-72 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg"
        >
          <p className="px-4 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Notifications
          </p>

          {feed.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <BellOff size={22} className="text-slate-300" />
              <p className="text-xs text-slate-400">You're all caught up.</p>
            </div>
          ) : (
            <ul>
              {feed.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={item.onSelect}
                    className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition hover:bg-slate-50"
                  >
                    {item.avatar.kind === "community" ? (
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                        {item.avatar.initial}
                      </span>
                    ) : (
                      <Avatar
                        name={item.avatar.name}
                        color={item.avatar.color}
                        photo={item.avatar.photo}
                        size="sm"
                      />
                    )}

                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[13px] font-semibold">{item.title}</span>
                        {Number.isFinite(item.at) && (
                          <span className="shrink-0 text-[11px] text-slate-400">
                            {formatRelativeTime(item.at)}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">
                        {item.preview}
                      </span>
                    </span>

                    <span
                      className={cn(
                        "mt-0.5 flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-semibold text-white",
                        item.unreadCount === 0 && "invisible"
                      )}
                    >
                      {item.unreadCount}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
