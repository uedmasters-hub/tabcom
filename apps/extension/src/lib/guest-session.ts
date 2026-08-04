/**
 * Guest session isolation for the extension — mirrors the mobile
 * guarantee: nothing from one guest (persisted chat, profile flags,
 * socket identity, pending inbox) may leak into the next.
 */
import { browser } from "wxt/browser";

import { endGuestSessionOnServer } from "./auth-client";
import { disconnectAllContexts } from "./realtime";
import { useChatStore } from "../stores/chat.store";
import { useProfileStore } from "../stores/profile.store";

export const GUEST_SESSION_MS = 30 * 60 * 1000;
export const GUEST_WARN_MS = 5 * 60 * 1000;

const PENDING_INBOX_KEY = "tabcom:pending-inbox";

/** Wipe every guest-associated local surface. Safe to call repeatedly. */
export async function wipeGuestLocalState(): Promise<void> {
  useChatStore.getState().resetChat();

  try {
    await browser.storage.local.remove(PENDING_INBOX_KEY);
  } catch {
    /* best effort */
  }

  try {
    // Clear action badge leftover from a previous guest's unread pushes.
    await browser.action.setBadgeText({ text: "" });
  } catch {
    /* side panel / MV3 hosts that don't expose action */
  }
}

/**
 * Full guest teardown used on logout, timeout, and before starting a
 * fresh guest. Wipe local state first, then confirm to Neon with
 * localCleared so relationship purge can proceed.
 */
export async function endGuestSessionCompletely(): Promise<void> {
  disconnectAllContexts();
  await wipeGuestLocalState();
  useProfileStore.getState().endGuestSession();

  try {
    await endGuestSessionOnServer({ localCleared: true });
  } catch {
    /* best effort — local wipe already completed */
  }
}
