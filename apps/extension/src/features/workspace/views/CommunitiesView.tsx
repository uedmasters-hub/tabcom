import {
  Check,
  Globe,
  ImagePlus,
  MessageSquare,
  Plus,
  ShieldOff,
  Users2,
  Wifi,
  X,
} from "lucide-react";
import { useRef, useState } from "react";

import { Avatar, Button, CommunityAvatar, EmptyState, Input, NameCloud } from "../../../components/ui";
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
  const connectionPhase = useChatStore((state) => state.connectionPhase);
  const contacts = useChatStore((state) => state.contacts);
  const connections = useChatStore((state) => state.connections);
  const communities = useChatStore((state) => state.communities);
  const communityInvites = useChatStore((state) => state.communityInvites);
  const startConversation = useChatStore((state) => state.startConversation);
  const openCommunityConversation = useChatStore(
    (state) => state.openCommunityConversation
  );
  const createCommunity = useChatStore((state) => state.createCommunity);
  const uploadCommunityImage = useChatStore((state) => state.uploadCommunityImage);
  const respondToCommunityInvite = useChatStore(
    (state) => state.respondToCommunityInvite
  );

  const visibility = useProfileStore((state) => state.visibility);
  const setVisibilityLocal = useProfileStore((state) => state.setVisibility);
  const setTab = useWorkspaceStore((state) => state.setTab);

  const [segment, setSegment] = useState<"groups" | "discover">("groups");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [pendingImage, setPendingImage] = useState<{
    previewUrl: string;
    base64: string;
    mimeType: string;
  } | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
  const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // matches the server's cap

  const pickImage = (file: File | undefined) => {
    setImageError(null);
    if (!file) return;

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setImageError("Use a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError("Image is too large — 2MB max.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      // Strip the "data:image/png;base64," prefix — the server just
      // wants the raw base64 payload alongside the mime type.
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      setPendingImage({ previewUrl: dataUrl, base64, mimeType: file.type });
    };
    reader.onerror = () => setImageError("Couldn't read that file — try another.");
    reader.readAsDataURL(file);
  };

  const goPublic = () => {
    setVisibilityLocal("public");
    updateVisibility("public");
  };

  if (!live) {
    // Dev builds get the actionable command; production users get
    // human copy — the pnpm instruction leaking into the store build
    // was a bug.
    return connectionPhase === "connecting" ? (
      <EmptyState
        icon={<Wifi size={24} />}
        title="Connecting…"
        description="Waking up the Tabcom server — this can take up to a minute the first time. Communities and discovery will appear automatically."
      />
    ) : (
      <EmptyState
        icon={<Wifi size={24} />}
        title="You're offline"
        description={
          import.meta.env.DEV
            ? "Start the Tabcom realtime server and reopen the panel. Run: pnpm --filter @tabcom/backend dev"
            : "Tabcom can't reach the server right now. We'll keep retrying in the background — check your connection and hang tight."
        }
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

  const submitCreate = async () => {
    if (!name.trim()) return;
    const communityId = await createCommunity(name.trim());
    if (communityId && pendingImage) {
      uploadCommunityImage(communityId, pendingImage.mimeType, pendingImage.base64);
    }
    setName("");
    setPendingImage(null);
    setImageError(null);
    setCreating(false);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
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
            <div className="flex flex-col gap-3 px-6 pt-4">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Add a community logo"
                  className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-dashed border-slate-300 text-slate-400 transition hover:border-slate-400 hover:text-slate-600"
                >
                  {pendingImage ? (
                    <img
                      src={pendingImage.previewUrl}
                      alt="Selected community logo preview"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ImagePlus size={16} />
                  )}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => pickImage(event.target.files?.[0])}
                  className="hidden"
                />

                <Input
                  placeholder="Community name"
                  value={name}
                  maxLength={40}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void submitCreate();
                  }}
                  className="h-10"
                />
                <Button size="md" onClick={() => void submitCreate()}>
                  Create
                </Button>
                <Button
                  size="md"
                  variant="ghost"
                  onClick={() => {
                    setCreating(false);
                    setPendingImage(null);
                    setImageError(null);
                  }}
                >
                  <X size={16} />
                </Button>
              </div>

              {imageError && <p className="text-xs text-red-600">{imageError}</p>}

              <NameCloud selected={name} onSelect={setName} />
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
              illustrationName="communities-empty.png"
              illustrationAlt="Illustration of a group of people"
              title="No communities yet"
              description="Create one and invite your accepted contacts — every member joins by consent."
              action={
                !creating ? (
                  <Button size="md" leftIcon={<Plus size={15} />} onClick={() => setCreating(true)}>
                    Create
                  </Button>
                ) : undefined
              }
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
                    <CommunityAvatar
                      name={community.name}
                      imageVersion={community.imageVersion}
                      communityId={community.id}
                      size="md"
                    />

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
              illustrationName="discover-empty.png"
              illustrationAlt="Illustration of a blocked person icon"
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
