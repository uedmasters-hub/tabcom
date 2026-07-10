import { Crown, UserMinus, X } from "lucide-react";
import { useState } from "react";

import { Avatar } from "../../../../components/ui";
import { useChatStore } from "../../../../stores/chat.store";
import type { Community } from "../../../../types/chat";

export default function MembersSection({
  community,
  isAdmin,
  username,
}: {
  community: Community;
  isAdmin: boolean;
  username: string;
}) {
  const transferCommunityAdmin = useChatStore(
    (state) => state.transferCommunityAdmin
  );
  const removeCommunityMember = useChatStore(
    (state) => state.removeCommunityMember
  );

  return (
    <div className="flex-1 overflow-y-auto pb-4">
      <ul className="divide-y divide-slate-100">
        {community.members.map((member) => {
          const memberIsAdmin = member.username === community.admin;
          const isSelf = member.username === username;

          return (
            <li
              key={member.username}
              className="flex items-center gap-3 px-6 py-3"
            >
              <Avatar name={member.name} color={member.color} size="sm" />

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {member.name}
                  {isSelf && (
                    <span className="ml-1 text-xs font-normal text-slate-400">
                      (you)
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs text-slate-400">
                  @{member.username}
                </span>
              </span>

              {memberIsAdmin ? (
                <span className="flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                  <Crown size={11} />
                  Admin
                </span>
              ) : isAdmin && !isSelf ? (
                <MemberRowActions
                  onPromote={() =>
                    transferCommunityAdmin(community.id, member.username)
                  }
                  onRemove={() =>
                    removeCommunityMember(community.id, member.username)
                  }
                />
              ) : (
                <span className="shrink-0 text-[10px] font-semibold uppercase text-slate-400">
                  Member
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MemberRowActions({
  onPromote,
  onRemove,
}: {
  onPromote: () => void;
  onRemove: () => void;
}) {
  const [confirmingPromote, setConfirmingPromote] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  // Transferring ownership hands over full control of the community —
  // unlike the old InfoPanel version, this now requires confirmation
  // too, the same as removal does.
  if (confirmingPromote) {
    return (
      <div className="flex shrink-0 items-center gap-1.5">
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
      </div>
    );
  }

  if (confirmingRemove) {
    return (
      <div className="flex shrink-0 items-center gap-1.5">
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
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        title="Make admin"
        aria-label="Make admin"
        onClick={() => setConfirmingPromote(true)}
        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-amber-50 hover:text-amber-600"
      >
        <Crown size={15} />
      </button>
      <button
        type="button"
        title="Remove from community"
        aria-label="Remove from community"
        onClick={() => setConfirmingRemove(true)}
        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
      >
        <UserMinus size={15} />
      </button>
    </div>
  );
}
