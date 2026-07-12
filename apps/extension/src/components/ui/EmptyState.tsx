import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import Illustration from "./Illustration";

interface EmptyStateProps {
  /** Small line-icon badge — original treatment, still used wherever a
   *  full illustration hasn't been designed for that spot. */
  icon?: ReactNode;
  /** Bigger illustration treatment (see Illustration.tsx). When given,
   *  this takes over from `icon` entirely. */
  illustrationName?: string;
  illustrationAlt?: string;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}

/** Centered empty state for views with no content yet. */
export default function EmptyState({
  icon,
  illustrationName,
  illustrationAlt,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center justify-center px-6 text-center",
        className
      )}
    >
      {illustrationName ? (
        <Illustration name={illustrationName} alt={illustrationAlt ?? title} size={168} />
      ) : (
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
          {icon}
        </span>
      )}

      <h2 className="mt-6 text-lg font-bold tracking-tight">{title}</h2>

      <p className="mt-2 max-w-xs text-sm leading-6 text-slate-500">
        {description}
      </p>

      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
