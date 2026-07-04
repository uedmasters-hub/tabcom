import ReactDOM from "react-dom/client";
import { createElement } from "react";

import tailwindStyles from "../styles/tailwind.css?inline";
import PillApp, { PILL_VERSION, type PillActions } from "./PillApp";

export { PILL_VERSION };
export type { PillActions };
export { extensionAlive, showRefreshChip } from "./extension-alive";

/**
 * Mounts the pill as a real React tree inside a Shadow DOM host — this
 * is the ENTIRE bridge between the content script and the pill; all
 * actual UI lives in PillApp.tsx and the shared components it imports
 * from src/components/shared, the same ones the popup window renders.
 *
 * Tailwind is injected as inline CSS text into the shadow root (not a
 * <link>, to avoid any web-accessible-resource/timing complexity) so
 * classNames resolve exactly as they do in the popup.
 */

let mounted = false;

export function initPagePill(actions: PillActions): void {
  if (mounted) return;
  mounted = true;

  const host = document.createElement("div");
  host.id = "tabcom-pill-root";
  host.style.cssText = "all: initial;";
  document.documentElement.append(host);

  const shadowRoot = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = tailwindStyles;
  shadowRoot.append(style);

  const mountPoint = document.createElement("div");
  shadowRoot.append(mountPoint);

  console.log(`[tabcom] page pill ${PILL_VERSION} initializing (React)`);
  ReactDOM.createRoot(mountPoint).render(createElement(PillApp, { actions }));
}

/** React already re-renders from live storage.onChanged subscriptions
 *  inside PillApp's hooks — nothing to force here. Kept so existing
 *  call sites in entrypoints/content/index.ts don't need to change. */
export function refreshPagePill(): void {
  // no-op by design
}
