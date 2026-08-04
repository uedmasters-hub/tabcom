/**
 * Content / conversation privacy policies — enforced client-side.
 * Server only relays opaque `privacy` / `privacy_update` payloads.
 */

export type PrivacyVisibility =
  | "always"
  | "online_only"
  | "view_once"
  | "time_limited"
  | "private"
  | "hide_until_approved"
  | "biometric";

export type PrivacyIndicatorKind = "shield" | "key" | "clock";

export type PrivacyPolicySource = "inherit" | "override";

/** Conversation-level defaults (parent). Applied to future sends unless overridden. */
export interface ConversationPrivacyDefaults {
  visibility: PrivacyVisibility;
  /** Absolute expiry timestamp (ms) once applied to a message. */
  expiresAt?: number;
  /** Relative TTL used when composing time-limited content (ms). */
  ttlMs?: number;
  allowDownload: boolean;
  allowForward: boolean;
  allowCopy: boolean;
  allowScreenshot: boolean;
  allowScreenRecord: boolean;
  showInGallery: boolean;
  watermark: boolean;
  /** Sender may revoke / edit after send. */
  revocable: boolean;
  /** Auto-delete after this many ms from send (retention). */
  retentionMs?: number;
}

/** Per-message policy — inherits conversation defaults or overrides them. */
export interface ContentPrivacyPolicy extends ConversationPrivacyDefaults {
  source: PrivacyPolicySource;
  /**
   * When visibility is private / hide_until_approved: recipient cannot
   * view until the sender sends an approve privacy_update.
   */
  approved?: boolean;
  /** Sender revoked access — recipient always sees placeholder. */
  revoked?: boolean;
}

/** Local-only viewer state (never sent on the wire). */
export interface ContentPrivacyLocalState {
  /** View-once: recipient has already opened the content. */
  viewOnceConsumed?: boolean;
  /** Biometric session unlocked until this timestamp. */
  biometricUnlockedUntil?: number;
}

export type PrivacyUpdateAction = "update" | "revoke" | "approve";

export interface PrivacyUpdatePayload {
  messageId: string;
  privacy: ContentPrivacyPolicy;
  action?: PrivacyUpdateAction;
}

export const DEFAULT_PRIVACY: ConversationPrivacyDefaults = {
  visibility: "always",
  allowDownload: true,
  allowForward: true,
  allowCopy: true,
  allowScreenshot: true,
  allowScreenRecord: true,
  showInGallery: true,
  watermark: false,
  revocable: true,
};

export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export function mergePrivacy(
  defaults: ConversationPrivacyDefaults | null | undefined,
  override: ContentPrivacyPolicy | null | undefined
): ContentPrivacyPolicy {
  const base = { ...DEFAULT_PRIVACY, ...(defaults ?? {}) };
  if (!override || override.source === "inherit") {
    return { ...base, source: "inherit", approved: override?.approved, revoked: override?.revoked };
  }
  return {
    ...base,
    ...override,
    source: "override",
  };
}

/** True when the policy is more restrictive than the open default. */
export function isPrivacyActive(policy: ContentPrivacyPolicy | ConversationPrivacyDefaults | null | undefined): boolean {
  if (!policy) return false;
  if (policy.visibility !== "always") return true;
  if (policy.allowDownload === false) return true;
  if (policy.allowForward === false) return true;
  if (policy.allowCopy === false) return true;
  if (policy.allowScreenshot === false) return true;
  if (policy.allowScreenRecord === false) return true;
  if (policy.showInGallery === false) return true;
  if (policy.watermark === true) return true;
  if ("revoked" in policy && (policy as ContentPrivacyPolicy).revoked) return true;
  if (policy.retentionMs && policy.retentionMs > 0) return true;
  return false;
}

export function privacyIndicatorKind(
  policy: ContentPrivacyPolicy | ConversationPrivacyDefaults | null | undefined
): PrivacyIndicatorKind | null {
  if (!policy || !isPrivacyActive(policy)) return null;
  if ("revoked" in policy && (policy as ContentPrivacyPolicy).revoked) return "shield";
  switch (policy.visibility) {
    case "time_limited":
    case "view_once":
      return "clock";
    case "biometric":
    case "private":
    case "hide_until_approved":
      return "key";
    default:
      return "shield";
  }
}

export function visibilityLabel(v: PrivacyVisibility): string {
  switch (v) {
    case "always":
      return "Always visible";
    case "online_only":
      return "Visible only while I'm online";
    case "view_once":
      return "View once";
    case "time_limited":
      return "Time limited";
    case "private":
      return "Private";
    case "hide_until_approved":
      return "Hide until approved";
    case "biometric":
      return "Biometric lock";
    default:
      return "Always visible";
  }
}

/** Apply ttlMs → expiresAt when composing a time-limited message. */
export function materializePolicyForSend(
  policy: ContentPrivacyPolicy,
  sentAt = Date.now()
): ContentPrivacyPolicy {
  const next = { ...policy };
  if (next.visibility === "time_limited" && !next.expiresAt) {
    const ttl = next.ttlMs && next.ttlMs > 0 ? next.ttlMs : DEFAULT_TTL_MS;
    next.expiresAt = sentAt + ttl;
  }
  if (next.retentionMs && next.retentionMs > 0 && !next.expiresAt) {
    // Retention alone can drive expiry for cleanup UX; visibility stays as set.
    next.expiresAt = sentAt + next.retentionMs;
  }
  if (
    (next.visibility === "private" || next.visibility === "hide_until_approved") &&
    next.approved == null
  ) {
    next.approved = false;
  }
  return next;
}
