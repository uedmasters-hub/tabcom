/**
 * ══════════════════════════════════════════════════════════════
 *  TABCOM LOCAL STORAGE — SQLite persistence layer
 * ══════════════════════════════════════════════════════════════
 *
 *  Privacy-first local database for all mobile activity:
 *  chats, media metadata, communities, board items, connections.
 *
 *  WHY SQLite:
 *   - Binary format — not human-readable by opening the file
 *   - Android encrypts app-private storage at rest (FBE)
 *   - Fast indexed queries — no JSON.parse of giant blobs
 *   - Transactional — no half-written state on crash
 *   - expo-sqlite is built into SDK 57, zero native config
 *
 *  WHAT IS NOT STORED IN SQLITE:
 *   - Session tokens (stays in SecureStore — encrypted keychain)
 *   - Media binary blobs (files live in documentDirectory; SQLite
 *     keeps durable file:// URIs that survive app updates)
 *   - Ephemeral state (typing indicators, online presence)
 *
 *  PRIVACY CONTRACT:
 *   - All data lives ONLY on this device, NEVER uploaded anywhere
 *   - resetAll() wipes everything — called on sign-out
 *   - Media files are referenced by URI, not embedded in the DB
 *   - No analytics, no telemetry, no crash-report payloads from here
 */

import * as SQLite from "expo-sqlite";

// ── Database handle ─────────────────────────────────────────────────

const DB_NAME = "tabcom.db";
let _db: SQLite.SQLiteDatabase | null = null;

function db(): SQLite.SQLiteDatabase {
  if (!_db) {
    _db = SQLite.openDatabaseSync(DB_NAME);
    // WAL mode — concurrent reads while writing, faster on mobile
    _db.execSync("PRAGMA journal_mode = WAL");
    _db.execSync("PRAGMA foreign_keys = ON");
  }
  return _db;
}

// ── Schema ──────────────────────────────────────────────────────────

const SCHEMA_VERSION = 5;

const MIGRATIONS: Record<number, string[]> = {
  1: [
    // ── Contacts ──
    `CREATE TABLE IF NOT EXISTS contacts (
      id           TEXT PRIMARY KEY,
      username     TEXT NOT NULL UNIQUE,
      name         TEXT NOT NULL,
      color        TEXT NOT NULL DEFAULT '#334155',
      alias        TEXT,
      photo_uri    TEXT,
      seeded       INTEGER NOT NULL DEFAULT 0,
      updated_at   INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    )`,

    // ── Conversations ──
    `CREATE TABLE IF NOT EXISTS conversations (
      id              TEXT PRIMARY KEY,
      kind            TEXT NOT NULL CHECK(kind IN ('dm','community')),
      contact_id      TEXT,
      community_id    TEXT,
      unread          INTEGER NOT NULL DEFAULT 0,
      muted           INTEGER NOT NULL DEFAULT 0,
      pinned          INTEGER NOT NULL DEFAULT 0,
      last_message_at INTEGER NOT NULL DEFAULT 0,
      updated_at      INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_conv_last_msg ON conversations(last_message_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_conv_contact ON conversations(contact_id)`,
    `CREATE INDEX IF NOT EXISTS idx_conv_community ON conversations(community_id)`,

    // ── Messages ──
    // The core table. Media payloads (dataUrl) are stored as file URIs
    // pointing to expo-file-system cache, not inline blobs.
    `CREATE TABLE IF NOT EXISTS messages (
      id               TEXT PRIMARY KEY,
      conversation_id  TEXT NOT NULL,
      author_id        TEXT NOT NULL,
      kind             TEXT NOT NULL DEFAULT 'text',
      text             TEXT NOT NULL DEFAULT '',
      url              TEXT,
      media_uri        TEXT,
      thumbnail_uri    TEXT,
      duration_ms      INTEGER,
      file_name        TEXT,
      file_size        INTEGER,
      mime_type        TEXT,
      latitude         REAL,
      longitude        REAL,
      contact_username TEXT,
      contact_name     TEXT,
      contact_color    TEXT,
      sent_at          INTEGER NOT NULL,
      status           TEXT,
      edited_at        INTEGER,
      deleted_at       INTEGER,
      reply_to_id      TEXT,
      author_name      TEXT,
      author_color     TEXT,
      read_at          INTEGER,
      reactions        TEXT,
      created_at       INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, sent_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_msg_author ON messages(author_id)`,
    `CREATE INDEX IF NOT EXISTS idx_msg_kind ON messages(kind)`,

    // ── Connections ──
    `CREATE TABLE IF NOT EXISTS connections (
      username  TEXT PRIMARY KEY,
      status    TEXT NOT NULL DEFAULT 'none',
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    )`,

    // ── Communities ──
    `CREATE TABLE IF NOT EXISTS communities (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      admin           TEXT NOT NULL,
      members         TEXT NOT NULL DEFAULT '[]',
      pending_for_me  INTEGER NOT NULL DEFAULT 0,
      pending_invites TEXT NOT NULL DEFAULT '[]',
      board_decided_id TEXT,
      image_version   INTEGER,
      updated_at      INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    )`,

    // ── Board items (shared tabs, per community) ──
    `CREATE TABLE IF NOT EXISTS board_items (
      id             TEXT PRIMARY KEY,
      community_id   TEXT NOT NULL,
      url            TEXT NOT NULL,
      canonical_key  TEXT NOT NULL,
      title          TEXT NOT NULL DEFAULT '',
      image          TEXT,
      site_name      TEXT,
      added_by       TEXT NOT NULL,
      added_at       INTEGER NOT NULL,
      decided        INTEGER NOT NULL DEFAULT 0,
      votes          TEXT NOT NULL DEFAULT '[]',
      updated_at     INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
      FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_board_community ON board_items(community_id)`,

    // ── Board annotations (pins, areas, highlights) ──
    `CREATE TABLE IF NOT EXISTS board_annotations (
      id             TEXT PRIMARY KEY,
      board_item_id  TEXT NOT NULL,
      type           TEXT NOT NULL CHECK(type IN ('pin','area','highlight')),
      author         TEXT NOT NULL,
      text           TEXT NOT NULL DEFAULT '',
      sent_at        INTEGER NOT NULL,
      data           TEXT NOT NULL DEFAULT '{}',
      updated_at     INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
      FOREIGN KEY (board_item_id) REFERENCES board_items(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_annot_item ON board_annotations(board_item_id)`,

    // ── Board/annotation comments ──
    `CREATE TABLE IF NOT EXISTS board_comments (
      id              TEXT PRIMARY KEY,
      parent_type     TEXT NOT NULL CHECK(parent_type IN ('board_item','annotation')),
      parent_id       TEXT NOT NULL,
      author          TEXT NOT NULL,
      text            TEXT NOT NULL DEFAULT '',
      sent_at         INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_bcomment_parent ON board_comments(parent_type, parent_id)`,

    // ── Media registry ──
    // Tracks every media file on disk — kind, source conversation,
    // file path, size. Used for storage management and export.
    `CREATE TABLE IF NOT EXISTS media (
      id               TEXT PRIMARY KEY,
      message_id       TEXT,
      conversation_id  TEXT,
      kind             TEXT NOT NULL,
      file_uri         TEXT NOT NULL,
      file_name        TEXT,
      file_size        INTEGER,
      mime_type        TEXT,
      duration_ms      INTEGER,
      width            INTEGER,
      height           INTEGER,
      created_at       INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_media_conv ON media(conversation_id)`,
    `CREATE INDEX IF NOT EXISTS idx_media_msg ON media(message_id)`,

    // ── Activity log ──
    // Privacy: logs WHAT happened, never message content or media.
    `CREATE TABLE IF NOT EXISTS activity_log (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      category     TEXT NOT NULL,
      action       TEXT NOT NULL,
      entity_type  TEXT,
      entity_id    TEXT,
      meta         TEXT,
      created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_activity_cat ON activity_log(category)`,
    `CREATE INDEX IF NOT EXISTS idx_activity_time ON activity_log(created_at DESC)`,

    // ── Schema version tracker ──
    `CREATE TABLE IF NOT EXISTS _meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  ],

  // ── v2: Notes ──
  // A note is a message that also pins to the chat-list wall until
  // read or dismissed. The wall lifecycle is purely local — the
  // server has no concept of it — so it lives entirely here.
  2: [
    `CREATE TABLE IF NOT EXISTS notes (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      contact_id      TEXT NOT NULL,
      from_username   TEXT NOT NULL DEFAULT '',
      from_name       TEXT NOT NULL DEFAULT '',
      from_color      TEXT NOT NULL DEFAULT '#2563eb',
      text            TEXT NOT NULL DEFAULT '',
      image_uri       TEXT,
      sent_at         INTEGER NOT NULL,
      read_at         INTEGER,
      outgoing        INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS idx_notes_sent ON notes(sent_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_notes_conv ON notes(conversation_id)`,
  ],
  3: [
    // Soft pastel fill for each wall card. Nullable so hydration can
    // stamp a stable per-id pastel onto rows that predate this column.
    `ALTER TABLE notes ADD COLUMN bg_color TEXT`,
  ],
  4: [
    `ALTER TABLE messages ADD COLUMN album_id TEXT`,
    `ALTER TABLE messages ADD COLUMN album_index INTEGER`,
    `ALTER TABLE messages ADD COLUMN album_count INTEGER`,
    `CREATE INDEX IF NOT EXISTS idx_msg_album ON messages(album_id)`,
  ],
  5: [
    `CREATE TABLE IF NOT EXISTS call_history (
      id              TEXT PRIMARY KEY,
      peer_username   TEXT NOT NULL,
      peer_name       TEXT NOT NULL DEFAULT '',
      peer_color      TEXT NOT NULL DEFAULT '#2563eb',
      direction       TEXT NOT NULL CHECK(direction IN ('outgoing','incoming')),
      video           INTEGER NOT NULL DEFAULT 0,
      outcome         TEXT NOT NULL,
      started_at      INTEGER NOT NULL,
      ended_at        INTEGER,
      duration_ms     INTEGER,
      quick_reply     TEXT,
      seen            INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS idx_calls_started ON call_history(started_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_calls_peer ON call_history(peer_username)`,
  ],
};

// ── Initialization ──────────────────────────────────────────────────

let _initialized = false;

export function initLocalStorage(): void {
  if (_initialized) return;
  const d = db();

  // Check current version
  let currentVersion = 0;
  try {
    const row = d.getFirstSync<{ value: string }>(
      "SELECT value FROM _meta WHERE key = 'schema_version'"
    );
    if (row) currentVersion = parseInt(row.value, 10) || 0;
  } catch {
    // _meta doesn't exist yet — first run
  }

  // Run migrations
  for (let v = currentVersion + 1; v <= SCHEMA_VERSION; v++) {
    const stmts = MIGRATIONS[v];
    if (!stmts) continue;
    d.execSync("BEGIN TRANSACTION");
    try {
      for (const sql of stmts) d.execSync(sql);
      d.execSync(
        `INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', '${v}')`
      );
      d.execSync("COMMIT");
    } catch (err) {
      d.execSync("ROLLBACK");
      throw err;
    }
  }

  _initialized = true;
}

// ── Contact operations ──────────────────────────────────────────────

export function upsertContact(c: {
  id: string;
  username: string;
  name: string;
  color: string;
  alias?: string;
  photoUri?: string;
  seeded?: boolean;
}): void {
  db().runSync(
    `INSERT INTO contacts (id, username, name, color, alias, photo_uri, seeded, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       color = excluded.color,
       alias = COALESCE(excluded.alias, contacts.alias),
       photo_uri = COALESCE(excluded.photo_uri, contacts.photo_uri),
       updated_at = excluded.updated_at`,
    c.id, c.username, c.name, c.color,
    c.alias ?? null, c.photoUri ?? null,
    c.seeded ? 1 : 0, Date.now()
  );
}

export function upsertContacts(contacts: Array<{
  id: string; username: string; name: string; color: string;
  alias?: string; seeded?: boolean;
}>): void {
  const d = db();
  d.execSync("BEGIN TRANSACTION");
  try {
    for (const c of contacts) upsertContact(c);
    d.execSync("COMMIT");
  } catch (err) {
    d.execSync("ROLLBACK");
    throw err;
  }
}

export function getContact(id: string) {
  return db().getFirstSync<{
    id: string; username: string; name: string; color: string;
    alias: string | null; photo_uri: string | null; seeded: number;
  }>("SELECT * FROM contacts WHERE id = ?", id);
}

export function getAllContacts() {
  return db().getAllSync<{
    id: string; username: string; name: string; color: string;
    alias: string | null; photo_uri: string | null; seeded: number;
  }>("SELECT * FROM contacts ORDER BY name");
}

export function updateContactAlias(id: string, alias: string | null): void {
  db().runSync(
    "UPDATE contacts SET alias = ?, updated_at = ? WHERE id = ?",
    alias, Date.now(), id
  );
}

export function deleteContact(id: string): void {
  db().runSync("DELETE FROM contacts WHERE id = ?", id);
}

export function clearSeededContacts(): void {
  db().runSync("DELETE FROM contacts WHERE seeded = 1");
}

// ── Conversation operations ─────────────────────────────────────────

export function upsertConversation(c: {
  id: string;
  kind: "dm" | "community";
  contactId?: string;
  communityId?: string;
  unread?: number;
  lastMessageAt?: number;
}): void {
  db().runSync(
    `INSERT INTO conversations (id, kind, contact_id, community_id, unread, last_message_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       unread = COALESCE(excluded.unread, conversations.unread),
       last_message_at = MAX(conversations.last_message_at, COALESCE(excluded.last_message_at, 0)),
       updated_at = excluded.updated_at`,
    c.id, c.kind, c.contactId ?? null, c.communityId ?? null,
    c.unread ?? 0, c.lastMessageAt ?? 0, Date.now()
  );
}

export function getConversations() {
  return db().getAllSync<{
    id: string; kind: string; contact_id: string | null;
    community_id: string | null; unread: number; muted: number;
    pinned: number; last_message_at: number;
  }>("SELECT * FROM conversations ORDER BY last_message_at DESC");
}

export function markConversationRead(id: string): void {
  db().runSync(
    "UPDATE conversations SET unread = 0, updated_at = ? WHERE id = ?",
    Date.now(), id
  );
}

export function incrementUnread(conversationId: string): void {
  db().runSync(
    "UPDATE conversations SET unread = unread + 1, updated_at = ? WHERE id = ?",
    Date.now(), conversationId
  );
}

export function toggleMuted(conversationId: string, muted: boolean): void {
  db().runSync(
    "UPDATE conversations SET muted = ?, updated_at = ? WHERE id = ?",
    muted ? 1 : 0, Date.now(), conversationId
  );
}

export function togglePinned(conversationId: string, pinned: boolean): void {
  db().runSync(
    "UPDATE conversations SET pinned = ?, updated_at = ? WHERE id = ?",
    pinned ? 1 : 0, Date.now(), conversationId
  );
}

export function deleteConversation(id: string): void {
  const d = db();
  d.execSync("BEGIN TRANSACTION");
  try {
    d.runSync("DELETE FROM messages WHERE conversation_id = ?", id);
    d.runSync("DELETE FROM media WHERE conversation_id = ?", id);
    d.runSync("DELETE FROM conversations WHERE id = ?", id);
    d.execSync("COMMIT");
  } catch (err) {
    d.execSync("ROLLBACK");
    throw err;
  }
}

// ── Message operations ──────────────────────────────────────────────

export interface StoredMessage {
  id: string;
  conversation_id: string;
  author_id: string;
  kind: string;
  text: string;
  url: string | null;
  media_uri: string | null;
  thumbnail_uri: string | null;
  duration_ms: number | null;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  latitude: number | null;
  longitude: number | null;
  contact_username: string | null;
  contact_name: string | null;
  contact_color: string | null;
  sent_at: number;
  status: string | null;
  edited_at: number | null;
  deleted_at: number | null;
  reply_to_id: string | null;
  author_name: string | null;
  author_color: string | null;
  read_at: number | null;
  reactions: string | null;
  album_id: string | null;
  album_index: number | null;
  album_count: number | null;
}

export function insertMessage(m: {
  id: string;
  conversationId: string;
  authorId: string;
  kind: string;
  text: string;
  url?: string;
  mediaUri?: string;
  thumbnailUri?: string;
  durationMs?: number;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  latitude?: number;
  longitude?: number;
  contactUsername?: string;
  contactName?: string;
  contactColor?: string;
  sentAt: number;
  status?: string;
  replyToId?: string;
  authorName?: string;
  authorColor?: string;
  reactions?: string;
  albumId?: string;
  albumIndex?: number;
  albumCount?: number;
}): void {
  db().runSync(
    `INSERT OR IGNORE INTO messages (
      id, conversation_id, author_id, kind, text, url,
      media_uri, thumbnail_uri, duration_ms,
      file_name, file_size, mime_type,
      latitude, longitude,
      contact_username, contact_name, contact_color,
      sent_at, status, reply_to_id,
      author_name, author_color, reactions,
      album_id, album_index, album_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    m.id, m.conversationId, m.authorId, m.kind, m.text,
    m.url ?? null, m.mediaUri ?? null, m.thumbnailUri ?? null,
    m.durationMs ?? null, m.fileName ?? null, m.fileSize ?? null,
    m.mimeType ?? null, m.latitude ?? null, m.longitude ?? null,
    m.contactUsername ?? null, m.contactName ?? null, m.contactColor ?? null,
    m.sentAt, m.status ?? null, m.replyToId ?? null,
    m.authorName ?? null, m.authorColor ?? null, m.reactions ?? null,
    m.albumId ?? null, m.albumIndex ?? null, m.albumCount ?? null,
    Date.now()
  );
}

export function getMessages(
  conversationId: string,
  limit = 50,
  beforeSentAt?: number
): StoredMessage[] {
  if (beforeSentAt) {
    return db().getAllSync<StoredMessage>(
      `SELECT * FROM messages
       WHERE conversation_id = ? AND sent_at < ? AND deleted_at IS NULL
       ORDER BY sent_at DESC LIMIT ?`,
      conversationId, beforeSentAt, limit
    );
  }
  return db().getAllSync<StoredMessage>(
    `SELECT * FROM messages
     WHERE conversation_id = ? AND deleted_at IS NULL
     ORDER BY sent_at DESC LIMIT ?`,
    conversationId, limit
  );
}

export function getMessage(id: string) {
  return db().getFirstSync<StoredMessage>(
    "SELECT * FROM messages WHERE id = ?", id
  );
}

export function updateMessageStatus(id: string, status: string): void {
  db().runSync(
    "UPDATE messages SET status = ? WHERE id = ?", status, id
  );
}

export function updateMessageText(id: string, text: string, editedAt: number): void {
  db().runSync(
    "UPDATE messages SET text = ?, edited_at = ? WHERE id = ?",
    text, editedAt, id
  );
}

export function softDeleteMessage(id: string): void {
  db().runSync(
    "UPDATE messages SET deleted_at = ?, text = '' WHERE id = ?",
    Date.now(), id
  );
}

export function updateMessageReadAt(id: string, readAt: number): void {
  db().runSync(
    "UPDATE messages SET read_at = ? WHERE id = ?", readAt, id
  );
}

export function updateMessageReactions(id: string, reactions: string): void {
  db().runSync(
    "UPDATE messages SET reactions = ? WHERE id = ?", reactions, id
  );
}

/** Point a message at durable on-disk media after the blob is written. */
export function updateMessageMediaUri(
  id: string,
  mediaUri: string,
  thumbnailUri?: string | null
): void {
  if (thumbnailUri) {
    db().runSync(
      "UPDATE messages SET media_uri = ?, thumbnail_uri = ? WHERE id = ?",
      mediaUri,
      thumbnailUri,
      id
    );
  } else {
    db().runSync(
      "UPDATE messages SET media_uri = ? WHERE id = ?",
      mediaUri,
      id
    );
  }
}

export function getMediaByMessageId(messageId: string) {
  return db().getFirstSync<{
    id: string;
    message_id: string | null;
    kind: string;
    file_uri: string;
    file_name: string | null;
  }>("SELECT * FROM media WHERE message_id = ? LIMIT 1", messageId);
}

/** Every non-deleted message in a conversation (newest first). */
export function getAllMessages(conversationId: string): StoredMessage[] {
  return db().getAllSync<StoredMessage>(
    `SELECT * FROM messages
     WHERE conversation_id = ? AND deleted_at IS NULL
     ORDER BY sent_at DESC`,
    conversationId
  );
}

export function getMessagesMissingMedia(): StoredMessage[] {
  return db().getAllSync<StoredMessage>(
    `SELECT * FROM messages
     WHERE deleted_at IS NULL
       AND kind IN ('image','video','voice','file','note')
       AND (media_uri IS NULL OR media_uri = '')`
  );
}

export function messageExists(id: string): boolean {
  const row = db().getFirstSync<{ c: number }>(
    "SELECT COUNT(*) as c FROM messages WHERE id = ?", id
  );
  return (row?.c ?? 0) > 0;
}

export function searchMessages(query: string, limit = 30) {
  const like = `%${query}%`;
  return db().getAllSync<StoredMessage & { conversation_id: string }>(
    `SELECT * FROM messages
     WHERE text LIKE ? AND deleted_at IS NULL
     ORDER BY sent_at DESC LIMIT ?`,
    like, limit
  );
}

export function getMessageCountByConversation(conversationId: string): number {
  const row = db().getFirstSync<{ c: number }>(
    "SELECT COUNT(*) as c FROM messages WHERE conversation_id = ?",
    conversationId
  );
  return row?.c ?? 0;
}

// ── Connection operations ───────────────────────────────────────────

export function upsertConnection(username: string, status: string): void {
  db().runSync(
    `INSERT INTO connections (username, status, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
    username, status, Date.now()
  );
}

export function getConnections() {
  return db().getAllSync<{ username: string; status: string }>(
    "SELECT * FROM connections"
  );
}

export function deleteConnection(username: string): void {
  db().runSync("DELETE FROM connections WHERE username = ?", username);
}

// ── Community operations ────────────────────────────────────────────

export function upsertCommunity(c: {
  id: string;
  name: string;
  admin: string;
  members: unknown[];
  pendingForMe: boolean;
  pendingInvites?: unknown[];
  boardDecidedId?: string;
  imageVersion?: number;
}): void {
  db().runSync(
    `INSERT INTO communities (id, name, admin, members, pending_for_me, pending_invites, board_decided_id, image_version, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       admin = excluded.admin,
       members = excluded.members,
       pending_for_me = excluded.pending_for_me,
       pending_invites = excluded.pending_invites,
       board_decided_id = excluded.board_decided_id,
       image_version = excluded.image_version,
       updated_at = excluded.updated_at`,
    c.id, c.name, c.admin,
    JSON.stringify(c.members),
    c.pendingForMe ? 1 : 0,
    JSON.stringify(c.pendingInvites ?? []),
    c.boardDecidedId ?? null,
    c.imageVersion ?? null,
    Date.now()
  );
}

export function getCommunity(id: string) {
  return db().getFirstSync<{
    id: string; name: string; admin: string; members: string;
    pending_for_me: number; pending_invites: string;
    board_decided_id: string | null; image_version: number | null;
  }>("SELECT * FROM communities WHERE id = ?", id);
}

export function getAllCommunities() {
  return db().getAllSync<{
    id: string; name: string; admin: string; members: string;
    pending_for_me: number; pending_invites: string;
    board_decided_id: string | null; image_version: number | null;
  }>("SELECT * FROM communities ORDER BY name");
}

export function deleteCommunity(id: string): void {
  const d = db();
  d.execSync("BEGIN TRANSACTION");
  try {
    d.runSync("DELETE FROM board_comments WHERE parent_id IN (SELECT id FROM board_annotations WHERE board_item_id IN (SELECT id FROM board_items WHERE community_id = ?))", id);
    d.runSync("DELETE FROM board_annotations WHERE board_item_id IN (SELECT id FROM board_items WHERE community_id = ?)", id);
    d.runSync("DELETE FROM board_comments WHERE parent_type = 'board_item' AND parent_id IN (SELECT id FROM board_items WHERE community_id = ?)", id);
    d.runSync("DELETE FROM board_items WHERE community_id = ?", id);
    d.runSync("DELETE FROM communities WHERE id = ?", id);
    d.execSync("COMMIT");
  } catch (err) {
    d.execSync("ROLLBACK");
    throw err;
  }
}

// ── Board item operations ───────────────────────────────────────────

export function upsertBoardItem(item: {
  id: string;
  communityId: string;
  url: string;
  canonicalKey: string;
  title: string;
  image?: string;
  siteName?: string;
  addedBy: string;
  addedAt: number;
  decided?: boolean;
  votes?: string[];
}): void {
  db().runSync(
    `INSERT INTO board_items (id, community_id, url, canonical_key, title, image, site_name, added_by, added_at, decided, votes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, image = excluded.image,
       decided = excluded.decided, votes = excluded.votes,
       updated_at = excluded.updated_at`,
    item.id, item.communityId, item.url, item.canonicalKey,
    item.title, item.image ?? null, item.siteName ?? null,
    item.addedBy, item.addedAt, item.decided ? 1 : 0,
    JSON.stringify(item.votes ?? []), Date.now()
  );
}

export function getBoardItems(communityId: string) {
  return db().getAllSync<{
    id: string; community_id: string; url: string; canonical_key: string;
    title: string; image: string | null; site_name: string | null;
    added_by: string; added_at: number; decided: number; votes: string;
  }>(
    "SELECT * FROM board_items WHERE community_id = ? ORDER BY added_at DESC",
    communityId
  );
}

export function deleteBoardItem(id: string): void {
  const d = db();
  d.execSync("BEGIN TRANSACTION");
  try {
    d.runSync("DELETE FROM board_comments WHERE parent_id IN (SELECT id FROM board_annotations WHERE board_item_id = ?)", id);
    d.runSync("DELETE FROM board_annotations WHERE board_item_id = ?", id);
    d.runSync("DELETE FROM board_comments WHERE parent_type = 'board_item' AND parent_id = ?", id);
    d.runSync("DELETE FROM board_items WHERE id = ?", id);
    d.execSync("COMMIT");
  } catch (err) {
    d.execSync("ROLLBACK");
    throw err;
  }
}

// ── Board annotation operations ─────────────────────────────────────

export function upsertAnnotation(a: {
  id: string;
  boardItemId: string;
  type: "pin" | "area" | "highlight";
  author: string;
  text: string;
  sentAt: number;
  data: Record<string, unknown>;
}): void {
  db().runSync(
    `INSERT INTO board_annotations (id, board_item_id, type, author, text, sent_at, data, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET text = excluded.text, data = excluded.data, updated_at = excluded.updated_at`,
    a.id, a.boardItemId, a.type, a.author, a.text, a.sentAt,
    JSON.stringify(a.data), Date.now()
  );
}

export function getAnnotations(boardItemId: string) {
  return db().getAllSync<{
    id: string; board_item_id: string; type: string; author: string;
    text: string; sent_at: number; data: string;
  }>(
    "SELECT * FROM board_annotations WHERE board_item_id = ? ORDER BY sent_at",
    boardItemId
  );
}

// ── Board comment operations ────────────────────────────────────────

export function insertBoardComment(c: {
  id: string;
  parentType: "board_item" | "annotation";
  parentId: string;
  author: string;
  text: string;
  sentAt: number;
}): void {
  db().runSync(
    `INSERT OR IGNORE INTO board_comments (id, parent_type, parent_id, author, text, sent_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    c.id, c.parentType, c.parentId, c.author, c.text, c.sentAt
  );
}

export function getBoardComments(parentType: string, parentId: string) {
  return db().getAllSync<{
    id: string; parent_type: string; parent_id: string;
    author: string; text: string; sent_at: number;
  }>(
    "SELECT * FROM board_comments WHERE parent_type = ? AND parent_id = ? ORDER BY sent_at",
    parentType, parentId
  );
}

// ── Media registry ──────────────────────────────────────────────────

export function registerMedia(m: {
  id: string;
  messageId?: string;
  conversationId?: string;
  kind: string;
  fileUri: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  durationMs?: number;
  width?: number;
  height?: number;
}): void {
  db().runSync(
    `INSERT OR REPLACE INTO media (id, message_id, conversation_id, kind, file_uri, file_name, file_size, mime_type, duration_ms, width, height, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    m.id, m.messageId ?? null, m.conversationId ?? null,
    m.kind, m.fileUri, m.fileName ?? null, m.fileSize ?? null,
    m.mimeType ?? null, m.durationMs ?? null,
    m.width ?? null, m.height ?? null, Date.now()
  );
}

export function getMediaByConversation(conversationId: string) {
  return db().getAllSync<{
    id: string; message_id: string | null; kind: string;
    file_uri: string; file_name: string | null; file_size: number | null;
    mime_type: string | null; created_at: number;
  }>(
    "SELECT * FROM media WHERE conversation_id = ? ORDER BY created_at DESC",
    conversationId
  );
}

export function getMediaByKind(kind: string, limit = 50) {
  return db().getAllSync<{
    id: string; message_id: string | null; conversation_id: string | null;
    kind: string; file_uri: string; file_name: string | null;
    file_size: number | null; mime_type: string | null; created_at: number;
  }>(
    "SELECT * FROM media WHERE kind = ? ORDER BY created_at DESC LIMIT ?",
    kind, limit
  );
}

export function getTotalMediaSize(): number {
  const row = db().getFirstSync<{ total: number }>(
    "SELECT COALESCE(SUM(file_size), 0) as total FROM media"
  );
  return row?.total ?? 0;
}

export function deleteMediaRecord(id: string): void {
  db().runSync("DELETE FROM media WHERE id = ?", id);
}

// ── Activity log ────────────────────────────────────────────────────

export type ActivityCategory =
  | "message"
  | "call"
  | "connection"
  | "community"
  | "board"
  | "media"
  | "settings";

export function logActivity(
  category: ActivityCategory,
  action: string,
  entityType?: string,
  entityId?: string,
  meta?: Record<string, unknown>
): void {
  db().runSync(
    `INSERT INTO activity_log (category, action, entity_type, entity_id, meta, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    category, action, entityType ?? null, entityId ?? null,
    meta ? JSON.stringify(meta) : null, Date.now()
  );
}

export function getActivityLog(limit = 100, beforeId?: number) {
  if (beforeId) {
    return db().getAllSync<{
      id: number; category: string; action: string;
      entity_type: string | null; entity_id: string | null;
      meta: string | null; created_at: number;
    }>(
      "SELECT * FROM activity_log WHERE id < ? ORDER BY id DESC LIMIT ?",
      beforeId, limit
    );
  }
  return db().getAllSync<{
    id: number; category: string; action: string;
    entity_type: string | null; entity_id: string | null;
    meta: string | null; created_at: number;
  }>(
    "SELECT * FROM activity_log ORDER BY id DESC LIMIT ?", limit
  );
}

export function getActivityByCategory(category: string, limit = 50) {
  return db().getAllSync<{
    id: number; category: string; action: string;
    entity_type: string | null; entity_id: string | null;
    meta: string | null; created_at: number;
  }>(
    "SELECT * FROM activity_log WHERE category = ? ORDER BY id DESC LIMIT ?",
    category, limit
  );
}

export function clearActivityLog(): void {
  db().runSync("DELETE FROM activity_log");
}

// ── Storage stats ───────────────────────────────────────────────────

export interface StorageStats {
  messageCount: number;
  contactCount: number;
  conversationCount: number;
  communityCount: number;
  mediaCount: number;
  mediaSizeBytes: number;
  activityCount: number;
}

export function getStorageStats(): StorageStats {
  const d = db();
  const count = (table: string) =>
    d.getFirstSync<{ c: number }>(`SELECT COUNT(*) as c FROM ${table}`)?.c ?? 0;

  return {
    messageCount: count("messages"),
    contactCount: count("contacts"),
    conversationCount: count("conversations"),
    communityCount: count("communities"),
    mediaCount: count("media"),
    mediaSizeBytes: getTotalMediaSize(),
    activityCount: count("activity_log"),
  };
}

// ── Notes ───────────────────────────────────────────────────────────

export interface StoredNote {
  id: string;
  conversation_id: string;
  contact_id: string;
  from_username: string;
  from_name: string;
  from_color: string;
  text: string;
  image_uri: string | null;
  sent_at: number;
  read_at: number | null;
  outgoing: number;
  bg_color: string | null;
}

export function upsertNote(n: {
  id: string;
  conversationId: string;
  contactId: string;
  fromUsername: string;
  fromName: string;
  fromColor: string;
  bgColor: string;
  text: string;
  imageUri?: string;
  sentAt: number;
  readAt?: number;
  outgoing: boolean;
}): void {
  db().runSync(
    `INSERT INTO notes (
       id, conversation_id, contact_id, from_username, from_name,
       from_color, bg_color, text, image_uri, sent_at, read_at, outgoing
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       read_at   = excluded.read_at,
       image_uri = COALESCE(excluded.image_uri, notes.image_uri),
       text      = excluded.text,
       bg_color  = COALESCE(notes.bg_color, excluded.bg_color)`,
    n.id, n.conversationId, n.contactId, n.fromUsername, n.fromName,
    n.fromColor, n.bgColor, n.text, n.imageUri ?? null, n.sentAt,
    n.readAt ?? null, n.outgoing ? 1 : 0
  );
}

export function getNotes(): StoredNote[] {
  return db().getAllSync<StoredNote>(
    "SELECT * FROM notes ORDER BY sent_at DESC"
  );
}

export function deleteNote(id: string): void {
  db().runSync("DELETE FROM notes WHERE id = ?", id);
}

export function clearNotes(): void {
  db().runSync("DELETE FROM notes");
}

/** Swap a note's inline data URL for a persisted file URI. */
export function updateNoteImageUri(id: string, uri: string): void {
  db().runSync("UPDATE notes SET image_uri = ? WHERE id = ?", uri, id);
}

// ── Nuclear reset ───────────────────────────────────────────────────

/** Wipe EVERYTHING — called on sign-out. */
// ── Call history ────────────────────────────────────────────────────

export type CallOutcome =
  | "answered"
  | "missed"
  | "declined"
  | "busy"
  | "cancelled"
  | "failed"
  | "timed_out"
  | "offline";

export interface StoredCall {
  id: string;
  peer_username: string;
  peer_name: string;
  peer_color: string;
  direction: "outgoing" | "incoming";
  video: number;
  outcome: CallOutcome;
  started_at: number;
  ended_at: number | null;
  duration_ms: number | null;
  quick_reply: string | null;
  seen: number;
}

export function insertCall(c: {
  id: string;
  peerUsername: string;
  peerName: string;
  peerColor: string;
  direction: "outgoing" | "incoming";
  video: boolean;
  outcome: CallOutcome;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  quickReply?: string;
  seen?: boolean;
}): void {
  db().runSync(
    `INSERT OR REPLACE INTO call_history (
      id, peer_username, peer_name, peer_color, direction, video,
      outcome, started_at, ended_at, duration_ms, quick_reply, seen
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    c.id,
    c.peerUsername,
    c.peerName,
    c.peerColor,
    c.direction,
    c.video ? 1 : 0,
    c.outcome,
    c.startedAt,
    c.endedAt ?? null,
    c.durationMs ?? null,
    c.quickReply ?? null,
    c.seen === false ? 0 : 1
  );
}

export function getRecentCalls(limit = 30): StoredCall[] {
  return db().getAllSync<StoredCall>(
    `SELECT * FROM call_history ORDER BY started_at DESC LIMIT ?`,
    limit
  );
}

export function markMissedCallsSeen(): void {
  db().runSync(
    `UPDATE call_history SET seen = 1 WHERE outcome = 'missed' AND seen = 0`
  );
}

export function getUnseenMissedCount(): number {
  const row = db().getFirstSync<{ c: number }>(
    `SELECT COUNT(*) as c FROM call_history WHERE outcome = 'missed' AND seen = 0`
  );
  return row?.c ?? 0;
}

export function resetAll(): void {
  const d = db();
  d.execSync("BEGIN TRANSACTION");
  try {
    d.execSync("DELETE FROM notes");
    d.execSync("DELETE FROM call_history");
    d.execSync("DELETE FROM activity_log");
    d.execSync("DELETE FROM board_comments");
    d.execSync("DELETE FROM board_annotations");
    d.execSync("DELETE FROM board_items");
    d.execSync("DELETE FROM media");
    d.execSync("DELETE FROM messages");
    d.execSync("DELETE FROM connections");
    d.execSync("DELETE FROM communities");
    d.execSync("DELETE FROM conversations");
    d.execSync("DELETE FROM contacts");
    d.execSync("COMMIT");
  } catch (err) {
    d.execSync("ROLLBACK");
    throw err;
  }
}

/** Close the database connection. */
export function closeLocalStorage(): void {
  if (_db) {
    _db.closeSync();
    _db = null;
    _initialized = false;
  }
}
