import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "../../../../lib/cn";
import { useProfileStore } from "../../../../stores/profile.store";
import type { Community } from "../../../../types/chat";

import DangerZoneSection from "./DangerZoneSection";
import InvitesSection from "./InvitesSection";
import MembersSection from "./MembersSection";
import OverviewSection from "./OverviewSection";

type Section = "overview" | "members" | "invites" | "danger";

/**
 * Dedicated community management surface — replaces the old cramped
 * "Community info" slide-over. Organized so each concern is its own
 * section, making room for future additions (roles beyond admin/member,
 * tab-sharing permissions, privacy/access settings, archive) without
 * restructuring what's here.
 *
 * Everything wired in this pass talks to capabilities the backend
 * already enforces end-to-end (rename, invite with 3-strike + connection
 * gating, remove member, ownership transfer, leave, delete) — nothing
 * here is UI for a capability the server can't actually back up.
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

  const [section, setSection] = useState<Section>("overview");

  // Edge case: ownership can change out from under you mid-session (the
  // admin transferred it to someone else while you were on this page).
  // The Invites tab is admin-only — bounce back to Overview rather than
  // render a blank pane for a tab you can no longer see.
  useEffect(() => {
    if (section === "invites" && !isAdmin) setSection("overview");
  }, [section, isAdmin]);

  const sections: Array<{ id: Section; label: string; adminOnly?: boolean }> = [
    { id: "overview", label: "Overview" },
    { id: "members", label: "Members" },
    { id: "invites", label: "Invites", adminOnly: true },
    { id: "danger", label: "Danger zone" },
  ];

  return (
    <div className="absolute inset-0 z-20 flex flex-col overflow-hidden bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <p className="text-sm font-semibold">Manage community</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
        >
          <X size={18} />
        </button>
      </div>

      <div
        className="flex gap-4 border-b border-slate-100 px-6"
        role="tablist"
        aria-label="Community management sections"
      >
        {sections
          .filter((item) => !item.adminOnly || isAdmin)
          .map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={section === item.id}
              onClick={() => setSection(item.id)}
              className={cn(
                "whitespace-nowrap border-b-2 py-3 text-xs font-semibold transition",
                section === item.id
                  ? "border-slate-900 text-slate-900"
                  : "border-transparent text-slate-400 hover:text-slate-600"
              )}
            >
              {item.label}
            </button>
          ))}
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto">
        {section === "overview" && (
          <OverviewSection community={community} isAdmin={isAdmin} />
        )}
        {section === "members" && (
          <MembersSection
            community={community}
            isAdmin={isAdmin}
            username={username}
          />
        )}
        {section === "invites" && isAdmin && (
          <InvitesSection community={community} />
        )}
        {section === "danger" && (
          <DangerZoneSection
            community={community}
            isAdmin={isAdmin}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}
