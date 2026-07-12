import {
  Check,
  ChevronRight,
  Clock,
  Crown,
  LogOut,
  Pencil,
  Trash2,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Avatar } from "../../../../components/ui";
import { cn } from "../../../../lib/cn";
import type { CommunityErrorReason } from "../../../../lib/realtime";
import { useChatStore } from "../../../../stores/chat.store";
import { useProfileStore } from "../../../../stores/profile.store";
import type { Community } from "../../../../types/chat";

const NAME_MAX_LENGTH = 60; // mirrors the server's community_rename truncation

const INVITE_ERROR_MESSAGES: Record<CommunityErrorReason, string> = {
  not_connected: "You can only invite accepted connections.",
  invite_limit: "This person has reached the 3-invite limit for this community.",
  already_pending: "This person already has a pending invite.",
};

/**
 * Community management — one continuous page, not a tab switcher.
 * Replaces the earlier 4-tab version (Overview/Members/Invites/Danger
 * zone) with a single scroll: header identity + rename + delete, the
 * admin, current members (with hover-revealed promote/remove), and one
 * unified "add people" list mixing eligible contacts and pending
 * invites together rather than splitting them into their own tab.
 *
 * Every underlying capability is unchanged from the previous version —
 * this is purely an information-architecture consolidation, not new
 * backend functionality.
 */
export default function CommunityManageView({
  community,
  onClose,
}: {
  community: Community;
  onClose: () => void;
}) {
  const username = useProfileStore((state) => state.username);
  const isAdmin = community.admin === username;

  const contacts = useChatStore((state) => state.contacts);
  const connections = useChatStore((state) => state.connections);
  const renameCommunity = useChatStore((state) => state.renameCommunity);
  const transferCommunityAdmin = useChatStore((state) => state.transferCommunityAdmin);
  const removeCommunityMember = useChatStore((state) => state.removeCommunityMember);
  const inviteToCommunity = useChatStore((state) => state.inviteToCommunity);
  const cancelCommunityInvite = useChatStore((state) => state.cancelCommunityInvite);
  const leaveCommunity = useChatStore((state) => state.leaveCommunity);
  const deleteCommunity = useChatStore((state) => state.deleteCommunity);
  const closeConversation = useChatStore((state) => state.closeConversation);
  const communityActionError = useChatStore((state) => state.communityActionError);
  const clearCommunityActionError = useChatStore(
    (state) => state.clearCommunityActionError
  );

  useEffect(() => clearCommunityActionError, [clearCommunityActionError]);

  // ---- Rename (header) ---------------------------------------------
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(community.name);
  const [nameError, setNameError] = useState<string | null>(null);

  const startRename = () => {
    setNameDraft(community.name);
    setNameError(null);
    setRenaming(true);
  };
  const submitRename = () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setNameError("Name can't be empty.");
      return;
    }
    if (trimmed !== community.name) renameCommunity(community.id, trimmed);
    setRenaming(false);
  };

  // ---- Delete (header) ----------------------------------------------
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const handleDelete = () => {
    deleteCommunity(community.id);
    onClose();
    closeConversation();
  };

  // ---- Leave (non-admin) ---------------------------------------------
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const handleLeave = () => {
    leaveCommunity(community.id);
    onClose();
    closeConversation();
  };

  // ---- Invite optimistic state ---------------------------------------
  const [invitingUsername, setInvitingUsername] = useState<string | null>(null);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!communityActionError) return;
    if (
      community.pendingInvites.some(
        (invite) => invite.username === communityActionError.username
      )
    ) {
      clearCommunityActionError();
    }
  }, [community.pendingInvites, communityActionError, clearCommunityActionError]);

  const handleInvite = (inviteUsername: string) => {
    setInvitingUsername(inviteUsername);
    inviteToCommunity(community.id, inviteUsername);
    pendingTimer.current = setTimeout(
      () =>
        setInvitingUsername((current) => (current === inviteUsername ? null : current)),
      2500
    );
  };

  const adminMember = community.members.find((m) => m.username === community.admin);
  const otherMembers = community.members.filter((m) => m.username !== community.admin);

  const eligibleContacts = contacts.filter(
    (contact) =>
      contact.id.startsWith("u-") &&
      connections[contact.username] === "accepted" &&
      !community.members.some((m) => m.username === contact.username) &&
      !community.pendingInvites.some((p) => p.username === contact.username)
  );

  return (
    <div className="absolute inset-0 z-20 flex flex-col overflow-hidden bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
        >
          <ChevronRight size={18} className="rotate-180" />
        </button>

        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
          {community.name.charAt(0).toUpperCase()}
        </span>

        {renaming ? (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <input
              autoFocus
              value={nameDraft}
              maxLength={NAME_MAX_LENGTH}
              onChange={(event) => {
                setNameDraft(event.target.value);
                setNameError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitRename();
                if (event.key === "Escape") setRenaming(false);
              }}
              aria-invalid={nameError ? true : undefined}
              className={cn(
                "h-8 min-w-0 flex-1 rounded-lg border px-2 text-sm outline-none",
                nameError ? "border-red-400" : "border-slate-200 focus:border-blue-500"
              )}
            />
            <button
              type="button"
              onClick={submitRename}
              aria-label="Save name"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white"
            >
              <Check size={14} />
            </button>
            <button
              type="button"
              onClick={() => setRenaming(false)}
              aria-label="Cancel"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={isAdmin ? startRename : undefined}
            disabled={!isAdmin}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          >
            <span className="truncate text-sm font-semibold">{community.name}</span>
            {isAdmin && <Pencil size={13} className="shrink-0 text-slate-300" />}
          </button>
        )}

        {isAdmin &&
          !renaming &&
          (confirmingDelete ? (
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={handleDelete}
                className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white"
              >
                Delete?
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                aria-label="Cancel"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
              >
                <X size={15} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              title="Delete community"
              aria-label="Delete community"
              className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 size={17} />
            </button>
          ))}

        {!isAdmin &&
          !renaming &&
          (confirmingLeave ? (
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={handleLeave}
                className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white"
              >
                Leave?
              </button>
              <button
                type="button"
                onClick={() => setConfirmingLeave(false)}
                aria-label="Cancel"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
              >
                <X size={15} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingLeave(true)}
              title="Leave community"
              aria-label="Leave community"
              className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
            >
              <LogOut size={17} />
            </button>
          ))}
      </div>

      {nameError && (
        <p className="border-b border-slate-100 bg-red-50 px-4 py-1.5 text-xs text-red-600">
          {nameError}
        </p>
      )}

      {/* Body */}
      <div className="flex flex-1 flex-col overflow-y-auto pb-6">
        {/* Admin */}
        <p className="mt-5 px-6 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Admin
        </p>
        {adminMember && (
          <div className="flex items-center gap-3 px-6 py-3">
            <Avatar name={adminMember.name} color={adminMember.color} size="sm" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {adminMember.name}
              {adminMember.username === username && (
                <span className="ml-1 text-xs font-normal text-slate-400">(you)</span>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-600">
              <Crown size={13} />
              Admin
            </span>
          </div>
        )}

        {/* Members */}
        {otherMembers.length > 0 && (
          <>
            <p className="mt-5 px-6 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Members
            </p>
            <ul>
              {otherMembers.map((member) => (
                <MemberRow
                  key={member.username}
                  member={member}
                  isSelf={member.username === username}
                  isAdmin={isAdmin}
                  onPromote={() => transferCommunityAdmin(community.id, member.username)}
                  onRemove={() => removeCommunityMember(community.id, member.username)}
                />
              ))}
            </ul>
          </>
        )}

        {/* Add people (admin only) */}
        {isAdmin && (
          <>
            <p className="mt-5 px-6 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Add people
            </p>

            {communityActionError && communityActionError.communityId === community.id && (
              <div className="mx-6 mt-2 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <p className="min-w-0 flex-1 text-xs leading-5 text-red-700">
                  {INVITE_ERROR_MESSAGES[communityActionError.reason] ??
                    "That invite couldn't be sent."}
                </p>
                <button
                  type="button"
                  onClick={clearCommunityActionError}
                  aria-label="Dismiss"
                  className="shrink-0 text-red-400 transition hover:text-red-600"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {community.pendingInvites.length === 0 && eligibleContacts.length === 0 ? (
              <p className="px-6 py-3 text-xs text-slate-400">
                No one left to invite — only accepted connections who aren't already
                members show up here.
              </p>
            ) : (
              <ul>
                {community.pendingInvites.map((invite) => {
                  const contact = contacts.find((c) => c.username === invite.username);
                  return (
                    <li
                      key={invite.username}
                      className="flex items-center gap-3 px-6 py-2.5"
                    >
                      {contact ? (
                        <Avatar name={contact.name} color={contact.color} size="sm" />
                      ) : (
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-500">
                          {invite.username.charAt(0).toUpperCase()}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-500">
                        {contact?.name ?? `@${invite.username}`}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-xs text-slate-400">
                        <Clock size={12} />
                        Pending
                      </span>
                      <button
                        type="button"
                        title="Cancel invite"
                        aria-label={`Cancel invite to @${invite.username}`}
                        onClick={() => cancelCommunityInvite(community.id, invite.username)}
                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                      >
                        <X size={15} />
                      </button>
                    </li>
                  );
                })}

                {eligibleContacts.map((contact) => (
                  <li key={contact.id} className="flex items-center gap-3 px-6 py-2.5">
                    <Avatar
                      name={contact.name}
                      color={contact.color}
                      photo={contact.photo}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {contact.name}
                    </span>
                    <button
                      type="button"
                      disabled={invitingUsername === contact.username}
                      onClick={() => handleInvite(contact.username)}
                      className="flex shrink-0 items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 disabled:opacity-50"
                    >
                      <UserPlus size={13} />
                      {invitingUsername === contact.username ? "Inviting…" : "Add"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MemberRow({
  member,
  isSelf,
  isAdmin,
  onPromote,
  onRemove,
}: {
  member: { username: string; name: string; color: string };
  isSelf: boolean;
  isAdmin: boolean;
  onPromote: () => void;
  onRemove: () => void;
}) {
  const [confirmingPromote, setConfirmingPromote] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  return (
    <li className="group/row flex items-center gap-3 px-6 py-2.5">
      <Avatar name={member.name} color={member.color} size="sm" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {member.name}
        {isSelf && <span className="ml-1 text-xs font-normal text-slate-400">(you)</span>}
      </span>

      {isAdmin && !isSelf && (
        <div className="flex shrink-0 items-center gap-1.5">
          {confirmingPromote ? (
            <>
              <span className="text-[11px] text-slate-500">Make admin?</span>
              <button
                type="button"
                onClick={() => {
                  onPromote();
                  setConfirmingPromote(false);
                }}
                className="rounded-lg bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setConfirmingPromote(false)}
                aria-label="Cancel"
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X size={13} />
              </button>
            </>
          ) : confirmingRemove ? (
            <>
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
                aria-label="Cancel"
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X size={13} />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setConfirmingPromote(true)}
                className="rounded-full px-2.5 py-1 text-xs font-semibold text-emerald-700 opacity-0 transition hover:bg-emerald-50 focus:opacity-100 group-hover/row:opacity-100"
              >
                Make Admin
              </button>
              <button
                type="button"
                title="Remove from community"
                aria-label="Remove from community"
                onClick={() => setConfirmingRemove(true)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-300 transition hover:bg-red-50 hover:text-red-600"
              >
                <UserMinus size={14} />
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
}
