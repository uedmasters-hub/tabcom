/**
 * Client-side privacy access evaluation.
 * Payloads stay on disk; UI shows placeholders when access is denied.
 */
import type {
  ContentPrivacyPolicy,
  ContentPrivacyLocalState,
  ConversationPrivacyDefaults,
  Message,
  Presence,
  PrivacyIndicatorKind,
} from "@tabcom/shared";
import {
  DEFAULT_PRIVACY,
  isPrivacyActive,
  mergePrivacy,
  privacyIndicatorKind,
} from "@tabcom/shared";

export type AccessStatus = "allowed" | "placeholder";

export type AccessReason =
  | "open"
  | "revoked"
  | "awaiting_approval"
  | "sender_offline"
  | "view_once_consumed"
  | "expired"
  | "biometric_locked"
  | "protected";

export interface AccessResult {
  status: AccessStatus;
  reason: AccessReason;
  indicator: PrivacyIndicatorKind | null;
  policy: ContentPrivacyPolicy;
  placeholderLabel: string;
}

const PLACEHOLDER_COPY: Record<AccessReason, string> = {
  open: "",
  revoked: "Unavailable — access revoked",
  awaiting_approval: "Unavailable — waiting for sender approval",
  sender_offline: "Unavailable — visible while sender is online",
  view_once_consumed: "Unavailable — already viewed",
  expired: "Unavailable — timed out",
  biometric_locked: "Locked — unlock to view",
  protected: "Unavailable — sender's privacy settings",
};

export function resolveEffectivePolicy(
  defaults: ConversationPrivacyDefaults | null | undefined,
  message: Message
): ContentPrivacyPolicy {
  return mergePrivacy(defaults ?? DEFAULT_PRIVACY, message.privacy ?? null);
}

export function resolveAccess(opts: {
  message: Message;
  defaults?: ConversationPrivacyDefaults | null;
  /** True when the local user authored this message. */
  isMine: boolean;
  /** Sender presence (for online_only). Ignored for own messages. */
  senderPresence?: Presence | string | null;
  now?: number;
  /** Biometric session currently unlocked for this item. */
  biometricUnlocked?: boolean;
}): AccessResult {
  const policy = resolveEffectivePolicy(opts.defaults, opts.message);
  const indicator = privacyIndicatorKind(policy);
  const local: ContentPrivacyLocalState = opts.message.privacyLocal ?? {};
  const now = opts.now ?? Date.now();

  const allowed = (reason: AccessReason = "open"): AccessResult => ({
    status: "allowed",
    reason,
    indicator: isPrivacyActive(policy) ? indicator : null,
    policy,
    placeholderLabel: "",
  });

  const blocked = (reason: AccessReason): AccessResult => ({
    status: "placeholder",
    reason,
    indicator: indicator ?? "shield",
    policy,
    placeholderLabel: PLACEHOLDER_COPY[reason] || PLACEHOLDER_COPY.protected,
  });

  // Authors always see their own content (including pending approval state).
  if (opts.isMine) {
    if (policy.revoked) {
      // Still show to author so they can re-approve / see what was revoked.
      return allowed();
    }
    return allowed();
  }

  if (policy.revoked) return blocked("revoked");

  if (
    (policy.visibility === "private" ||
      policy.visibility === "hide_until_approved") &&
    !policy.approved
  ) {
    return blocked("awaiting_approval");
  }

  if (policy.visibility === "online_only") {
    const p = opts.senderPresence ?? "offline";
    if (p !== "online" && p !== "away" && p !== "busy") {
      return blocked("sender_offline");
    }
  }

  if (policy.visibility === "view_once" && local.viewOnceConsumed) {
    return blocked("view_once_consumed");
  }

  if (policy.expiresAt && now >= policy.expiresAt) {
    return blocked("expired");
  }

  if (policy.visibility === "time_limited" && policy.expiresAt && now >= policy.expiresAt) {
    return blocked("expired");
  }

  if (policy.visibility === "biometric") {
    const unlocked =
      opts.biometricUnlocked ||
      (local.biometricUnlockedUntil != null &&
        local.biometricUnlockedUntil > now);
    if (!unlocked) return blocked("biometric_locked");
  }

  if (!isPrivacyActive(policy)) return allowed();
  return allowed("protected");
}

export function canCopy(policy: ContentPrivacyPolicy): boolean {
  return policy.allowCopy !== false && !policy.revoked;
}

export function canDownload(policy: ContentPrivacyPolicy): boolean {
  return policy.allowDownload !== false && !policy.revoked;
}

export function canForward(policy: ContentPrivacyPolicy): boolean {
  return policy.allowForward !== false && !policy.revoked;
}

export function canShowInGallery(policy: ContentPrivacyPolicy): boolean {
  return policy.showInGallery !== false && !policy.revoked;
}
