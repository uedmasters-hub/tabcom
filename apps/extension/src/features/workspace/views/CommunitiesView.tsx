import {
  Check,
  Globe,
  MessageSquare,
  Plus,
  ShieldOff,
  Users2,
  Wifi,
  X,
} from "lucide-react";
import { useState } from "react";

import { Avatar, Button, EmptyState, Input } from "../../../components/ui";
import { cn } from "../../../lib/cn";
import { updateVisibility } from "../../../lib/realtime";
import { useChatStore } from "../../../stores/chat.store";
import { useProfileStore } from "../../../stores/profile.store";
import { useWorkspaceStore } from "../../../stores/workspace.store";

/**
 * Communities tab:
 *  - Groups: your communities + pending invites (consent cards) + create
 *  - Discover: public users online right now
 */
export default function CommunitiesView() {
  const live = useChatStore((state) => state.live);
  const contacts = useChatStore((state) => state.contacts);
  const connections = useChatStore((state) => state.connections);
  const communities = useChatStore((state) => state.communities);
  const communityInvites = useChatStore((state) => state.communityInvites);
  const startConversation = useChatStore((state) => state.startConversation);
  const openCommunityConversation = useChatStore(
    (state) => state.openCommunityConversation
  );
  const createCommunity = useChatStore((state) => state.createCommunity);
  const respondToCommunityInvite = useChatStore(
    (state) => state.respondToCommunityInvite
  );

  const visibility = useProfileStore((state) => state.visibility);
  const setVisibilityLocal = useProfileStore((state) => state.setVisibility);
  const setTab = useWorkspaceStore((state) => state.setTab);

  const [segment, setSegment] = useState<"groups" | "discover">("groups");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const goPublic = () => {
    setVisibilityLocal("public");
    updateVisibility("public");
  };

  if (!live) {
    return (
      <EmptyState
        icon={<Wifi size={24} />}
        title="Offline — demo mode"
        description="Start the Tabcom realtime server and reopen the panel for communities and discovery. Run: pnpm --filter @tabcom/backend dev"
      />
    );
  }

  if (visibility === "private") {
    return (
      <EmptyState
        icon={<ShieldOff size={24} />}
        title="You're in private mode"
        description="Private is a complete end: no discovery, no communities, no messaging in either direction. Go public to participate."
        action={
          <Button size="md" onClick={goPublic}>
            Switch to public
          </Button>
        }
      />
    );
  }

  const groups = Object.values(communities);
  const invites = Object.values(communityInvites);
  const people = contacts.filter(
    (contact) => contact.id.startsWith("u-") && contact.presence === "online"
  );

  const openGroup = (communityId: string) => {
    openCommunityConversation(communityId);
    setTab("inbox");
  };

  const submitCreate = () => {
    if (!name.trim()) return;
    createCommunity(name);
    setName("");
    setCreating(false);
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* Segmented control — same underline-tab + plain-action pattern as the board's Tabs/Pins/Areas row */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-6">
        <div className="flex gap-4" role="tablist" aria-label="Communities filter">
          {(["groups", "discover"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={segment === id}
              onClick={() => setSegment(id)}
              className={cn(
                "border-b-2 py-3 text-xs font-semibold capitalize transition",
                segment === id
                  ? "border-slate-900 text-slate-900"
                  : "border-transparent text-slate-400 hover:text-slate-600"
              )}
            >
              {id}
            </button>
          ))}
        </div>

        {segment === "groups" && !creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex shrink-0 items-center gap-1 text-xs font-semibold text-slate-700 transition hover:text-slate-900"
          >
            <Plus size={14} />
            Create
          </button>
        )}
      </div>

      {segment === "groups" ? (
        <>
          {creating && (
            <div className="flex gap-2 px-6 pt-4">
              <Input
                placeholder="Community name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitCreate();
                }}
                className="h-10"
              />
              <Button size="md" onClick={submitCreate}>
                Create
              </Button>
              <Button
                size="md"
                variant="ghost"
                onClick={() => setCreating(false)}
              >
                <X size={16} />
              </Button>
            </div>
          )}

          {/* Pending invites — consent cards */}
          {invites.map(({ community, from, attempt }) => (
            <div
              key={community.id}
              className="mx-6 mt-4 rounded-xl border border-blue-200 bg-blue-50/50 p-4"
            >
              <p className="text-sm font-semibold">
                Invite: {community.name}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                @{from.username} invited you
                {attempt > 1 ? ` (attempt ${attempt} of 3)` : ""}. Joining
                shares your profile and messages with all members. You can
                leave anytime.
              </p>

              <div className="mt-3 flex gap-2">
                <Button
                  size="md"
                  className="flex-1"
                  leftIcon={<Check size={14} />}
                  onClick={() =>
                    respondToCommunityInvite(community.id, "accept")
                  }
                >
                  Join
                </Button>
                <Button
                  size="md"
                  variant="outline"
                  className="flex-1"
                  leftIcon={<X size={14} />}
                  onClick={() =>
                    respondToCommunityInvite(community.id, "decline")
                  }
                >
                  Decline
                </Button>
              </div>
            </div>
          ))}

          {/* Groups list */}
          {groups.length === 0 && invites.length === 0 ? (
            <EmptyState
              className="py-10"
              icon={<Users2 size={24} />}
              title="No communities yet"
              description="Create one and invite your accepted contacts — every member joins by consent."
            />
          ) : (
            <ul className="mt-4">
              {groups.map((community) => (
                <li key={community.id}>
                  <button
                    type="button"
                    onClick={() => openGroup(community.id)}
                    className="flex w-full items-center gap-3 border-b border-slate-100 px-6 py-4 text-left transition hover:bg-slate-50"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 font-bold text-white">
                      {community.name.charAt(0).toUpperCase()}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {community.name}
                      </span>
                      <span className="block text-sm text-slate-500">
                        {community.members.length} member
                        {community.members.length === 1 ? "" : "s"} · admin @
                        {community.admin}
                      </span>
                    </span>

                    <MessageSquare
                      size={18}
                      className="shrink-0 text-slate-400"
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          {people.length === 0 ? (
            <EmptyState
              className="py-10"
              icon={<Globe size={24} />}
              title="No one else is online"
              description="You're visible to the community. People who sign in on public will appear here instantly."
            />
          ) : (
            <>
              <p className="border-b border-slate-100 px-6 py-3 text-xs font-medium uppercase tracking-wide text-slate-400">
                Online now — {people.length}
              </p>
              <ul>
                {people.map((contact) => {
                  const status = connections[contact.username] ?? "none";
                  return (
                    <li key={contact.id}>
                      <button
                        type="button"
                        onClick={() => {
                          startConversation(contact.id);
                          setTab("inbox");
                        }}
                        className="flex w-full items-center gap-3 border-b border-slate-100 px-6 py-4 text-left transition hover:bg-slate-50"
                      >
                        <div className="relative">
                          <Avatar
                            name={contact.name}
                            color={contact.color}
                            photo={contact.photo}
                            size="md"
                          />
                          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
                        </div>

                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">
                            {contact.name}
                          </span>
                          <span className="block text-sm text-slate-500">
                            @{contact.username}
                          </span>
                        </span>

                        {status === "accepted" ? (
                          <MessageSquare
                            size={18}
                            className="shrink-0 text-slate-400"
                          />
                        ) : (
                          <span
                            className={cn(
                              "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                              status === "pending_in"
                                ? "border-blue-200 bg-blue-50 text-blue-600"
                                : status === "blocked"
                                  ? "border-slate-200 text-slate-400"
                                  : "border-slate-200 text-slate-500"
                            )}
                          >
                            {status === "pending_out"
                              ? "Requested"
                              : status === "pending_in"
                                ? "Respond"
                                : status === "blocked"
                                  ? "Blocked"
                                  : "Connect"}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
