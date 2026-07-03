import {
  BellOff,
  Bell,
  ExternalLink,
  Flag,
  LogOut,
  ShieldBan,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { browser } from "wxt/browser";

import { Avatar, Button, SectionLabel } from "../../../../components/ui";
import { useChatStore } from "../../../../stores/chat.store";
import { useProfileStore } from "../../../../stores/profile.store";
import type { Contact, Conversation } from "../../../../types/chat";

/**
 * Slide-over detail panel inside a chat.
 *
 * DM mode: the other person's public details (username always; real name
 * and photo because their profile is public), plus privacy controls —
 * mute, shared links, clear history, block/unblock, report.
 *
 * Community mode: members (admin badged), and for the admin an invite
 * manager restricted to accepted connections, with the 3-strike limit
 * surfaced through system notices.
 */
export default function InfoPanel({
  conversation,
  contact,
  onClose,
}: {
  conversation: Conversation;
  contact?: Contact;
  onClose: () => void;
}) {
  const username = useProfileStore((state) => state.username);

  const contacts = useChatStore((state) => state.contacts);
  const connections = useChatStore((state) => state.connections);
  const communities = useChatStore((state) => state.communities);
  const messages = useChatStore(
    (state) => state.messages[conversation.id] ?? null
  );
  const muted = useChatStore((state) => state.muted);

  const toggleMute = useChatStore((state) => state.toggleMute);
  const clearHistory = useChatStore((state) => state.clearHistory);
  const block = useChatStore((state) => state.block);
  const unblock = useChatStore((state) => state.unblock);
  const report = useChatStore((state) => state.report);
  const inviteToCommunity = useChatStore((state) => state.inviteToCommunity);
  const leaveCommunity = useChatStore((state) => state.leaveCommunity);
  const closeConversation = useChatStore((state) => state.closeConversation);

  const community = conversation.communityId
    ? communities[conversation.communityId]
    : undefined;

  const targetId = conversation.communityId ?? conversation.contactId ?? "";
  const isMutedTarget = muted.includes(targetId);

  const sharedLinks = (messages ?? []).filter(
    (message) => message.kind === "link" && message.url
  );

  const actionRow =
    "flex w-full items-center gap-3 px-6 py-3.5 text-left text-sm font-medium transition hover:bg-slate-50";

  return (
    <div className="absolute inset-0 z-20 flex flex-col overflow-y-auto bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <p className="text-sm font-semibold">
          {community ? "Community info" : "Contact info"}
        </p>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close info"
          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
        >
          <X size={18} />
        </button>
      </div>

      {/* Identity */}
      <div className="flex flex-col items-center px-6 py-6 text-center">
        {community ? (
          <>
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-900 text-2xl font-bold text-white">
              {community.name.charAt(0).toUpperCase()}
            </span>
            <h2 className="mt-3 text-lg font-bold">{community.name}</h2>
            <p className="text-sm text-slate-500">
              {community.members.length} member
              {community.members.length === 1 ? "" : "s"} · admin @
              {community.admin}
            </p>
          </>
        ) : contact ? (
          <>
            <Avatar
              name={contact.name}
              color={contact.color}
              photo={contact.photo}
              size="xl"
            />
            <h2 className="mt-3 text-lg font-bold">{contact.name}</h2>
            <p className="text-sm text-slate-500">@{contact.username}</p>
            <p className="mt-1 text-xs capitalize text-slate-400">
              {contact.presence} ·{" "}
              {contact.id.startsWith("u-")
                ? "Public profile"
                : "Demo contact"}{" "}
              · {connections[contact.username] ?? "connected"}
            </p>
          </>
        ) : null}
      </div>

      {/* Community members + admin invite manager */}
      {community && (
        <>
          <SectionLabel className="px-6">Members</SectionLabel>
          <ul className="mt-2">
            {community.members.map((member) => (
              <li
                key={member.username}
                className="flex items-center gap-3 px-6 py-2.5"
              >
                <Avatar name={member.name} color={member.color} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {member.name}
                  <span className="ml-1.5 text-xs font-normal text-slate-400">
                    @{member.username}
                  </span>
                </span>
                {member.username === community.admin && (
                  <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-400">
                    Admin
                  </span>
                )}
              </li>
            ))}
          </ul>

          {community.admin === username && (
            <>
              <SectionLabel className="mt-6 px-6">
                Add people (accepted connections)
              </SectionLabel>
              <ul className="mt-2">
                {contacts
                  .filter(
                    (c) =>
                      c.id.startsWith("u-") &&
                      connections[c.username] === "accepted" &&
                      !community.members.some(
                        (m) => m.username === c.username
                      )
                  )
                  .map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center gap-3 px-6 py-2.5"
                    >
                      <Avatar
                        name={c.name}
                        color={c.color}
                        photo={c.photo}
                        size="sm"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {c.name}
                      </span>
                      <Button
                        size="md"
                        variant="outline"
                        leftIcon={<UserPlus size={14} />}
                        onClick={() =>
                          inviteToCommunity(community.id, c.username)
                        }
                      >
                        Invite
                      </Button>
                    </li>
                  ))}
              </ul>
              <p className="px-6 pt-1 text-xs leading-5 text-slate-400">
                Invites require the person's acceptance. After 3 declined or
                revoked invites they can no longer be added to this
                community.
              </p>
            </>
          )}
        </>
      )}

      {/* Shared links */}
      {sharedLinks.length > 0 && (
        <>
          <SectionLabel className="mt-6 px-6">
            Shared links · {sharedLinks.length}
          </SectionLabel>
          <ul className="mt-2">
            {sharedLinks.slice(-8).map((message) => (
              <li key={message.id}>
                <button
                  type="button"
                  onClick={() => browser.tabs.create({ url: message.url })}
                  className="flex w-full items-start gap-2.5 px-6 py-2.5 text-left transition hover:bg-slate-50"
                >
                  <ExternalLink
                    size={15}
                    className="mt-0.5 shrink-0 text-slate-400"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {message.text}
                    </span>
                    <span className="block truncate text-xs text-slate-400">
                      {message.url}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Privacy & chat actions */}
      <SectionLabel className="mt-6 px-6">Privacy & chat</SectionLabel>
      <div className="mt-2 pb-8">
        <button
          type="button"
          className={actionRow}
          onClick={() => toggleMute(targetId)}
        >
          {isMutedTarget ? (
            <Bell size={17} className="text-slate-400" />
          ) : (
            <BellOff size={17} className="text-slate-400" />
          )}
          {isMutedTarget ? "Unmute notifications" : "Mute notifications"}
        </button>

        <button
          type="button"
          className={actionRow}
          onClick={() => clearHistory(conversation.id)}
        >
          <Trash2 size={17} className="text-slate-400" />
          Clear chat history (this device)
        </button>

        {contact?.id.startsWith("u-") &&
          (connections[contact.username] === "blocked" ? (
            <button
              type="button"
              className={actionRow}
              onClick={() => unblock(contact)}
            >
              <ShieldBan size={17} className="text-slate-400" />
              Unblock @{contact.username}
            </button>
          ) : (
            <button
              type="button"
              className={`${actionRow} text-red-600`}
              onClick={() => block(contact)}
            >
              <ShieldBan size={17} />
              Block @{contact.username}
            </button>
          ))}

        {contact?.id.startsWith("u-") && (
          <button
            type="button"
            className={`${actionRow} text-red-600`}
            onClick={() => report(contact, "Reported from contact info")}
          >
            <Flag size={17} />
            Report @{contact.username}
          </button>
        )}

        {community && community.admin !== username && (
          <button
            type="button"
            className={`${actionRow} text-red-600`}
            onClick={() => {
              leaveCommunity(community.id);
              closeConversation();
            }}
          >
            <LogOut size={17} />
            Leave community
          </button>
        )}
      </div>
    </div>
  );
}
