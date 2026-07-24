/**
 * Cross-platform settings sync — ported from the extension.
 * Registered users' preferences persist server-side and restore
 * on login from any device. Guests are excluded (no sessionToken).
 */
import { REALTIME_URL } from "./config";

interface SyncedSettings {
  cursorsEnabled?: boolean;
  animations?: boolean;
  pipEnabled?: boolean;
  photo?: string;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Push current settings to the server (debounced 500ms). */
export function syncSettingsToServer(
  sessionToken: string | null | undefined,
  settings: SyncedSettings,
): void {
  if (!sessionToken) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    void fetch(`${REALTIME_URL}/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken, settings }),
    }).catch((err) => console.warn("[tabcom] settings sync failed:", err));
  }, 500);
}

/** Restore settings from the server on login / app startup. */
export async function loadSettingsFromServer(
  sessionToken: string | null | undefined,
): Promise<SyncedSettings | null> {
  if (!sessionToken) return null;
  try {
    const res = await fetch(
      `${REALTIME_URL}/settings?sessionToken=${encodeURIComponent(sessionToken)}`,
    );
    const result = (await res.json()) as { ok: boolean; settings?: SyncedSettings | null };
    return result.ok && result.settings ? result.settings : null;
  } catch {
    return null;
  }
}
