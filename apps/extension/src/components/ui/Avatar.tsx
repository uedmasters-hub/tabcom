import { cn } from "../../lib/cn";
import { getInitials } from "../../utils/initials";

type AvatarSize = "sm" | "md" | "lg" | "xl";

interface AvatarProps {
  name: string;
  color: string;
  size?: AvatarSize;
  className?: string;
}

const sizeClasses: Record<AvatarSize, string> = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-lg",
  xl: "h-24 w-24 text-3xl",
};

/** Initials avatar. Image support arrives with the backend. */
export default function Avatar({
  name,
  color,
  size = "md",
  className,
}: AvatarProps) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        sizeClasses[size],
        className
      )}
      style={{ backgroundColor: color }}
    >
      {getInitials(name)}
    </span>
  );
}
