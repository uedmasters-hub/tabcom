-- Invite waitlist for unregistered sign-in / request-invite flows.
-- Applied via `pnpm db:migrate` (drizzle-kit push) from schema.ts;
-- this file documents the change for operators who prefer SQL.
CREATE TABLE IF NOT EXISTS "invite_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL UNIQUE,
  "display_name" text,
  "reason" text,
  "source" text DEFAULT 'sign_in' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
