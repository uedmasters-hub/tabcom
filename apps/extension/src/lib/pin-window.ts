import { browser } from "wxt/browser";

/**
 * Pin-to-top for extension windows.
 *
 * A popup-type extension window IS a tab context, so it can call
 * documentPictureInPicture.requestWindow() — the same OS-level
 * always-on-top surface Chrome uses for video calls. The caller
 * portals its React tree into the returned window; this module owns
 * the plumbing: feature detection, style cloning, opener minimize /
 * restore, and close handling.
 */

interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

export function pinSupported(): boolean {
  return typeof window !== "undefined" && !!window.documentPictureInPicture;
}

/** Copy this document's styles into the always-on-top window. */
function cloneStylesInto(target: Window): void {
  for (const sheet of [...document.styleSheets]) {
    try {
      const css = [...sheet.cssRules].map((rule) => rule.cssText).join("");
      const style = target.document.createElement("style");
      style.textContent = css;
      target.document.head.append(style);
    } catch {
      if (sheet.href) {
        const link = target.document.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        target.document.head.append(link);
      }
    }
  }
}

let openerWindowId: number | null = null;

export async function openPinWindow(options: {
  width: number;
  height: number;
  title: string;
  onClosed: () => void;
}): Promise<Window | null> {
  if (!window.documentPictureInPicture) return null;

  const win = await window.documentPictureInPicture.requestWindow({
    width: options.width,
    height: options.height,
  });

  cloneStylesInto(win);
  win.document.title = options.title;
  win.document.body.style.margin = "0";
  win.document.body.style.height = "100vh";
  win.document.body.style.overflow = "hidden";

  win.addEventListener("pagehide", () => {
    options.onClosed();
    void restoreOpener();
  });

  // The PiP window dies with its opener, so keep this window alive but
  // tuck it away.
  try {
    const current = await browser.windows.getCurrent();
    openerWindowId = current.id ?? null;
    if (current.id != null) {
      void browser.windows.update(current.id, { state: "minimized" });
    }
  } catch {
    // not fatal — the opener just stays visible
  }

  return win;
}

export async function restoreOpener(): Promise<void> {
  const id = openerWindowId;
  openerWindowId = null;
  if (id == null) return;
  try {
    await browser.windows.update(id, { state: "normal", focused: true });
  } catch {
    // opener already gone
  }
}
