/**
 * Terminated / unavailable peer helpers.
 * Guests leave a 24h "unavailable" stub; then status becomes "none".
 */
import type { ConnectionStatus } from "@tabcom/shared";

export function isIdentityUnavailable(
  status: ConnectionStatus | string | undefined
): boolean {
  return status === "unavailable";
}

export const UNAVAILABLE_LABEL = "User unavailable";
export const UNAVAILABLE_SUBTITLE = "This account no longer exists";
