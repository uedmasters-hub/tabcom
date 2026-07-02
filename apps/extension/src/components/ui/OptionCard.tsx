import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface OptionCardProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  title: string;
  description?: string;
  icon?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
}

/**
 * Tappable card for choosing between options
 * (profile visibility, auth providers, settings rows).
 */
export default function OptionCard({
  title,
  description,
  icon,
  trailing,
  selected = false,
  className,
  ...props
}: OptionCardProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border p-4 text-left transition",
        selected
          ? "border-blue-500 bg-blue-50/50"
          : "border-slate-200 hover:border-slate-300 hover:bg-slate-50",
        className
      )}
      {...props}
    >
      {icon && <span className="shrink-0 text-slate-700">{icon}</span>}

      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        {description && (
          <span className="mt-1 block text-sm leading-6 text-slate-500">
            {description}
          </span>
        )}
      </span>

      {trailing && <span className="shrink-0 text-slate-400">{trailing}</span>}
    </button>
  );
}
