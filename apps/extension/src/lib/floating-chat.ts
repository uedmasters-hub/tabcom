import { browser } from "wxt/browser";

/**
 * Floating chat window.
 *
 * Document Picture-in-Picture is unavailable in extension side panels
 * (it's scoped to tabs), so the float is a dedicated popup-type browser
 * window running its own compact chat page (pip.html). It stays visible
 * when the main browser window is minimized and runs its own socket, so
 * it keeps working independently of the panel.
 */

let floatWindowId: number | null = null;
let listenerBound = false;

function bindRemovalListener() {
  if (listenerBound) return;
  listenerBound = true;

  browser.windows.onRemoved.addListener((windowId) => {
    if (windowId === floatWindowId) floatWindowId = null;
  });
}

export function isFloatOpen(): boolean {
  return floatWindowId !== null;
}

export async function openFloatingChat(conversationId: string): Promise<void> {
  bindRemovalListener();

  if (floatWindowId !== null) {
    await browser.windows.update(floatWindowId, { focused: true });
    return;
  }

  const win = await browser.windows.create({
    url: browser.runtime.getURL(
      `/pip.html?conversation=${encodeURIComponent(conversationId)}` as "/pip.html"
    ),
    type: "popup",
    width: 360,
    height: 540,
    focused: true,
  });

  floatWindowId = win?.id ?? null;
}

export async function closeFloatingChat(): Promise<void> {
  if (floatWindowId === null) return;
  const id = floatWindowId;
  floatWindowId = null;
  try {
    await browser.windows.remove(id);
  } catch {
    // window already gone
  }
}

export async function toggleFloatingChat(conversationId: string): Promise<void> {
  if (floatWindowId !== null) await closeFloatingChat();
  else await openFloatingChat(conversationId);
}
