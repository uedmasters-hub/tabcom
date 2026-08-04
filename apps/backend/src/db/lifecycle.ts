/**
 * Neon table lifecycle classification — guest cleanup MUST consult this
 * before deleting or mutating any durable row.
 *
 * Neon is a lightweight session + identity + relationship registry.
 * It is NOT a chat/media store. Message content never lives here.
 *
 * NEVER issue DROP TABLE / ALTER TABLE against essential objects from
 * guest-lifecycle code paths.
 */

/** Tables that must never be deleted or structurally altered by cleanup. */
export const ESSENTIAL_TABLES = [
  "users",
  "invites",
  "invite_requests",
  "user_settings",
  "community_images",
  "board_state",
] as const;

/**
 * Targets guest cleanup may touch (row-level only, never DDL):
 * - sessions: delete guest rows only
 * - community_activity: delete rows authored by terminated guest username
 * - terminated_identities: insert/GC tombstones
 * - board_state: mutate JSON in place to strip guest relationship refs
 */
export const GUEST_PURGEABLE_TARGETS = [
  "sessions",
  "community_activity",
  "terminated_identities",
  "board_state_guest_refs",
] as const;

export type EssentialTable = (typeof ESSENTIAL_TABLES)[number];
export type GuestPurgeableTarget = (typeof GUEST_PURGEABLE_TARGETS)[number];

const essentialSet = new Set<string>(ESSENTIAL_TABLES);

/**
 * Dev-time guard: refuse operations that name an essential table as a
 * DROP/DELETE-ALL target. Row-scoped guest cleanup never passes table
 * names through here for board_state / users.
 */
export function assertNotEssentialMutation(table: string, op: string): void {
  if (essentialSet.has(table) && (op === "drop" || op === "truncate" || op === "delete_all")) {
    throw new Error(
      `[tabcom:lifecycle] refused ${op} on essential table "${table}". ` +
        `Guest cleanup may only strip guest-owned refs, never destroy core infrastructure.`
    );
  }
}

/** Grace period before tombstones and peer stubs are fully purged. */
export const TERMINATED_IDENTITY_GRACE_MS = 24 * 60 * 60 * 1000;
