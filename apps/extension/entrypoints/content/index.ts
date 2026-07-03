import { readPageAnchor } from "../../src/lib/anchor";

/**
 * Reads the current page's stable anchor (canonical key, title, image)
 * on request from the extension panel — used when adding a page to a
 * Board. No UI is injected into the page; this is read-only and passive.
 */
export default defineContentScript({
  matches: ["<all_urls>"],
  main() {
    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "tabcom:read-anchor") {
        try {
          sendResponse({ ok: true, anchor: readPageAnchor() });
        } catch (error) {
          sendResponse({ ok: false, error: String(error) });
        }
        return true;
      }
      return undefined;
    });
  },
});
