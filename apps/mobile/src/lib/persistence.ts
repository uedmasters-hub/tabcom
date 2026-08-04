/**
 * ══════════════════════════════════════════════════════════════
 *  PERSISTENCE BRIDGE — Zustand ↔ SQLite
 * ══════════════════════════════════════════════════════════════
 *
 *  Subscribes to the chat store and writes every mutation to SQLite.
 *  On cold start, hydrates the store FROM SQLite so the user sees
 *  their conversations, messages, and communities immediately —
 *  before the socket even connects.
 *
 *  Design:
 *   - Write-through, not write-back: every mutation is persisted
 *     synchronously (SQLite sync calls are <1ms for single rows).
 *   - Hydration is async (bulk reads), called once from _layout.tsx.
 *   - Media payloads (dataUrl) are saved to expo-file-system and the
 *     URI is stored in the DB — not the blob itself.
 *   - The store remains the source of truth for the UI. SQLite is the
 *     durable backing store that survives app kills / restarts.
 *
 *  SYNC MODEL (Neon is NOT a content store):
 *   - Neon holds sessions, registered identity, relationship snapshots,
 *     and temporary guest tombstones only.
 *   - Chat messages, media, notes, and call history never leave the
 *     device via Neon — there is no "download history from server".
 *   - Socket events are the incremental sync bus into SQLite (DMs,
 *     roster, connection status, community board). Accepting a
 *     connection creates a local conversation and caches peer profile
 *     fields from the roster / get_my_connections — not from Neon chat
 *     tables (those do not exist).
 */

import * as FileSystem from "expo-file-system/legacy";
import {
  initLocalStorage,
  upsertContact,
  upsertContacts,
  upsertConversation,
  insertMessage,
  updateMessageText,
  softDeleteMessage,
  updateMessageReactions,
  updateMessageReadAt,
  updateMessageStatus,
  updateMessageMediaUri,
  updateMessagePrivacy,
  updateMessagePrivacyState,
  messageExists,
  upsertConnection,
  upsertCommunity,
  deleteCommunity as dbDeleteCommunity,
  upsertBoardItem,
  upsertAnnotation,
  insertBoardComment,
  registerMedia,
  logActivity,
  getAllContacts,
  getConversations,
  getAllMessages as dbGetAllMessages,
  getConnections,
  getAllCommunities,
  getNotes,
  getBoardItems,
  getAnnotations,
  getBoardComments,
  getMediaByMessageId,
  getMessagesMissingMedia,
  getMessage,
  resetAll,
  type StoredMessage,
  enforceDataOwner,
} from "./local-storage";
import { useChatStore } from "@/stores/chat";
import { useAuth } from "@/stores/auth";
import type {
  Contact,
  Conversation,
  Message,
  Community,
  ConnectionStatus,
} from "@tabcom/shared";

// ── Media file storage ──────────────────────────────────────────────

const MEDIA_DIR = `${FileSystem.documentDirectory}tabcom-media/`;

async function ensureMediaDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(MEDIA_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(MEDIA_DIR, { intermediates: true });
  }
}

/**
 * Saves a data URL (base64) to durable document storage and returns the
 * file URI. Also writes messages.media_uri so reloads can find the blob.
 */
export async function saveMediaFile(
  messageId: string,
  dataUrl: string,
  kind: string,
  conversationId?: string,
  opts?: { suffix?: string; mimeType?: string }
): Promise<string> {
  await ensureMediaDir();
  const suffix = opts?.suffix ? `-${opts.suffix}` : "";
  const ext =
    kind === "voice" ? "opus"
    : kind === "video" ? "mp4"
    : kind === "file" ? "bin"
    : opts?.mimeType?.includes("png") ? "png"
    : "jpg";
  const fileName = `${messageId}${suffix}.${ext}`;
  const fileUri = `${MEDIA_DIR}${fileName}`;

  const base64 = dataUrl.includes(",")
    ? dataUrl.split(",")[1]
    : dataUrl;

  await FileSystem.writeAsStringAsync(fileUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const fileInfo = await FileSystem.getInfoAsync(fileUri);
  registerMedia({
    id: `m-${messageId}${suffix}`,
    messageId,
    conversationId,
    kind: opts?.suffix === "thumb" ? "image" : kind,
    fileUri,
    fileName,
    fileSize: fileInfo.exists ? (fileInfo as { size?: number }).size : undefined,
    mimeType: opts?.mimeType
      ?? (kind === "voice" ? "audio/opus"
        : kind === "video" ? "video/mp4"
        : "image/jpeg"),
  });

  return fileUri;
}

/**
 * Persist media for a message: write blob(s) to disk, stamp SQLite URIs,
 * and swap the in-memory dataUrl to the file URI so we don't keep huge
 * base64 strings around.
 */
async function persistMessageMedia(
  conversationId: string,
  m: Message
): Promise<void> {
  if (!m.dataUrl?.startsWith("data:") && !m.thumbnailUrl?.startsWith("data:")) {
    return;
  }

  let mediaUri = m.dataUrl?.startsWith("data:")
    ? await saveMediaFile(m.id, m.dataUrl, m.kind, conversationId, {
        mimeType: m.mimeType,
      })
    : m.dataUrl;

  let thumbUri = m.thumbnailUrl?.startsWith("data:")
    ? await saveMediaFile(m.id, m.thumbnailUrl, "image", conversationId, {
        suffix: "thumb",
        mimeType: "image/jpeg",
      })
    : m.thumbnailUrl;

  if (mediaUri) {
    updateMessageMediaUri(m.id, mediaUri, thumbUri ?? null);
  }

  // Point the live store at the durable URI (file:// works in <Image>).
  useChatStore.setState((state) => {
    const list = state.messages[conversationId];
    if (!list) return state;
    let changed = false;
    const next = list.map((msg) => {
      if (msg.id !== m.id) return msg;
      if (msg.dataUrl === mediaUri && msg.thumbnailUrl === thumbUri) return msg;
      changed = true;
      return {
        ...msg,
        dataUrl: mediaUri ?? msg.dataUrl,
        thumbnailUrl: thumbUri ?? msg.thumbnailUrl,
      };
    });
    if (!changed) return state;
    return { messages: { ...state.messages, [conversationId]: next } };
  });
}

/** Loads a media file back as a data URL for display (voice/players). */
export async function loadMediaFile(fileUri: string): Promise<string | null> {
  try {
    const info = await FileSystem.getInfoAsync(fileUri);
    if (!info.exists) return null;
    const base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const ext = fileUri.split(".").pop()?.toLowerCase();
    const mime = ext === "opus" ? "audio/opus"
      : ext === "mp4" ? "video/mp4"
      : ext === "png" ? "image/png"
      : "image/jpeg";
    return `data:${mime};base64,${base64}`;
  } catch {
    return null;
  }
}

const MEDIA_EXTS = ["jpg", "jpeg", "png", "mp4", "opus", "bin", "m4a", "webp"];

/**
 * Repair messages whose media_uri was never stamped (bug in older builds
 * that wrote the file but left the DB column null). Also re-link files
 * found in the media directory by message id.
 */
export async function repairMediaLinks(): Promise<number> {
  await ensureMediaDir();
  let repaired = 0;

  // Index files on disk: "msgId" or "msgId-thumb"
  const names = await FileSystem.readDirectoryAsync(MEDIA_DIR).catch(() => [] as string[]);
  const byStem = new Map<string, string>();
  for (const name of names) {
    const stem = name.replace(/\.[^.]+$/, "");
    byStem.set(stem, `${MEDIA_DIR}${name}`);
  }

  const missing = getMessagesMissingMedia();
  for (const row of missing) {
    const fromRegistry = getMediaByMessageId(row.id);
    let uri = fromRegistry?.file_uri;
    if (!uri) {
      for (const ext of MEDIA_EXTS) {
        const candidate = `${MEDIA_DIR}${row.id}.${ext}`;
        if (byStem.has(row.id) || names.includes(`${row.id}.${ext}`)) {
          uri = byStem.get(row.id) ?? candidate;
          break;
        }
      }
      if (!uri && byStem.has(row.id)) uri = byStem.get(row.id);
    }
    const thumb = byStem.get(`${row.id}-thumb`) ?? null;
    if (uri) {
      updateMessageMediaUri(row.id, uri, thumb);
      repaired += 1;
    }
  }

  if (repaired > 0 && __DEV__) {
    console.log(`[tabcom-persist] repaired ${repaired} media link(s)`);
  }
  return repaired;
}

// ── Hydration (SQLite → Zustand) ────────────────────────────────────

/**
 * Called once from _layout.tsx on app start. Reads SQLite and populates
 * the Zustand store so the UI has data before the socket connects.
 */
export function hydrateFromLocalStorage(): void {
  initLocalStorage();

  // Scope local rows to the authenticated identity. If another account
  // previously owned this database, wipe before reading anything.
  const auth = useAuth.getState();
  const owner =
    auth.user?.username ??
    (auth.guest ? `guest:${auth.guest.username}` : null);
  if (enforceDataOwner(owner)) {
    useChatStore.getState().resetChat();
    return;
  }

  const store = useChatStore.getState();

  // ── Contacts ──
  const dbContacts = getAllContacts();
  if (dbContacts.length > 0) {
    const contacts: Contact[] = dbContacts.map((c) => ({
      id: c.id,
      username: c.username,
      name: c.name,
      color: c.color,
      alias: c.alias ?? undefined,
      photo: c.photo_uri ?? undefined,
      presence: "offline" as const,
      seeded: c.seeded === 1,
    }));
    useChatStore.setState({ contacts });
  }

  // ── Conversations ──
  const dbConvs = getConversations();
  if (dbConvs.length > 0) {
    const conversations: Conversation[] = dbConvs.map((c) => ({
      id: c.id,
      kind: c.kind as "dm" | "community",
      contactId: c.contact_id ?? undefined,
      communityId: c.community_id ?? undefined,
      unread: c.unread,
      lastMessageAt: c.last_message_at,
    }));
    useChatStore.setState({ conversations });
  }

  // ── Messages (entire local history — server stores nothing) ──
  const messages: Record<string, Message[]> = {};
  for (const conv of dbConvs) {
    const dbMsgs = dbGetAllMessages(conv.id);
    if (dbMsgs.length > 0) {
      messages[conv.id] = dbMsgs.reverse().map(storedToMessage);
    }
  }
  if (Object.keys(messages).length > 0) {
    useChatStore.setState({ messages });
  }

  // Re-link any media files that were written but never stamped onto
  // the message row (older builds). Async — UI already has text/meta.
  void repairMediaLinks().then((n) => {
    if (n <= 0) return;
    // Re-hydrate media URIs into the live store after repair.
    const state = useChatStore.getState();
    const next: Record<string, Message[]> = { ...state.messages };
    let changed = false;
    for (const conv of getConversations()) {
      const rows = dbGetAllMessages(conv.id);
      const mapped = rows.reverse().map(storedToMessage);
      const prev = next[conv.id];
      if (
        !prev ||
        prev.length !== mapped.length ||
        mapped.some((m, i) => m.dataUrl !== prev[i]?.dataUrl)
      ) {
        next[conv.id] = mapped;
        changed = true;
      }
    }
    if (changed) useChatStore.setState({ messages: next });
  });

  // ── Connections ──
  const dbConns = getConnections();
  if (dbConns.length > 0) {
    const connections: Record<string, ConnectionStatus> = {};
    for (const c of dbConns) connections[c.username] = c.status as ConnectionStatus;
    useChatStore.setState({ connections });
  }

  // ── Notes (the wall) ──
  // Read state and dismissals live only here, so the wall must be
  // restored from disk or every relaunch would re-blur old notes.
  const dbNotes = getNotes();
  if (dbNotes.length > 0) {
    // The wall is the RECIPIENT's view of a status, so outgoing notes
    // must never appear on it. Older builds mirrored the sender's own
    // note here (addOutgoing) before that was removed; those stale rows
    // are exactly the "You" cards — and their repeats — that show up on
    // the wall today. Drop them from hydration AND purge them from disk
    // so they can't come back on the next launch.
    const outgoing = dbNotes.filter((n) => n.outgoing === 1);
    const incoming = dbNotes.filter((n) => n.outgoing !== 1);

    if (outgoing.length > 0) {
      import("@/lib/local-storage")
        .then(({ deleteNote }) => outgoing.forEach((n) => deleteNote(n.id)))
        .catch(() => { /* best-effort cleanup */ });
    }

    if (incoming.length > 0) {
      import("@/stores/notes")
        .then(({ useNotesStore }) =>
          useNotesStore.getState().hydrate(
            incoming.map((n) => ({
              id: n.id,
              conversationId: n.conversation_id,
              contactId: n.contact_id,
              fromUsername: n.from_username,
              fromName: n.from_name,
              fromColor: n.from_color,
              bgColor: n.bg_color || "",
              text: n.text,
              imageUri: n.image_uri ?? undefined,
              sentAt: n.sent_at,
              readAt: n.read_at ?? undefined,
              outgoing: n.outgoing === 1,
            }))
          )
        )
        .catch((err) => {
          if (__DEV__) console.warn("[tabcom] note hydration failed:", err);
        });
    }
  }

  // ── Communities ──
  const dbComms = getAllCommunities();
  if (dbComms.length > 0) {
    const communities: Record<string, Community> = {};
    for (const c of dbComms) {
      communities[c.id] = {
        id: c.id,
        name: c.name,
        admin: c.admin,
        members: JSON.parse(c.members),
        pendingForMe: c.pending_for_me === 1,
        pendingInvites: JSON.parse(c.pending_invites),
        board: [], // Board items loaded separately if needed
        boardDecidedId: c.board_decided_id ?? undefined,
        imageVersion: c.image_version ?? undefined,
      };
    }
    useChatStore.setState({ communities });
  }
}

function storedToMessage(s: StoredMessage): Message {
  // Prefer the durable file URI; fall back to the media registry when
  // an older build left media_uri null after writing the file.
  let mediaUri = s.media_uri ?? undefined;
  let thumbUri = s.thumbnail_uri ?? undefined;
  if (!mediaUri) {
    const reg = getMediaByMessageId(s.id);
    if (reg?.file_uri) mediaUri = reg.file_uri;
  }

  return {
    id: s.id,
    authorId: s.author_id,
    kind: s.kind as any,
    text: s.text,
    url: s.url ?? undefined,
    dataUrl: mediaUri,
    thumbnailUrl: thumbUri,
    durationMs: s.duration_ms ?? undefined,
    fileName: s.file_name ?? undefined,
    fileSize: s.file_size ?? undefined,
    mimeType: s.mime_type ?? undefined,
    latitude: s.latitude ?? undefined,
    longitude: s.longitude ?? undefined,
    contactUsername: s.contact_username ?? undefined,
    contactName: s.contact_name ?? undefined,
    contactColor: s.contact_color ?? undefined,
    sentAt: s.sent_at,
    status: s.status as any,
    editedAt: s.edited_at ?? undefined,
    deletedAt: s.deleted_at ?? undefined,
    replyToId: s.reply_to_id ?? undefined,
    authorName: s.author_name ?? undefined,
    authorColor: s.author_color ?? undefined,
    readAt: s.read_at ?? undefined,
    reactions: s.reactions ? JSON.parse(s.reactions) : undefined,
    albumId: s.album_id ?? undefined,
    albumIndex: s.album_index ?? undefined,
    albumCount: s.album_count ?? undefined,
    privacy: s.privacy_json ? JSON.parse(s.privacy_json) : undefined,
    privacyLocal: s.privacy_state_json ? JSON.parse(s.privacy_state_json) : undefined,
  };
}

// ── Write-through subscriber (Zustand → SQLite) ────────────────────

let _subscribed = false;

/**
 * Subscribes to the Zustand chat store. Every state change is compared
 * against the previous snapshot, and diffs are written to SQLite.
 *
 * Call once from _layout.tsx after hydration.
 */
export function startPersistence(): () => void {
  if (_subscribed) return () => {};
  _subscribed = true;

  initLocalStorage();

  let prev = useChatStore.getState();

  const unsub = useChatStore.subscribe((next) => {
    try {
      // ── Contacts changed ──
      if (next.contacts !== prev.contacts) {
        for (const c of next.contacts) {
          const prevC = prev.contacts.find((x) => x.id === c.id);
          // Persist immediately with whatever URI we have; async-cache
          // data URLs below so relaunch doesn't keep huge blobs in SQLite.
          upsertContact({
            id: c.id,
            username: c.username,
            name: c.name,
            color: c.color,
            alias: c.alias,
            photoUri: c.photo,
            seeded: c.seeded,
          });

          if (
            c.photo &&
            c.photo.startsWith("data:image/") &&
            c.photo !== prevC?.photo
          ) {
            void import("@/lib/avatar-cache")
              .then(({ cacheContactPhoto }) => cacheContactPhoto(c.username, c.photo))
              .then((uri) => {
                if (!uri || uri === c.photo) return;
                upsertContact({
                  id: c.id,
                  username: c.username,
                  name: c.name,
                  color: c.color,
                  alias: c.alias,
                  photoUri: uri,
                  seeded: c.seeded,
                });
                // Point the live store at the durable file URI.
                useChatStore.setState((s) => ({
                  contacts: s.contacts.map((x) =>
                    x.id === c.id ? { ...x, photo: uri } : x
                  ),
                }));
              })
              .catch(() => { /* best effort */ });
          }
        }
      }

      // ── Conversations changed ──
      if (next.conversations !== prev.conversations) {
        for (const c of next.conversations) {
          upsertConversation({
            id: c.id,
            kind: c.kind,
            contactId: c.contactId,
            communityId: c.communityId,
            unread: c.unread,
            lastMessageAt: c.lastMessageAt,
          });
        }
      }

      // ── Messages changed ──
      if (next.messages !== prev.messages) {
        for (const [convId, msgs] of Object.entries(next.messages)) {
          const prevMsgs = prev.messages[convId];
          if (msgs === prevMsgs) continue;

          for (const m of msgs) {
            // Skip messages that already exist (dedup)
            if (prevMsgs?.some((pm) => pm.id === m.id && pm === m)) continue;

            if (messageExists(m.id)) {
              // Existing message — check for updates
              if (m.editedAt) updateMessageText(m.id, m.text, m.editedAt);
              if (m.deletedAt) softDeleteMessage(m.id);
              if (m.readAt) updateMessageReadAt(m.id, m.readAt);
              if (m.status) updateMessageStatus(m.id, m.status);
              if (m.reactions) updateMessageReactions(m.id, JSON.stringify(m.reactions));
              if (m.privacy) {
                updateMessagePrivacy(m.id, JSON.stringify(m.privacy));
              }
              if (m.privacyLocal) {
                updateMessagePrivacyState(m.id, JSON.stringify(m.privacyLocal));
              }
              // Backfill: older builds inserted the row before the blob
              // finished writing and never stamped media_uri.
              if (
                (m.dataUrl?.startsWith("data:") || m.thumbnailUrl?.startsWith("data:")) &&
                !getMessage(m.id)?.media_uri
              ) {
                void persistMessageMedia(convId, m).catch((err) => {
                  if (__DEV__) console.warn("[tabcom-persist] media backfill failed:", err);
                });
              }
            } else {
              // New message — insert and durably save media blobs.
              // data: URLs are written to documentDirectory; the file
              // URI is stamped onto the row so reloads never lose media.
              const mediaUri =
                m.dataUrl && !m.dataUrl.startsWith("data:")
                  ? m.dataUrl
                  : undefined;
              const thumbnailUri =
                m.thumbnailUrl && !m.thumbnailUrl.startsWith("data:")
                  ? m.thumbnailUrl
                  : undefined;

              insertMessage({
                id: m.id,
                conversationId: convId,
                authorId: m.authorId,
                kind: m.kind,
                text: m.text,
                url: m.url,
                mediaUri,
                thumbnailUri,
                durationMs: m.durationMs,
                fileName: m.fileName,
                fileSize: m.fileSize,
                mimeType: m.mimeType,
                latitude: m.latitude,
                longitude: m.longitude,
                contactUsername: m.contactUsername,
                contactName: m.contactName,
                contactColor: m.contactColor,
                sentAt: m.sentAt,
                status: m.status,
                replyToId: m.replyToId,
                authorName: m.authorName,
                authorColor: m.authorColor,
                reactions: m.reactions ? JSON.stringify(m.reactions) : undefined,
                albumId: m.albumId,
                albumIndex: m.albumIndex,
                albumCount: m.albumCount,
                privacyJson: m.privacy ? JSON.stringify(m.privacy) : undefined,
                privacyStateJson: m.privacyLocal
                  ? JSON.stringify(m.privacyLocal)
                  : undefined,
              });

              void persistMessageMedia(convId, m).catch((err) => {
                if (__DEV__) console.warn("[tabcom-persist] media save failed:", err);
              });

              // Log activity (no content — just that it happened)
              logActivity("message", m.authorId === "me" ? "sent" : "received", "message", m.id, {
                kind: m.kind,
                conversationId: convId,
              });
            }
          }
        }
      }

      // ── Connections changed ──
      if (next.connections !== prev.connections) {
        for (const [username, status] of Object.entries(next.connections)) {
          if (prev.connections[username] !== status) {
            upsertConnection(username, status);
            logActivity("connection", status, "user", username);
          }
        }
      }

      // ── Communities changed ──
      if (next.communities !== prev.communities) {
        for (const [id, c] of Object.entries(next.communities)) {
          if (prev.communities[id] !== c) {
            upsertCommunity({
              id: c.id,
              name: c.name,
              admin: c.admin,
              members: c.members,
              pendingForMe: c.pendingForMe,
              pendingInvites: c.pendingInvites,
              boardDecidedId: c.boardDecidedId,
              imageVersion: c.imageVersion,
            });

            // Persist board items
            if (c.board) {
              for (const item of c.board) {
                upsertBoardItem({
                  id: item.id,
                  communityId: c.id,
                  url: item.url,
                  canonicalKey: item.canonicalKey,
                  title: item.title,
                  image: item.image,
                  siteName: item.siteName,
                  addedBy: item.addedBy,
                  addedAt: item.addedAt,
                  decided: item.decided,
                  votes: item.votes,
                });

                // Persist pins, areas, highlights
                for (const pin of item.pins ?? []) {
                  upsertAnnotation({
                    id: pin.id,
                    boardItemId: item.id,
                    type: "pin",
                    author: pin.author,
                    text: pin.text,
                    sentAt: pin.sentAt,
                    data: {
                      xPercent: pin.xPercent,
                      yPercent: pin.yPercent,
                      pageX: pin.pageX,
                      pageY: pin.pageY,
                    },
                  });
                  for (const c of pin.comments ?? []) {
                    insertBoardComment({
                      id: c.id, parentType: "annotation", parentId: pin.id,
                      author: c.author, text: c.text, sentAt: c.sentAt,
                    });
                  }
                }

                for (const area of item.areas ?? []) {
                  upsertAnnotation({
                    id: area.id,
                    boardItemId: item.id,
                    type: "area",
                    author: area.author,
                    text: area.text,
                    sentAt: area.sentAt,
                    data: {
                      xPercent: area.xPercent, yPercent: area.yPercent,
                      widthPercent: area.widthPercent, heightPercent: area.heightPercent,
                    },
                  });
                  for (const c of area.comments ?? []) {
                    insertBoardComment({
                      id: c.id, parentType: "annotation", parentId: area.id,
                      author: c.author, text: c.text, sentAt: c.sentAt,
                    });
                  }
                }

                for (const hl of item.highlights ?? []) {
                  upsertAnnotation({
                    id: hl.id,
                    boardItemId: item.id,
                    type: "highlight",
                    author: hl.author,
                    text: hl.quote,
                    sentAt: hl.sentAt,
                    data: { prefix: hl.prefix, suffix: hl.suffix },
                  });
                  for (const c of hl.comments ?? []) {
                    insertBoardComment({
                      id: c.id, parentType: "annotation", parentId: hl.id,
                      author: c.author, text: c.text, sentAt: c.sentAt,
                    });
                  }
                }

                // Board item comments
                for (const c of item.comments ?? []) {
                  insertBoardComment({
                    id: c.id, parentType: "board_item", parentId: item.id,
                    author: c.author, text: c.text, sentAt: c.sentAt,
                  });
                }
              }
            }
          }
        }

        // Handle deleted communities
        for (const id of Object.keys(prev.communities)) {
          if (!(id in next.communities)) {
            dbDeleteCommunity(id);
            logActivity("community", "left", "community", id);
          }
        }
      }
    } catch (err) {
      if (__DEV__) console.warn("[tabcom-persist] write error:", err);
    }

    prev = next;
  });

  return () => {
    _subscribed = false;
    unsub();
  };
}

/** Wipe all local data — called on sign-out. */
export async function clearAllLocalData(): Promise<void> {
  resetAll();
  try {
    const { clearDataOwner } = require("./local-storage") as typeof import("./local-storage");
    clearDataOwner();
  } catch { /* ignore */ }
  // Also wipe saved media + avatar files
  try {
    const info = await FileSystem.getInfoAsync(MEDIA_DIR);
    if (info.exists) {
      await FileSystem.deleteAsync(MEDIA_DIR, { idempotent: true });
    }
  } catch {
    /* best effort */
  }
  try {
    const { clearAvatarCache } = require("./avatar-cache") as typeof import("./avatar-cache");
    await clearAvatarCache();
  } catch {
    /* best effort */
  }
}
