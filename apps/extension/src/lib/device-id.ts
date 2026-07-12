import { browser } from "wxt/browser";

/**
 * A random id generated once per browser profile and kept forever —
 * this is what "device recognition" means in this project (see the
 * schema comment on sessions.deviceId): recognizing the same browser
 * profile across restarts, NOT a hardware/MAC fingerprint. Browsers
 * deliberately expose no such thing to extension code, for the same
 * privacy reasons Tabcom itself cares about.
 *
 * Stored under its OWN key, separate from the profile store, so it
 * survives sign-out, guest-session-expiry resets, and account
 * deletion — all of which intentionally clear profile.store's state,
 * but none of which should make a returning device look "new". It's
 * cleared only if the person removes the extension or clears all
 * extension storage themselves.
 *
 * Treat this value like a bearer token, not a public identifier: its
 * SECRECY (not any complexity in how it's looked up) is what the
 * server-side recognition endpoint relies on. Never log it, never
 * send it anywhere but Tabcom's own backend.
 */

const DEVICE_ID_KEY = "tabcom:device-id";

let cached: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;

  const stored = await browser.storage.local.get(DEVICE_ID_KEY);
  const existing = stored[DEVICE_ID_KEY] as string | undefined;
  if (existing) {
    cached = existing;
    return existing;
  }

  const fresh = crypto.randomUUID();
  await browser.storage.local.set({ [DEVICE_ID_KEY]: fresh });
  cached = fresh;
  return fresh;
}

/** Coarse, non-identifying browser/platform info — purely informational
 *  (shown in a future "your sessions" list, say), never used for any
 *  access decision. */
export function getBrowserInfo(): string {
  const ua = navigator.userAgent;
  const platform = navigator.platform || "unknown platform";
  return `${platform} · ${ua}`.slice(0, 200);
}
