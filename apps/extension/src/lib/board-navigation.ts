import { browser } from "wxt/browser";

/**
 * Click-to-anchor navigation from the panel to a spot on a page.
 *
 * Two delivery paths, because the target tab may or may not exist yet:
 *  1. The target is stored as a pending navigation BEFORE the tab is
 *     focused/created — a freshly loading page consumes it on load.
 *  2. If a matching tab already exists, it's focused and messaged
 *     directly so the jump is instant (no reload).
 */

export interface AnnotationTarget {
  kind: "pin" | "highlight" | "area";
  id: string;
}

function urlsMatch(tabUrl: string, itemUrl: string): boolean {
  try {
    const a = new URL(tabUrl);
    const b = new URL(itemUrl);
    return a.origin === b.origin && a.pathname === b.pathname;
  } catch {
    return false;
  }
}

export async function navigateToAnnotation(
  item: { url: string; canonicalKey: string },
  target: AnnotationTarget
): Promise<void> {
  // Stored first so a newly loading page can pick it up on render.
  await browser.storage.local.set({
    "tabcom:pending-nav": JSON.stringify({
      canonicalKey: item.canonicalKey,
      kind: target.kind,
      id: target.id,
      ts: Date.now(),
    }),
  });

  const tabs = await browser.tabs.query({});
  const existing = tabs.find((tab) => tab.url && urlsMatch(tab.url, item.url));

  if (existing?.id != null) {
    await browser.tabs.update(existing.id, { active: true });
    if (existing.windowId != null) {
      await browser.windows.update(existing.windowId, { focused: true });
    }
    // Already-loaded page: jump immediately (it also clears pending-nav
    // on its next render, so no stale state either way).
    try {
      await browser.tabs.sendMessage(existing.id, {
        type: "tabcom:navigate-to",
        kind: target.kind,
        id: target.id,
      });
    } catch {
      // content script not ready — pending-nav covers it
    }
    return;
  }

  await browser.tabs.create({ url: item.url });
}
