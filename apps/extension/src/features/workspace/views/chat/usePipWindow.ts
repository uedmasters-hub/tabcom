import { useCallback, useEffect, useState } from "react";

import { updatePresence } from "../../../../lib/realtime";
import { useProfileStore } from "../../../../stores/profile.store";

/**
 * Document Picture-in-Picture (Chrome/Brave 116+).
 *
 * Opens a small always-on-top window that stays visible even when the
 * browser is minimized (as long as the browser process is running).
 * Styles are cloned from the panel so Tailwind works inside.
 *
 * Presence contract: while PiP is open you're actively chatting, so
 * presence flips to Online; closing PiP restores your chosen status.
 */

interface DocumentPictureInPicture {
  requestWindow(options?: {
    width?: number;
    height?: number;
  }): Promise<Window>;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

export function isPipSupported(): boolean {
  return typeof window !== "undefined" && !!window.documentPictureInPicture;
}

function cloneStyles(target: Window): void {
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

export function usePipWindow() {
  const [pipWindow, setPipWindow] = useState<Window | null>(null);

  const open = useCallback(async () => {
    if (!window.documentPictureInPicture || pipWindow) return;

    const win = await window.documentPictureInPicture.requestWindow({
      width: 340,
      height: 480,
    });

    cloneStyles(win);
    win.document.body.style.margin = "0";
    win.document.body.style.background = "#FFFFFF";

    win.addEventListener("pagehide", () => {
      setPipWindow(null);
      // Restore the user's chosen presence when the float closes.
      updatePresence(useProfileStore.getState().presence);
    });

    setPipWindow(win);

    // Actively chatting -> present as online while the float is up.
    updatePresence("online");
  }, [pipWindow]);

  const close = useCallback(() => {
    pipWindow?.close();
    setPipWindow(null);
    updatePresence(useProfileStore.getState().presence);
  }, [pipWindow]);

  // Close the float if the panel unmounts.
  useEffect(() => () => pipWindow?.close(), [pipWindow]);

  return { pipWindow, open, close, supported: isPipSupported() };
}
