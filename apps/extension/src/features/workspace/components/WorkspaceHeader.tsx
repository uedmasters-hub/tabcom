import { Avatar } from "../../../components/ui";
import { useProfileStore } from "../../../stores/profile.store";

interface WorkspaceHeaderProps {
  title: string;
}

/** Shared workspace top bar: current view title + profile with presence. */
export default function WorkspaceHeader({ title }: WorkspaceHeaderProps) {
  const displayName = useProfileStore((state) => state.displayName);
  const avatarColor = useProfileStore((state) => state.avatarColor);

  return (
    <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
      <h1 className="text-lg font-bold tracking-tight">{title}</h1>

      <div className="relative">
        <Avatar name={displayName} color={avatarColor} size="sm" />

        {/* Presence dot — static Online until realtime lands in Phase 2 */}
        <span
          title="Online"
          className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500"
        />
      </div>
    </header>
  );
}
