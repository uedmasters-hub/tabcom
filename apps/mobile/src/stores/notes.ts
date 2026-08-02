/**
 * ══════════════════════════════════════════════════════════════
 *  NOTES — the wall
 * ══════════════════════════════════════════════════════════════
 *
 *  A Note is a message (kind: "note") that ALSO pins itself to a
 *  card wall at the top of the chat list until the recipient reads
 *  or dismisses it. Think "status you can reply to", not "story":
 *  it doesn't expire on a timer, it expires when acted on.
 *
 *  TRANSPORT
 *  Notes ride the existing DM relay — same zero-retention path as
 *  every other message. The server relays and forgets. Nothing
 *  about the wall exists server-side; the lifecycle (read /
 *  dismissed) is purely local and never leaves the device.
 *
 *  PRIVACY
 *  Incoming notes land BLURRED. Content is only revealed on an
 *  explicit tap, so a note can't be read over your shoulder from
 *  the chat list. `readAt` is what un-blurs it, permanently.
 *
 *  STORAGE
 *  Persisted to the SQLite `notes` table. Images are written to
 *  the filesystem by the persistence layer and referenced by URI,
 *  so the DB stays small.
 */

import { create } from "zustand";
import type { Message, WireUser } from "@tabcom/shared";

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
  /** Sign-out / account switch. */
  clear: () => void;
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

// ── Store ───────────────────────────────────────────────────────────

export const useNotesStore = create<NotesState>((set, get) => ({
  notes: [],

  hydrate: (notes) => {
    // Defensive de-dupe: a note id must appear at most once, and
    // outgoing notes never belong on the wall. This guarantees no
    // repeated cards even if a stale or echoed row slips through.
    const seen = new Set<string>();
    const clean = notes
      .filter((n) => !n.outgoing && !seen.has(n.id) && seen.add(n.id))
      .sort((a, b) => b.sentAt - a.sentAt);
    set({ notes: clean });
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
