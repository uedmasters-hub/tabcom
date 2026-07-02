import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

interface SectionLabelProps {
  children: ReactNode;
  className?: string;
}

/** Uppercase blue eyebrow label above screen titles. */
export default function SectionLabel({
  children,
  className,
}: SectionLabelProps) {
  return (
    <span
      className={cn(
        "text-xs font-semibold uppercase tracking-[0.24em] text-blue-600",
        className
      )}
    >
      {children}
    </span>
  );
}
