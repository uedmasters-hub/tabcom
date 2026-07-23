import {
  boolean,
  jsonb,
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

/**
 * Single-use invitation codes — Tabcom is invite-only. Every new
 * account is granted a fixed allowance of codes to hand out (see
 * INVITES_PER_USER in auth/invites.ts), forming a simple invite tree.
 *
 * The master code is deliberately NOT in this table: it lives in the
 * TABCOM_MASTER_INVITE env var, is multi-use, and grants the operator
 * a way in that can't be consumed or leaked via a database dump.
 */
export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Human-shareable code, e.g. TAB-7F3K-Q2ND — uppercase, no
   *  ambiguous characters (0/O, 1/I/L are excluded). */
  code: text("code").notNull().unique(),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Null until redeemed. Set atomically at registration so a code
   *  can never admit two people, even in a race. */
  usedBy: uuid("used_by").references(() => users.id, {
    onDelete: "set null",
  }),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Single source of truth for sessions — both registered (tied to a
 * user row) and guest (tied only to a guest username, never a user
 * row, since guests never get one). Extended from the original
 * registered-only shape to support:
 *   - device recognition (deviceId — a random id the extension
 *     generates once and keeps in local storage, NOT a hardware/MAC
 *     fingerprint: browsers don't expose that to any web or extension
 *     code, for the same privacy reasons this project cares about)
 *   - an explicit lifecycle status, rather than inferring "expired"
 *     from a timestamp comparison scattered across call sites
 *   - guest sessions existing in this table at all, which they
 *     previously didn't — guest identity was purely local/client-side
 *     with zero server-side record.
 */
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Null for guest sessions — guests never get a user row. */
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  /** Set instead of userId for guest sessions — the guest's assigned
   *  username (e.g. "quiet_heron645"), which is that guest's entire
   *  identity for the session's lifetime. */
  guestUsername: text("guest_username"),
  /** A random id the extension generates once and keeps in a storage
   *  key that survives sign-out/guest-expiry resets — see
   *  device-id.ts. This is what "device recognition" actually means
   *  here: recognizing the same browser profile across restarts, not
   *  a true hardware fingerprint.
   *
   *  Null briefly for a magic-link session between the moment the
   *  link is clicked (in whatever browser tab the email client opens
   *  — which has no way to know the EXTENSION's device id) and the
   *  moment the extension itself retrieves the token via /auth/poll,
   *  at which point it's filled in — see pollLoginRequest. */
  deviceId: text("device_id"),
  /** User-agent / platform string — informational only, never used
   *  for any access decision. */
  browserInfo: text("browser_info"),
  /** SHA-256 of the bearer token, same principle as everywhere else
   *  in this file: never store the thing that grants access. Null for
   *  guest sessions, which authenticate via their live socket
   *  connection's identity, not a bearer token. */
  tokenHash: text("token_hash").unique(),
  sessionType: text("session_type").notNull().default("registered"), // "registered" | "guest"
  /** "active" | "expired" | "revoked" — expired/revoked are set
   *  explicitly (a background sweep for expired-by-time guest
   *  sessions, or an explicit action for revoked) rather than left
   *  for every caller to independently infer from expiresAt. */
  status: text("status").notNull().default("active"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revoked: boolean("revoked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Durable snapshot of the server's in-memory relationship state
 * (communities, boards/pins/areas/highlights, connections, blocks,
 * presence masks) — everything index.ts's saveState()/loadState() used
 * to write to a local JSON file (data/tabcom-state.json).
 *
 * That file lived on local disk, which is fine under `tsx watch`
 * restarts (same disk, same directory) but NOT fine on ephemeral-disk hosts: a
 * (any container host) spins up a brand-new container with
 * a wiped filesystem on every redeploy and every spin-down/spin-up
 * cycle after idling. The file was being silently recreated empty on
 * every cold start — which is exactly what "a community got
 * automatically deleted" looks like from the outside. Postgres (Neon)
 * is the durable store this project already has for exactly this
 * reason; a single JSONB row is the least invasive fix — same snapshot
 * shape, same save/load logic, just no longer erased by a restart.
 *
 * One row, fixed key — this is whole-server state, not per-user.
 */
export const boardState = pgTable("board_state", {
  key: text("key").primaryKey(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Phase 2 of session management: server-side settings/preferences for
 * REGISTERED users only (guests never get one — their settings stay
 * local-only and ephemeral, consistent with everything else about a
 * guest identity being disposable by design). One JSONB blob per user
 * rather than a normalized column per toggle — same reasoning as
 * board_state: whatever the client wants to sync (visibility, live
 * cursors on/off, and any future toggle) just goes in, with no schema
 * migration needed every time a new preference is added.
 */
export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Durable, structured, per-user activity log — exportable as a report.
 * Deliberately covers membership and board (tabs/pins/areas) events
 * ONLY. It does NOT log message content, or even the text typed into
 * a pin/area annotation — just that the event happened, on which page,
 * in which community. This is a conscious choice to extend the
 * project's zero-message-retention guarantee to this table too, not
 * an oversight: a "detail" column that's tempting to fill with a pin's
 * actual text would quietly turn an activity log into a message log.
 *
 * communityId/communityName are stored as plain values rather than a
 * foreign key — communities live in the in-memory `communities` Map
 * (+ the board_state snapshot above), not a relational table, and
 * denormalizing the name means the report still reads sensibly even
 * after a community is renamed or later deleted.
 */
export const communityActivity = pgTable("community_activity", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: text("community_id").notNull(),
  communityName: text("community_name").notNull(),
  username: text("username").notNull(),
  /** One of: community_created, joined, left, tab_added, tab_removed,
   *  pin_added, pin_removed, area_added, area_removed. */
  action: text("action").notNull(),
  /** Non-sensitive context only — a page title/URL, never pin/area/
   *  message text. Null for events that don't have a natural page
   *  context (joined, left, community_created). */
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Uploaded community logo/avatar images, stored directly in Postgres
 * rather than an external object store — there isn't one provisioned
 * for this project, and community images are small (capped at upload
 * time, see index.ts) and infrequently changed, so a database row is
 * the pragmatic choice here rather than a new infrastructure
 * dependency. One row per community, overwritten on re-upload.
 */
export const communityImages = pgTable("community_images", {
  communityId: text("community_id").primaryKey(),
  mimeType: text("mime_type").notNull(),
  /** Base64-encoded image bytes. */
  data: text("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
