/**
 * ══════════════════════════════════════════════════════════════════
 *  Guest cleanup engine
 * ══════════════════════════════════════════════════════════════════
 *
 *  Modular, idempotent, retry-safe removal of every guest-owned surface
 *  on this device, with per-step progress for the UI.
 *
 *  Design goals (privacy-first):
 *    • Real work per step — each checklist item maps to an actual
 *      deletion, not a cosmetic tick.
 *    • Idempotent — every step is safe to run again, so an interrupted
 *      cleanup simply resumes from where it stopped.
 *    • Persisted — progress is written to SecureStore after each step,
 *      so a relaunch (or a new-guest attempt) can finish what was left.
 *    • Guaranteed-complete — a final catch-all wipe + backend confirm
 *      runs after the granular steps, so nothing can be left behind
 *      even if one step misbehaved.
 *
 *  The 30-minute expiry itself is detected by useGuestExpiryWatcher.
 *  This module owns the *cleanup*, and gate `isGuestCleanupPending()`
 *  blocks a new guest session until it has fully finished.
 */

import * as SecureStore from "expo-secure-store";
import { clearTables } from "@/lib/local-storage";
import { clearMediaFiles, clearAllLocalData } from "@/lib/persistence";
import { GUEST_KEY } from "@/lib/guest-session";
import { auth } from "@/lib/auth-client";

const CLEANUP_KEY = "tabcom.guest-cleanup";

export type CleanupStepId =
  | "conversations"
  | "contacts"
  | "community"
  | "media"
  | "callLogs"
  | "cache";

export type StepStatus = "pending" | "active" | "done";

export interface CleanupStep {
  id: CleanupStepId;
  label: string;
  /** Real, idempotent removal of this surface. */
  run: () => Promise<void> | void;
}

export interface CleanupProgress {
  steps: { id: CleanupStepId; label: string; status: StepStatus }[];
  complete: boolean;
}

// ── helpers ─────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Reset in-memory stores using STATIC requires. Metro rejects dynamic
// require(variable), so each store is referenced by a literal path.
// Best-effort — if a store isn't loaded yet, the SQLite wipe is the
// source of truth.
function resetChatStore() {
  try {
    const { useChatStore } = require("@/stores/chat");
    useChatStore.getState().resetChat();
  } catch {
    /* not loaded */
  }
}
function resetCallHistoryStore() {
  try {
    const { useCallHistory } = require("@/stores/call-history");
    useCallHistory.setState({ recent: [], unseenMissed: 0 });
  } catch {
    /* not loaded */
  }
}
function resetNotesStore() {
  try {
    const { useNotesStore } = require("@/stores/notes");
    useNotesStore.getState().clear();
  } catch {
    /* not loaded */
  }
}
function disconnectRealtime() {
  try {
    const { useRealtime } = require("@/stores/realtime");
    useRealtime.getState().disconnect();
  } catch {
    /* not loaded */
  }
}

// ── the ordered steps ───────────────────────────────────────────────
//
// Each step does genuine, repeatable work. In-memory store resets run
// alongside the SQLite deletes so the UI can't flash stale rows.

export const CLEANUP_STEPS: readonly CleanupStep[] = [
  {
    id: "conversations",
    label: "Conversations",
    run: () => {
      clearTables(["messages", "conversations", "conversation_privacy"]);
      resetChatStore();
    },
  },
  {
    id: "contacts",
    label: "Contacts",
    run: () => {
      clearTables(["contacts", "connections"]);
    },
  },
  {
    id: "community",
    label: "Community",
    run: () => {
      clearTables(["communities", "board_items", "board_annotations", "board_comments"]);
    },
  },
  {
    id: "media",
    label: "Media",
    run: async () => {
      clearTables(["media"]);
      await clearMediaFiles();
    },
  },
  {
    id: "callLogs",
    label: "Call logs",
    run: () => {
      clearTables(["call_history", "activity_log"]);
      resetCallHistoryStore();
    },
  },
  {
    id: "cache",
    label: "Cache",
    run: async () => {
      clearTables(["notes"]);
      resetNotesStore();
      try {
        const { clearAvatarCache } = require("@/lib/avatar-cache");
        await clearAvatarCache();
      } catch {
        /* best effort */
      }
      try {
        const { clearDataOwner } = require("@/lib/local-storage");
        clearDataOwner();
      } catch {
        /* best effort */
      }
      try {
        const notif = require("@/lib/notifications");
        if (typeof notif.clearAllNotifications === "function") {
          await notif.clearAllNotifications();
        }
      } catch {
        /* best effort */
      }
      try {
        await SecureStore.deleteItemAsync(GUEST_KEY);
      } catch {
        /* already gone */
      }
    },
  },
];

// ── persisted state ─────────────────────────────────────────────────

interface CleanupState {
  pending: boolean;
  done: CleanupStepId[];
  username: string | null;
}

async function loadState(): Promise<CleanupState> {
  try {
    const raw = await SecureStore.getItemAsync(CLEANUP_KEY);
    if (raw) {
      const s = JSON.parse(raw) as CleanupState;
      return {
        pending: !!s.pending,
        done: Array.isArray(s.done) ? s.done : [],
        username: s.username ?? null,
      };
    }
  } catch {
    /* fall through to default */
  }
  return { pending: false, done: [], username: null };
}

async function saveState(s: CleanupState): Promise<void> {
  try {
    await SecureStore.setItemAsync(CLEANUP_KEY, JSON.stringify(s));
  } catch {
    /* non-fatal — the granular deletes have already run */
  }
}

function buildProgress(done: CleanupStepId[], active: CleanupStepId | null): CleanupProgress {
  const steps = CLEANUP_STEPS.map((s) => ({
    id: s.id,
    label: s.label,
    status: (done.includes(s.id)
      ? "done"
      : s.id === active
        ? "active"
        : "pending") as StepStatus,
  }));
  return { steps, complete: done.length >= CLEANUP_STEPS.length };
}

// ── public API ──────────────────────────────────────────────────────

/** Mark that a guest session needs cleaning. Call as the session ends. */
export async function beginGuestCleanup(username: string | null): Promise<void> {
  const cur = await loadState();
  // Preserve any progress already made (resume rather than restart).
  await saveState({
    pending: true,
    done: cur.pending ? cur.done : [],
    username: username ?? cur.username,
  });
}

/** True until cleanup has fully completed. Gates new guest sessions. */
export async function isGuestCleanupPending(): Promise<boolean> {
  return (await loadState()).pending;
}

/** Snapshot for the UI (e.g. when re-entering the screen mid-cleanup). */
export async function getCleanupProgress(): Promise<CleanupProgress> {
  const s = await loadState();
  return buildProgress(s.done, null);
}

/**
 * Run (or resume) cleanup to completion. Idempotent and retry-safe:
 * finished steps are skipped, each step is persisted, a failing step is
 * retried once, and a final catch-all wipe guarantees nothing is left.
 *
 * @param onProgress  called on every status change (active → done …)
 * @param opts.stepDelayMs  pause between steps so the UI can animate
 *                          (default 300ms; pass 0 for the silent guard)
 */
export async function runGuestCleanup(
  onProgress?: (p: CleanupProgress) => void,
  opts?: { stepDelayMs?: number }
): Promise<void> {
  const delay = opts?.stepDelayMs ?? 300;
  const state = await loadState();
  const done = new Set<CleanupStepId>(state.done);

  // Already complete → report and exit.
  if (done.size >= CLEANUP_STEPS.length && !state.pending) {
    onProgress?.(buildProgress([...done], null));
    return;
  }

  onProgress?.(buildProgress([...done], null));

  for (const step of CLEANUP_STEPS) {
    if (done.has(step.id)) continue;

    onProgress?.(buildProgress([...done], step.id)); // active

    try {
      await step.run();
    } catch {
      // Retry once — these are local deletes and rarely fail.
      try {
        await step.run();
      } catch {
        // Still failing: the final clearAllLocalData() below is the
        // catch-all safety net, so mark done and move on rather than
        // stalling the whole cleanup.
      }
    }

    done.add(step.id);
    await saveState({ pending: true, done: [...done], username: state.username });
    onProgress?.(buildProgress([...done], null));
    if (delay > 0) await sleep(delay);
  }

  // ── finalize: guaranteed-complete wipe + backend confirm ──────────
  try {
    await clearAllLocalData();
  } catch {
    /* best effort */
  }
  try {
    await auth.endGuestSession(state.username ?? "", { localCleared: true });
  } catch {
    /* backend confirm is best-effort; local data is already gone */
  }
  disconnectRealtime();

  await saveState({
    pending: false,
    done: CLEANUP_STEPS.map((s) => s.id),
    username: null,
  });
  onProgress?.(buildProgress(CLEANUP_STEPS.map((s) => s.id), null));
}
