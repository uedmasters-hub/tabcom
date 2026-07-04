import { browser } from "wxt/browser";

/**
 * Pill visibility setting — deliberately its own tiny storage key,
 * fully decoupled from the zustand stores, so the content script, the
 * Settings screen, and the pill itself all read/write one flag with
 * zero migration or hydration concerns.
 */

const KEY = "tabcom:pill-enabled";

/** Enabled unless explicitly turned off. */
export async function getPillEnabled(): Promise<boolean> {
  try {
    const result = await browser.storage.local.get(KEY);
    return result[KEY] !== false;
  } catch {
    return true;
  }
}

export async function setPillEnabled(enabled: boolean): Promise<void> {
  try {
    await browser.storage.local.set({ [KEY]: enabled });
  } catch {
    // extension context gone — nothing to persist to
  }
}

/** Live changes (e.g. toggled from Settings while a page is open). */
export function onPillEnabledChange(
  callback: (enabled: boolean) => void
): void {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !(KEY in changes)) return;
    callback(changes[KEY].newValue !== false);
  });
}

// ---- Live cursors visibility (managed from the pill's menu) -------------

const CURSORS_KEY = "tabcom:cursors-enabled";

export async function getCursorsEnabled(): Promise<boolean> {
  try {
    const result = await browser.storage.local.get(CURSORS_KEY);
    return result[CURSORS_KEY] !== false;
  } catch {
    return true;
  }
}

export async function setCursorsEnabled(enabled: boolean): Promise<void> {
  try {
    await browser.storage.local.set({ [CURSORS_KEY]: enabled });
  } catch {
    // extension context gone — nothing to persist to
  }
}

export function onCursorsEnabledChange(
  callback: (enabled: boolean) => void
): void {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !(CURSORS_KEY in changes)) return;
    callback(changes[CURSORS_KEY].newValue !== false);
  });
}

// ---- Profile toggles surfaced in the pill's Settings panel ---------------
//
// These read/write the SAME "tabcom:profile" blob the main extension's
// zustand store persists to — kept in the zustand {state, version}
// wrapper shape so either side can write without corrupting the other's
// fields on next load.

const PROFILE_KEY = "tabcom:profile";

interface ProfileToggles {
  animations: boolean;
  visibility: "public" | "private";
}

export async function getProfileToggles(): Promise<ProfileToggles | null> {
  try {
    const result = await browser.storage.local.get(PROFILE_KEY);
    const raw = result[PROFILE_KEY] as string | undefined;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const state = parsed.state ?? parsed;
    return {
      animations: state.animations !== false,
      visibility: state.visibility === "private" ? "private" : "public",
    };
  } catch {
    return null;
  }
}

export async function setProfileToggle(
  key: "animations" | "visibility",
  value: boolean | "public" | "private"
): Promise<void> {
  try {
    const result = await browser.storage.local.get(PROFILE_KEY);
    const raw = result[PROFILE_KEY] as string | undefined;
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const state = parsed.state ?? parsed;
    state[key] = value;
    if (parsed.state) parsed.state = state;
    await browser.storage.local.set({
      [PROFILE_KEY]: JSON.stringify(parsed.state ? parsed : state),
    });
    // The live panel (if open) re-announces visibility changes over the
    // socket itself on its own storage-driven effect; writing here just
    // updates the shared source of truth both surfaces read from.
  } catch {
    // extension context gone — nothing to persist to
  }
}
