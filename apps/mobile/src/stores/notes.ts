/**
 * ══════════════════════════════════════════════════════════════
 *  NOTES — the wall
 * ══════════════════════════════════════════════════════════════
 *
 *  A Note is a message (kind: "note") that ALSO pins itself to a
 *  card wall at the top of the chat list for up to 24 hours (or
 *  until the recipient dismisses it). Think "status you can reply
 *  to": the wall is ephemeral, the chat thread keeps the note
 *  forever.
 *
 *  TRANSPORT
 *  Notes ride the existing DM relay — same zero-retention path as
 *  every other message. The server relays and forgets. Nothing
 *  about the wall exists server-side; the lifecycle (read /
 *  dismissed / 24h expiry) is purely local and never leaves the
 *  device.
 *
 *  PRIVACY
 *  Incoming notes land BLURRED. Content is only revealed on an
 *  explicit tap, so a note can't be read over your shoulder from
 *  the chat list. `readAt` is what un-blurs it, permanently.
 *
 *  STORAGE
 *  Persisted to the SQLite `notes` table. Images are written to
 *  the filesystem by the persistence layer and referenced by URI,
 *  so the DB stays small. Chat messages live in `messages` and are
 *  unaffected when a wall card expires or is dismissed.
 */

import { create } from "zustand";
import type { Message, WireUser } from "@tabcom/shared";
import { notePastels } from "@/theme";

/** Wall cards auto-dismiss this long after `sentAt`. Chat keeps them. */
export const NOTE_WALL_TTL_MS = 24 * 60 * 60 * 1000;

// ── Types ───────────────────────────────────────────────────────────

export interface NoteCard {
  /** Same id as the underlying message, so thread and wall stay in sync. */
  id: string;
  conversationId: string;
  contactId: string;
  /** Empty for notes I sent. */
  fromUsername: string;
  fromName: string;
  fromColor: string;
  /** Soft pastel fill for the wall card / sandbox. */
  bgColor: string;
  text: string;
  /** Data URL on arrival; swapped for a file URI once persisted. */
  imageUri?: string;
  sentAt: number;
  /** Set on first reveal — this is what un-blurs the card. */
  readAt?: number;
  /** My own note. Never blurred, shown with a subtler treatment. */
  outgoing: boolean;
}

interface NotesState {
  notes: NoteCard[];

  /** Replaces the whole list — used once by hydration. */
  hydrate: (notes: NoteCard[]) => void;
  /** Incoming note from a peer. Idempotent on id. */
  addIncoming: (from: WireUser, message: Message, conversationId: string) => void;
  /** A note I sent. Appears on my own wall so I can see what's live. */
  addOutgoing: (message: Message, conversationId: string, contactId: string) => void;
  /** Reveal — un-blurs permanently. */
  markRead: (id: string) => void;
  markAllRead: () => void;
  /** Remove from the wall. The message stays in the thread. */
  dismiss: (id: string) => void;
  dismissAllForConversation: (conversationId: string) => void;
  /** Drop wall cards older than 24h. Chat history is untouched. */
  purgeExpired: () => void;
  /** Sign-out / account switch. */
  clear: () => void;
}

// ── Pastel picker ───────────────────────────────────────────────────

/** Stable pastel for notes that predate `bgColor` (hydration / migration). */
export function pastelForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return notePastels[h % notePastels.length];
}

function pickNoteBg(existing: NoteCard[]): string {
  const recent = new Set(existing.slice(0, 3).map((n) => n.bgColor));
  const choices = notePastels.filter((c) => !recent.has(c));
  const pool = choices.length > 0 ? choices : [...notePastels];
  return pool[Math.floor(Math.random() * pool.length)];
}

export function isNoteExpired(note: Pick<NoteCard, "sentAt">, now = Date.now()): boolean {
  return now - note.sentAt >= NOTE_WALL_TTL_MS;
}

// ── Persistence bridge ──────────────────────────────────────────────
// Fire-and-forget: the wall must never block on disk I/O, and a
// storage failure should cost you a note card, not the app.

function persistUpsert(note: NoteCard): void {
  import("@/lib/local-storage")
    .then(({ upsertNote }) => upsertNote(note))
    .catch((err) => {
      if (__DEV__) console.warn("[tabcom-notes] persist failed:", err);
    });
}

function persistDelete(id: string): void {
  import("@/lib/local-storage")
    .then(({ deleteNote }) => deleteNote(id))
    .catch((err) => {
      if (__DEV__) console.warn("[tabcom-notes] delete failed:", err);
    });
}

function withBg(note: Omit<NoteCard, "bgColor"> & { bgColor?: string }): NoteCard {
  const bg = note.bgColor?.trim();
  return {
    ...note,
    bgColor: bg || pastelForId(note.id),
  };
}

// ── Store ───────────────────────────────────────────────────────────

export const useNotesStore = create<NotesState>((set, get) => ({
  notes: [],

  hydrate: (notes) => {
    const now = Date.now();
    // Defensive de-dupe: a note id must appear at most once, and
    // outgoing notes never belong on the wall. Drop anything past
    // the 24h wall TTL — those rows are purged from disk below.
    const seen = new Set<string>();
    const expired: NoteCard[] = [];
    const clean = notes
      .map((n) => withBg(n))
      .filter((n) => {
        if (n.outgoing || seen.has(n.id)) return false;
        seen.add(n.id);
        if (isNoteExpired(n, now)) {
          expired.push(n);
          return false;
        }
        return true;
      })
      .sort((a, b) => b.sentAt - a.sentAt);
    set({ notes: clean });
    expired.forEach((n) => persistDelete(n.id));
    // Stamp pastels onto pre-migration rows so the tint survives relaunch.
    for (const raw of notes) {
      if (raw.outgoing || raw.bgColor?.trim()) continue;
      const stamped = clean.find((n) => n.id === raw.id);
      if (stamped) persistUpsert(stamped);
    }
  },

  addIncoming: (from, message, conversationId) => {
    // Idempotent — a note can arrive twice (socket + push bridge).
    if (get().notes.some((n) => n.id === message.id)) return;

    const note: NoteCard = {
      id: message.id,
      conversationId,
      contactId: `u-${from.username}`,
      fromUsername: from.username,
      fromName: from.name || from.username,
      fromColor: from.color || "#2563eb",
      bgColor: pickNoteBg(get().notes),
      text: message.text ?? "",
      imageUri: message.dataUrl,
      sentAt: message.sentAt ?? Date.now(),
      outgoing: false,
    };

    set((s) => ({ notes: [note, ...s.notes] }));
    persistUpsert(note);
  },

  addOutgoing: (message, conversationId, contactId) => {
    if (get().notes.some((n) => n.id === message.id)) return;

    const note: NoteCard = {
      id: message.id,
      conversationId,
      contactId,
      fromUsername: "",
      fromName: "You",
      fromColor: "#2563eb",
      bgColor: pickNoteBg(get().notes),
      text: message.text ?? "",
      imageUri: message.dataUrl,
      sentAt: message.sentAt ?? Date.now(),
      // My own note is never hidden from me.
      readAt: Date.now(),
      outgoing: true,
    };

    set((s) => ({ notes: [note, ...s.notes] }));
    persistUpsert(note);
  },

  markRead: (id) => {
    const now = Date.now();
    let touched: NoteCard | undefined;
    set((s) => ({
      notes: s.notes.map((n) => {
        if (n.id !== id || n.readAt) return n;
        touched = { ...n, readAt: now };
        return touched;
      }),
    }));
    if (touched) persistUpsert(touched);
  },

  markAllRead: () => {
    const now = Date.now();
    const updated: NoteCard[] = [];
    set((s) => ({
      notes: s.notes.map((n) => {
        if (n.readAt) return n;
        const next = { ...n, readAt: now };
        updated.push(next);
        return next;
      }),
    }));
    updated.forEach(persistUpsert);
  },

  dismiss: (id) => {
    set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));
    persistDelete(id);
  },

  dismissAllForConversation: (conversationId) => {
    const doomed = get().notes.filter((n) => n.conversationId === conversationId);
    set((s) => ({ notes: s.notes.filter((n) => n.conversationId !== conversationId) }));
    doomed.forEach((n) => persistDelete(n.id));
  },

  purgeExpired: () => {
    const now = Date.now();
    const doomed = get().notes.filter((n) => isNoteExpired(n, now));
    if (doomed.length === 0) return;
    set((s) => ({ notes: s.notes.filter((n) => !isNoteExpired(n, now)) }));
    doomed.forEach((n) => persistDelete(n.id));
  },

  clear: () => set({ notes: [] }),
}));

// ── Selectors ───────────────────────────────────────────────────────
// Module-level constants keep selector results referentially stable —
// returning a fresh [] each call would loop useSyncExternalStore.

export const EMPTY_NOTES: NoteCard[] = [];

/** Unread count for badges. */
export function useUnreadNoteCount(): number {
  return useNotesStore((s) => s.notes.filter((n) => !n.readAt && !n.outgoing).length);
}
