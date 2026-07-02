import { Avatar } from "../../../components/ui";
import { useChatStore } from "../../../stores/chat.store";
import { useProfileStore } from "../../../stores/profile.store";

interface WorkspaceHeaderProps {
  title: string;
}

/** Shared workspace top bar: view title, connection status, profile. */
export default function WorkspaceHeader({ title }: WorkspaceHeaderProps) {
  const displayName = useProfileStore((state) => state.displayName);
  const avatarColor = useProfileStore((state) => state.avatarColor);
  const live = useChatStore((state) => state.live);

  return (
    <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
      <div className="flex items-center gap-2.5">
        <h1 className="text-lg font-bold tracking-tight">{title}</h1>

        <span
          title={
            live
              ? "Connected to realtime server"
              : "Offline — local demo mode"
          }
          className={
            live
              ? "rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600"
              : "rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400"
          }
        >
          {live ? "Live" : "Demo"}
        </span>
      </div>

      <div className="relative">
        <Avatar name={displayName} color={avatarColor} size="sm" />

        <span
          title={live ? "Online" : "Offline"}
          className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${
            live ? "bg-emerald-500" : "bg-slate-300"
          }`}
        />
      </div>
    </header>
  );
}
