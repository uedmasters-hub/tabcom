import { cn } from "../../lib/cn";

export interface SettingsToggleRowProps {
  icon: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
  className?: string;
}

export function SettingsToggleRow({
  icon,
  label,
  description,
  checked,
  onToggle,
  className,
}: SettingsToggleRowProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border border-slate-200 p-4 text-left transition hover:border-slate-300",
        className
      )}
    >
      <span className="shrink-0 text-slate-500">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{label}</span>
        <span className="mt-0.5 block text-sm text-slate-500">{description}</span>
      </span>
      <span
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
          checked ? "bg-slate-900" : "bg-slate-200"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
            checked ? "left-[22px]" : "left-0.5"
          )}
        />
      </span>
    </button>
  );
}
