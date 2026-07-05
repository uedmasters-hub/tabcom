import { browser } from "wxt/browser";

/**
 * Live cursors on/off — a board collaboration feature (see the on-page
 * annotation overlay), not part of the floating pill. Kept as its own
 * tiny module so removing the pill entirely doesn't take this with it.
 */

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

export function onCursorsEnabledChange(callback: (enabled: boolean) => void): void {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !(CURSORS_KEY in changes)) return;
    callback(changes[CURSORS_KEY].newValue !== false);
  });
}
