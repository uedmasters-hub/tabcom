import {
  BellOff,
  Bell,
  Check,
  Crown,
  EyeOff,
  Eye,
  ExternalLink,
  Flag,
  LogOut,
  Pencil,
  ShieldBan,
  Trash2,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import { useState } from "react";
import { browser } from "wxt/browser";

import { Avatar, Button, SectionLabel } from "../../../../components/ui";
import { cn } from "../../../../lib/cn";
import { useChatStore } from "../../../../stores/chat.store";
import { useProfileStore } from "../../../../stores/profile.store";
import { contactLabel } from "../../../../types/chat";
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
  const hiddenFrom = useChatStore((state) => state.hiddenFrom);

  const toggleMute = useChatStore((state) => state.toggleMute);
  const toggleHidePresence = useChatStore((state) => state.toggleHidePresence);
  const removeContact = useChatStore((state) => state.removeContact);
  const clearHistory = useChatStore((state) => state.clearHistory);
  const block = useChatStore((state) => state.block);
  const unblock = useChatStore((state) => state.unblock);
  const report = useChatStore((state) => state.report);
  const inviteToCommunity = useChatStore((state) => state.inviteToCommunity);
  const leaveCommunity = useChatStore((state) => state.leaveCommunity);
  const removeCommunityMember = useChatStore(
    (state) => state.removeCommunityMember
  );
  const cancelCommunityInvite = useChatStore(
    (state) => state.cancelCommunityInvite
  );
  const renameCommunity = useChatStore((state) => state.renameCommunity);
  const transferCommunityAdmin = useChatStore(
    (state) => state.transferCommunityAdmin
  );
  const deleteCommunity = useChatStore((state) => state.deleteCommunity);
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
            <h2 className="mt-3 text-lg font-bold">{contactLabel(contact)}</h2>
            <p className="text-sm text-slate-500">
              @{contact.username}
              {contact.alias && ` · ${contact.name}`}
            </p>
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

      {/* Community name — admin can rename inline */}
      {community && community.admin === username && (
        <CommunityNameEditor
          community={community}
          onRename={(name) => renameCommunity(community.id, name)}
        />
      )}

      {/* Members, with admin-only remove/promote controls */}
      {community && (
        <>
          <SectionLabel className="px-6">
            Members · {community.members.length}
          </SectionLabel>
          <ul className="mt-2">
            {community.members.map((member) => {
              const isAdmin = member.username === community.admin;
              const isSelf = member.username === username;
              const iAmAdmin = community.admin === username;

              return (
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

                  {isAdmin && (
                    <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-400">
                      Admin
                    </span>
                  )}

                  {iAmAdmin && !isAdmin && !isSelf && (
                    <MemberActions
                      onPromote={() =>
                        transferCommunityAdmin(community.id, member.username)
                      }
                      onRemove={() =>
                        removeCommunityMember(community.id, member.username)
                      }
                    />
                  )}
                </li>
              );
            })}
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
                      ) &&
                      !community.pendingInvites.some(
                        (p) => p.username === c.username
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

              {community.pendingInvites.length > 0 && (
                <>
                  <SectionLabel className="mt-6 px-6">
                    Pending invites · {community.pendingInvites.length}
                  </SectionLabel>
                  <ul className="mt-2">
                    {community.pendingInvites.map((invite) => (
                      <li
                        key={invite.username}
                        className="flex items-center gap-3 px-6 py-2.5"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-500">
                          @{invite.username}
                          <span className="ml-1.5 text-xs font-normal text-slate-400">
                            waiting to respond
                          </span>
                        </span>
                        <button
                          type="button"
                          title="Cancel invite"
                          onClick={() =>
                            cancelCommunityInvite(
                              community.id,
                              invite.username
                            )
                          }
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                        >
                          <X size={15} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
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
            className={actionRow}
            onClick={() => toggleHidePresence(contact)}
          >
            {hiddenFrom.includes(contact.id) ? (
              <Eye size={17} className="text-slate-400" />
            ) : (
              <EyeOff size={17} className="text-slate-400" />
            )}
            {hiddenFrom.includes(contact.id)
              ? `Show my presence to @${contact.username}`
              : `Appear offline to @${contact.username}`}
          </button>
        )}

        {contact?.id.startsWith("u-") && (
          <button
            type="button"
            className={`${actionRow} text-red-600`}
            onClick={() => {
              removeContact(contact.id);
              onClose();
            }}
          >
            <Trash2 size={17} />
            Remove contact
          </button>
        )}

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

        {community && community.admin === username && (
          <DeleteCommunityButton
            actionRow={actionRow}
            onDelete={() => {
              deleteCommunity(community.id);
              closeConversation();
            }}
          />
        )}
      </div>
    </div>
  );
}

function CommunityNameEditor({
  community,
  onRename,
}: {
  community: { id: string; name: string };
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(community.name);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(community.name);
          setEditing(true);
        }}
        className="mx-6 mt-1 flex items-center gap-1.5 text-xs font-medium text-slate-400 transition hover:text-slate-600"
      >
        <Pencil size={12} />
        Rename community
      </button>
    );
  }

  const submit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== community.name) onRename(trimmed);
    setEditing(false);
  };

  return (
    <div className="mx-6 mt-1 flex items-center gap-2">
      <input
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") submit();
          if (event.key === "Escape") setEditing(false);
        }}
        className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 text-sm outline-none focus:border-blue-500"
      />
      <button
        type="button"
        onClick={submit}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white"
      >
        <Check size={14} />
      </button>
    </div>
  );
}

function MemberActions({
  onPromote,
  onRemove,
}: {
  onPromote: () => void;
  onRemove: () => void;
}) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  if (confirmingRemove) {
    return (
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => {
            onRemove();
            setConfirmingRemove(false);
          }}
          className="rounded-lg bg-red-600 px-2 py-1 text-[11px] font-semibold text-white"
        >
          Remove?
        </button>
        <button
          type="button"
          onClick={() => setConfirmingRemove(false)}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        title="Make admin"
        onClick={onPromote}
        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-amber-50 hover:text-amber-600"
      >
        <Crown size={15} />
      </button>
      <button
        type="button"
        title="Remove from community"
        onClick={() => setConfirmingRemove(true)}
        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
      >
        <UserMinus size={15} />
      </button>
    </div>
  );
}

function DeleteCommunityButton({
  actionRow,
  onDelete,
}: {
  actionRow: string;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="flex gap-2 px-6 py-2">
        <button
          type="button"
          onClick={onDelete}
          className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white"
        >
          Confirm delete — this can't be undone
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-500"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={cn(actionRow, "text-red-600")}
      onClick={() => setConfirming(true)}
    >
      <Trash2 size={17} />
      Delete community
    </button>
  );
}
