import { Check, Crown, Pencil, Users2, X } from "lucide-react";
import { useState } from "react";

import { cn } from "../../../../lib/cn";
import { useChatStore } from "../../../../stores/chat.store";
import type { Community } from "../../../../types/chat";

/** Mirrors the server's community_rename truncation (index.ts) so the
 *  counter here never promises a length the server won't honor. */
const NAME_MAX_LENGTH = 60;

export default function OverviewSection({
  community,
  isAdmin,
}: {
  community: Community;
  isAdmin: boolean;
}) {
  const renameCommunity = useChatStore((state) => state.renameCommunity);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(community.name);
  const [error, setError] = useState<string | null>(null);

  const startEdit = () => {
    setDraft(community.name);
    setError(null);
    setEditing(true);
  };

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError("Community name can't be empty.");
      return;
    }
    if (trimmed !== community.name) renameCommunity(community.id, trimmed);
    setEditing(false);
  };

  return (
    <div className="flex flex-col items-center px-6 py-8 text-center">
      <span className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-900 text-2xl font-bold text-white">
        {community.name.charAt(0).toUpperCase()}
      </span>

      {editing ? (
        <div className="mt-4 w-full max-w-xs">
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={draft}
              maxLength={NAME_MAX_LENGTH}
              onChange={(event) => {
                setDraft(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit();
                if (event.key === "Escape") setEditing(false);
              }}
              aria-label="Community name"
              aria-invalid={error ? true : undefined}
              className={cn(
                "h-10 min-w-0 flex-1 rounded-lg border px-3 text-sm outline-none transition-colors",
                error
                  ? "border-red-400 focus:border-red-500"
                  : "border-slate-200 focus:border-blue-500"
              )}
            />
            <button
              type="button"
              onClick={submit}
              aria-label="Save name"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white"
            >
              <Check size={15} />
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              aria-label="Cancel"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100"
            >
              <X size={15} />
            </button>
          </div>
          <div className="mt-1.5 flex items-center justify-between px-0.5 text-xs">
            <span className="text-red-600">{error ?? ""}</span>
            <span className="text-slate-400">
              {draft.length}/{NAME_MAX_LENGTH}
            </span>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-1.5">
          <h2 className="text-lg font-bold">{community.name}</h2>
          {isAdmin && (
            <button
              type="button"
              onClick={startEdit}
              title="Rename community"
              aria-label="Rename community"
              className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
            >
              <Pencil size={14} />
            </button>
          )}
        </div>
      )}

      <p className="mt-1 text-sm text-slate-500">
        {community.members.length} member
        {community.members.length === 1 ? "" : "s"}
      </p>

      <span
        className={cn(
          "mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
          isAdmin ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"
        )}
      >
        {isAdmin ? <Crown size={13} /> : <Users2 size={13} />}
        {isAdmin ? "You're the admin" : "You're a member"}
      </span>
    </div>
  );
}
