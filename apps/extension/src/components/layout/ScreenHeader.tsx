import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

interface ScreenHeaderProps {
  onBack?: () => void;
  backLabel?: string;
  children?: ReactNode;
  className?: string;
}

/**
 * Top bar for every screen.
 * Pass onBack for a back button, and/or children for custom content
 * (brand block, actions, badges).
 */
export default function ScreenHeader({
  onBack,
  backLabel = "Back",
  children,
  className,
}: ScreenHeaderProps) {
  return (
    <header
      className={cn(
        "flex items-center justify-between px-6 py-5",
        className
      )}
    >
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-slate-500 transition hover:text-slate-900"
        >
          <ArrowLeft size={18} />
          {backLabel}
        </button>
      ) : null}

      {children}
    </header>
  );
}
