import { Check } from "lucide-react";
import { useState } from "react";

import { Avatar } from "../../../components/ui";
import NotificationBell from "../../../components/layout/NotificationBell";
import { cn } from "../../../lib/cn";
import { updatePresence } from "../../../lib/realtime";
import { useChatStore } from "../../../stores/chat.store";
import { useProfileStore } from "../../../stores/profile.store";

type MyPresence = "online" | "away" | "busy" | "offline";

const presenceOptions: Array<{
  id: MyPresence;
  label: string;
  dot: string;
}> = [
  { id: "online", label: "Online", dot: "bg-emerald-500" },
  { id: "away", label: "Away", dot: "bg-amber-400" },
  { id: "busy", label: "Busy", dot: "bg-red-500" },
  { id: "offline", label: "Appear offline", dot: "bg-slate-300" },
];

/** Top bar: view title, connection status, avatar with presence menu. */
export default function WorkspaceHeader({ title }: { title: string }) {
  const displayName = useProfileStore((state) => state.displayName);
  const avatarColor = useProfileStore((state) => state.avatarColor);
  const photo = useProfileStore((state) => state.photo);
  const presence = useProfileStore((state) => state.presence);
  const setPresence = useProfileStore((state) => state.setPresence);
  const live = useChatStore((state) => state.live);

  const [menuOpen, setMenuOpen] = useState(false);

  const currentDot =
    presenceOptions.find((option) => option.id === presence)?.dot ??
    "bg-emerald-500";

  const choose = (id: MyPresence) => {
    setPresence(id);
    updatePresence(id);
    setMenuOpen(false);
  };

  return (
    <header className="relative flex items-center justify-between border-b border-slate-200 px-6 py-4">
      <div className="flex items-center gap-3">
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            title="Set your status"
            aria-label="Set your status"
            aria-expanded={menuOpen}
            className="relative rounded-full transition hover:ring-2 hover:ring-slate-200"
          >
            <Avatar
              name={displayName}
              color={avatarColor}
              photo={photo}
              size="sm"
            />

            <span
              className={cn(
                "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white",
                live ? currentDot : "bg-slate-300"
              )}
            />
          </button>

          {menuOpen && (
            <>
              <button
                type="button"
                aria-label="Close status menu"
                className="fixed inset-0 z-20 cursor-default"
                onClick={() => setMenuOpen(false)}
              />

              <div className="absolute left-0 top-11 z-30 w-48 rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg">
                {presenceOptions.map(({ id, label, dot }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => choose(id)}
                    className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm font-medium transition hover:bg-slate-50"
                  >
                    <span className={cn("h-2.5 w-2.5 rounded-full", dot)} />
                    <span className="flex-1">{label}</span>
                    {presence === id && (
                      <Check size={15} className="text-blue-600" />
                    )}
                  </button>
                ))}

                <p className="border-t border-slate-100 px-4 pb-1 pt-2 text-[11px] leading-4 text-slate-400">
                  "Appear offline" hides your presence — messages still work.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          <h1 className="text-lg font-bold tracking-tight">{title}</h1>

          <span
            title={
              live ? "Connected to realtime server" : "Offline — local demo mode"
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
      </div>

      <NotificationBell />
    </header>
  );
}
