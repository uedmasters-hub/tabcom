import { useState } from "react";
import Avatar from "./Avatar";
import { REALTIME_URL } from "../../lib/realtime";
import { cn } from "../../lib/cn";

interface CommunityAvatarProps {
  name: string;
  color?: string;
  imageVersion?: number;
  communityId: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const SIZE_PX: Record<NonNullable<CommunityAvatarProps["size"]>, number> = {
  sm: 32,
  md: 40,
  lg: 56,
  xl: 96,
};

/**
 * Renders a community's uploaded logo when it has one, falling back to
 * the standard initials avatar otherwise (brand-new communities, or
 * ones whose image failed to load). imageVersion is required to be
 * PRESENT (not just truthy-checked as a boolean) to decide whether an
 * image exists at all — communities that never had one leave it
 * undefined entirely, so this never fires a request for a 404 in the
 * common case.
 */
export default function CommunityAvatar({
  name,
  color = "#334155",
  imageVersion,
  communityId,
  size = "md",
  className,
}: CommunityAvatarProps) {
  const [failed, setFailed] = useState(false);
  const px = SIZE_PX[size];

  if (imageVersion == null || failed) {
    return <Avatar name={name} color={color} size={size} className={className} />;
  }

  return (
    <img
      src={`${REALTIME_URL}/community-image/${communityId}?v=${imageVersion}`}
      alt=""
      aria-hidden
      width={px}
      height={px}
      onError={() => setFailed(true)}
      className={cn("inline-block shrink-0 rounded-full object-cover", className)}
      style={{ width: px, height: px }}
    />
  );
}
