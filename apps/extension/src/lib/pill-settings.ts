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
  await browser.storage.local.set({ [KEY]: enabled });
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
