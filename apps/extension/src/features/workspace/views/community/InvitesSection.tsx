import { Clock, UserPlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Avatar, Button, EmptyState, SectionLabel } from "../../../../components/ui";
import { useChatStore } from "../../../../stores/chat.store";
import type { CommunityErrorReason } from "../../../../lib/realtime";
import type { Community } from "../../../../types/chat";

const ERROR_MESSAGES: Record<CommunityErrorReason, string> = {
  not_connected: "You can only invite accepted connections.",
  invite_limit: "This person has reached the 3-invite limit for this community.",
  already_pending: "This person already has a pending invite.",
};

export default function InvitesSection({ community }: { community: Community }) {
  const contacts = useChatStore((state) => state.contacts);
  const connections = useChatStore((state) => state.connections);
  const inviteToCommunity = useChatStore((state) => state.inviteToCommunity);
  const cancelCommunityInvite = useChatStore((state) => state.cancelCommunityInvite);
  const communityActionError = useChatStore((state) => state.communityActionError);
  const clearCommunityActionError = useChatStore(
    (state) => state.clearCommunityActionError
  );

  const [invitingUsername, setInvitingUsername] = useState<string | null>(null);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-dismiss the banner once the invite it complained about either
  // succeeds (shows up in pendingInvites) or this section unmounts.
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

  useEffect(() => {
    return () => {
      clearCommunityActionError();
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
    };
  }, [clearCommunityActionError]);

  const eligible = contacts.filter(
    (contact) =>
      contact.id.startsWith("u-") &&
      connections[contact.username] === "accepted" &&
      !community.members.some((m) => m.username === contact.username) &&
      !community.pendingInvites.some((p) => p.username === contact.username)
  );

  const handleInvite = (username: string) => {
    setInvitingUsername(username);
    inviteToCommunity(community.id, username);
    // No request/response correlation exists in the socket protocol yet
    // (see summary) — this is a best-effort optimistic window, not a
    // guarantee the server has actually replied by then.
    pendingTimer.current = setTimeout(
      () => setInvitingUsername((current) => (current === username ? null : current)),
      2500
    );
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto pb-4">
      {communityActionError && communityActionError.communityId === community.id && (
        <div className="mx-6 mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="min-w-0 flex-1 text-xs leading-5 text-red-700">
            {ERROR_MESSAGES[communityActionError.reason] ?? "That invite couldn't be sent."}
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

      <SectionLabel className="mt-6 px-6">Invite people</SectionLabel>
      {eligible.length === 0 ? (
        <EmptyState
          className="py-8"
          icon={<UserPlus size={22} />}
          title="No one left to invite"
          description="Only accepted connections who aren't already members or invited show up here."
        />
      ) : (
        <ul className="mt-2">
          {eligible.map((contact) => (
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
              <Button
                size="md"
                variant="outline"
                disabled={invitingUsername === contact.username}
                leftIcon={<UserPlus size={14} />}
                onClick={() => handleInvite(contact.username)}
              >
                {invitingUsername === contact.username ? "Inviting…" : "Invite"}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <SectionLabel className="mt-6 px-6">
        Pending invites
        {community.pendingInvites.length > 0 && ` · ${community.pendingInvites.length}`}
      </SectionLabel>
      {community.pendingInvites.length === 0 ? (
        <EmptyState
          className="py-8"
          icon={<Clock size={22} />}
          title="No pending invites"
          description="Invites you send will show up here until the person responds."
        />
      ) : (
        <ul className="mt-2">
          {community.pendingInvites.map((invite) => (
            <li key={invite.username} className="flex items-center gap-3 px-6 py-2.5">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-500">
                @{invite.username}
                <span className="ml-1.5 text-xs font-normal text-slate-400">
                  waiting to respond · {invite.attemptsLeft} attempt
                  {invite.attemptsLeft === 1 ? "" : "s"} left
                </span>
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
          ))}
        </ul>
      )}
    </div>
  );
}
