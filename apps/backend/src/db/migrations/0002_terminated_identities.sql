-- Temporary guest-lifecycle tombstones (24h grace). Safe to GC.
-- Does not alter essential tables (users, invites, board_state, …).
CREATE TABLE IF NOT EXISTS "terminated_identities" (
  "username" text PRIMARY KEY NOT NULL,
  "kind" text DEFAULT 'guest' NOT NULL,
  "terminated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "purge_after" timestamp with time zone NOT NULL
);
