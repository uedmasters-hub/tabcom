import {
  boolean,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * The first real, durable identity Tabcom has ever had. Everything
 * else in this server (communities, boards, presence, the socket
 * relay) is deliberately ephemeral by design — this table is the one
 * deliberate exception, because "who owns this username" has to
 * survive a server restart or the whole point of authentication is
 * lost.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  /** Null until the person picks one during setup — enforced unique
   *  here for the first time in this project's history. */
  username: text("username").unique(),
  displayName: text("display_name"),
  avatarColor: text("avatar_color"),
  /** Null = unverified. Accounts are usable immediately on creation —
   *  verification is a background upgrade, not a gate. Other people
   *  the account contacts can see this status and decide how much to
   *  trust it before it's confirmed. */
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * A single outstanding magic-link request. Short-lived by design —
 * cleaned up (or simply left to expire and get filtered out) rather
 * than accumulated forever.
 */
export const loginRequests = pgTable("login_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  /** SHA-256 of the token that goes in the emailed link — the raw
   *  token is never stored, only ever emailed once. */
  tokenHash: text("token_hash").notNull(),
  /** The value the EXTENSION polls with — different from the emailed
   *  token so a leaked poll id (e.g. in a browser history) can't be
   *  used to complete someone else's login. */
  pollId: text("poll_id").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** SHA-256 of the bearer token the extension holds — same principle
   *  as login tokens: never store the thing that grants access. */
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revoked: boolean("revoked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
