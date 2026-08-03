/**
 * Guest session isolation — every guest must start and end with a
 * clean slate. Nothing from one guest (SQLite, SecureStore, Zustand,
 * media files, notifications, socket identity) may leak into the next.
 */
import * as SecureStore from "expo-secure-store";
import { clearAllLocalData } from "@/lib/persistence";
import { auth } from "@/lib/auth-client";

export const GUEST_KEY = "tabcom.guest-session";
export const GUEST_SESSION_MS = 30 * 60 * 1000;
/** Show the expiry banner this long before the session ends. */
export const GUEST_WARN_MS = 5 * 60 * 1000;

export function guestExpiresAt(startedAt: number): number {
  return startedAt + GUEST_SESSION_MS;
}

export function guestMsRemaining(startedAt: number, now = Date.now()): number {
  return Math.max(0, guestExpiresAt(startedAt) - now);
}

export function isGuestExpired(startedAt: number, now = Date.now()): boolean {
  return now >= guestExpiresAt(startedAt);
}

export function shouldShowGuestExpiryBanner(
  startedAt: number,
  now = Date.now()
): boolean {
  const left = guestMsRemaining(startedAt, now);
  return left > 0 && left <= GUEST_WARN_MS;
}

/** "4:32" style countdown for the banner. */
export function formatGuestCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Wipe every guest-associated local surface. Safe to call repeatedly.
 * Does NOT clear the auth zustand fields — callers set those.
 */
export async function wipeGuestLocalState(): Promise<void> {
  // In-memory stores first so the UI can't flash stale rows while disk
  // I/O is still running.
  try {
    const { useChatStore } = require("@/stores/chat") as typeof import("@/stores/chat");
    useChatStore.getState().resetChat();
  } catch { /* store may not be loaded yet */ }

  try {
    const { useNotesStore } = require("@/stores/notes") as typeof import("@/stores/notes");
    useNotesStore.getState().clear();
  } catch { /* optional */ }

  try {
    const { useCallHistory } = require("@/stores/call-history") as typeof import("@/stores/call-history");
    useCallHistory.setState({ recent: [], unseenMissed: 0 });
  } catch { /* optional */ }

  try {
    const { usePresence } = require("@/stores/presence") as typeof import("@/stores/presence");
    usePresence.getState().setPresence("online");
  } catch { /* optional */ }

  // Note: do NOT disconnect realtime here — startGuestSession needs to
  // rebind identity without racing the signedIn gate. Full teardown
  // disconnects explicitly in endGuestSessionCompletely.

  try {
    const { clearAllNotifications } = require("@/lib/notifications") as typeof import("@/lib/notifications");
    if (typeof clearAllNotifications === "function") {
      await clearAllNotifications();
    }
  } catch { /* optional */ }

  await clearAllLocalData();
}

/**
 * Full guest teardown: server session, SecureStore key, local data,
 * and realtime disconnect. Used on logout and timeout.
 */
export async function endGuestSessionCompletely(
  guestUsername?: string | null
): Promise<void> {
  if (guestUsername) {
    void auth.endGuestSession(guestUsername).catch(() => {});
  } else {
    void auth.endGuestSession("").catch(() => {});
  }

  try {
    await SecureStore.deleteItemAsync(GUEST_KEY);
  } catch { /* already gone */ }

  await wipeGuestLocalState();

  try {
    const { useRealtime } = require("@/stores/realtime") as typeof import("@/stores/realtime");
    useRealtime.getState().disconnect();
  } catch { /* optional */ }
}
