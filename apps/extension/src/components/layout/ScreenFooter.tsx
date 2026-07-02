import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

interface ScreenFooterProps {
  children: ReactNode;
  className?: string;
}

/** Bottom bar for screen-level actions or legal text. */
export default function ScreenFooter({
  children,
  className,
}: ScreenFooterProps) {
  return (
    <footer className={cn("border-t border-slate-200 p-6", className)}>
      {children}
    </footer>
  );
}
