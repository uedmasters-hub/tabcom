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
  getMessages as dbGetMessages,
  getConnections,
  getAllCommunities,
  getNotes,
  getBoardItems,
  getAnnotations,
  getBoardComments,
  resetAll,
  type StoredMessage,
} from "./local-storage";
import { useChatStore } from "@/stores/chat";
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
 * Saves a data URL (base64) to the local filesystem and returns the
 * file URI. For images/video/voice — keeps media out of SQLite.
 */
export async function saveMediaFile(
  messageId: string,
  dataUrl: string,
  kind: string,
  conversationId?: string
): Promise<string> {
  await ensureMediaDir();
  const ext = kind === "voice" ? "opus" : kind === "video" ? "mp4" : "jpg";
  const fileName = `${messageId}.${ext}`;
  const fileUri = `${MEDIA_DIR}${fileName}`;

  // Strip data URL prefix to get raw base64
  const base64 = dataUrl.includes(",")
    ? dataUrl.split(",")[1]
    : dataUrl;

  await FileSystem.writeAsStringAsync(fileUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  // Register in media index
  const fileInfo = await FileSystem.getInfoAsync(fileUri);
  registerMedia({
    id: `m-${messageId}`,
    messageId,
    conversationId,
    kind,
    fileUri,
    fileName,
    fileSize: fileInfo.exists ? (fileInfo as any).size : undefined,
    mimeType: kind === "voice" ? "audio/opus"
      : kind === "video" ? "video/mp4"
      : "image/jpeg",
  });

  return fileUri;
}

/** Loads a media file back as a data URL for display. */
export async function loadMediaFile(fileUri: string): Promise<string | null> {
  try {
    const info = await FileSystem.getInfoAsync(fileUri);
    if (!info.exists) return null;
    const base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    // Infer mime from extension
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

// ── Hydration (SQLite → Zustand) ────────────────────────────────────

/**
 * Called once from _layout.tsx on app start. Reads SQLite and populates
 * the Zustand store so the UI has data before the socket connects.
 */
export function hydrateFromLocalStorage(): void {
  initLocalStorage();

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

  // ── Messages (latest 50 per conversation) ──
  const messages: Record<string, Message[]> = {};
  for (const conv of dbConvs) {
    const dbMsgs = dbGetMessages(conv.id, 50);
    if (dbMsgs.length > 0) {
      messages[conv.id] = dbMsgs.reverse().map(storedToMessage);
    }
  }
  if (Object.keys(messages).length > 0) {
    useChatStore.setState({ messages });
  }

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
    import("@/stores/notes")
      .then(({ useNotesStore }) =>
        useNotesStore.getState().hydrate(
          dbNotes.map((n) => ({
            id: n.id,
            conversationId: n.conversation_id,
            contactId: n.contact_id,
            fromUsername: n.from_username,
            fromName: n.from_name,
            fromColor: n.from_color,
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
  return {
    id: s.id,
    authorId: s.author_id,
    kind: s.kind as any,
    text: s.text,
    url: s.url ?? undefined,
    dataUrl: s.media_uri ?? undefined, // Will be loaded lazily
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
          upsertContact({
            id: c.id,
            username: c.username,
            name: c.name,
            color: c.color,
            alias: c.alias,
            seeded: c.seeded,
          });
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
            } else {
              // New message — insert and save media
              const mediaUri = m.dataUrl?.startsWith("data:")
                ? undefined // Will be saved async below
                : m.dataUrl;

              insertMessage({
                id: m.id,
                conversationId: convId,
                authorId: m.authorId,
                kind: m.kind,
                text: m.text,
                url: m.url,
                mediaUri,
                thumbnailUri: m.thumbnailUrl,
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
              });

              // Save media file async (don't block the store).
              // MUST have a catch — an unhandled rejection here is
              // fatal in React Native, not just a console warning.
              if (m.dataUrl?.startsWith("data:")) {
                saveMediaFile(m.id, m.dataUrl, m.kind, convId).catch((err) => {
                  if (__DEV__) console.warn("[tabcom-persist] media save failed:", err);
                });
              }

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
  // Also wipe saved media files
  try {
    const info = await FileSystem.getInfoAsync(MEDIA_DIR);
    if (info.exists) {
      await FileSystem.deleteAsync(MEDIA_DIR, { idempotent: true });
    }
  } catch {
    /* best effort */
  }
}
