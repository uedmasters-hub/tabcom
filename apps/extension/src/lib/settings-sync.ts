import { REALTIME_URL } from "./realtime";
import { getCursorsEnabled, setCursorsEnabled } from "./cursor-settings";
import { useProfileStore, type ProfileVisibility } from "../stores/profile.store";

/**
 * Phase 2 of session management: registered-user settings/preferences
 * persist server-side and restore on login from any device. Guests
 * are deliberately excluded — every function here is a no-op without
 * a sessionToken, and guest settings stay local-only/ephemeral,
 * consistent with a guest identity having nothing durable to restore
 * settings INTO once its session ends.
 *
 * One JSON blob synced as a whole, not per-field endpoints — matches
 * the pragmatic pattern already used for board_state: add a new
 * setting to the blob shape below and it syncs, no new endpoint or
 * migration needed.
 */

interface SyncedSettings {
  visibility?: ProfileVisibility;
  cursorsEnabled?: boolean;
  animations?: boolean;
  pipEnabled?: boolean;
  /** Base64 data URL — same scale as a community logo, no separate
   *  size cap needed here since setPhoto already bounds it client-side
   *  before it ever reaches this blob. */
  photo?: string;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

async function currentSettingsBlob(): Promise<SyncedSettings> {
  const state = useProfileStore.getState();
  return {
    visibility: state.visibility,
    cursorsEnabled: await getCursorsEnabled(),
    animations: state.animations,
    pipEnabled: state.pipEnabled,
    photo: state.photo,
  };
}

/** Call after any settings change (visibility, cursors, future
 *  toggles) for a registered user. Debounced — rapid toggling
 *  (flipping a switch a few times) shouldn't fire a request per click. */
export function syncSettingsToServer(sessionToken: string | undefined): void {
  if (!sessionToken) return; // guest — nothing to sync against

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    void currentSettingsBlob().then((settings) => {
      void fetch(`${REALTIME_URL}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken, settings }),
      }).catch((error) => {
        // Best-effort — a settings-sync failure should never surface
        // as a broken toggle in the UI. Local state (already applied
        // before this is called) is the source of truth for THIS
        // session regardless; only cross-device restore is at stake.
        console.error("[tabcom] settings sync failed:", error);
      });
    });
  }, 500);
}

/** Call once on login/registration success, and once at app startup
 *  for an already-signed-in registered user — restores settings from
 *  the server, overlaying onto whatever local defaults are already in
 *  place. A no-op if the server has nothing saved yet (brand new
 *  account) or the request fails (offline) — local state stands. */
export async function loadSettingsFromServer(sessionToken: string | undefined): Promise<void> {
  if (!sessionToken) return;

  try {
    const res = await fetch(
      `${REALTIME_URL}/settings?sessionToken=${encodeURIComponent(sessionToken)}`
    );
    const result = (await res.json()) as { ok: boolean; settings?: SyncedSettings | null };
    if (!result.ok || !result.settings) return;

    const { visibility, cursorsEnabled, animations, pipEnabled, photo } = result.settings;
    if (visibility) useProfileStore.getState().setVisibility(visibility);
    if (typeof cursorsEnabled === "boolean") await setCursorsEnabled(cursorsEnabled);
    if (typeof animations === "boolean") useProfileStore.getState().setAnimations(animations);
    if (typeof pipEnabled === "boolean") useProfileStore.getState().setPipEnabled(pipEnabled);
    if (typeof photo === "string") useProfileStore.getState().setPhoto(photo);
  } catch (error) {
    console.error("[tabcom] settings restore failed:", error);
  }
}
