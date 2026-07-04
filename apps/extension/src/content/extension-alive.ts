import { browser } from "wxt/browser";

/**
 * Shared orphan-detection: reloading the extension leaves content
 * scripts already injected into open tabs running as zombies — every
 * browser.* call throws "Extension context invalidated". Both the
 * annotation overlay (pin/highlight/cursor logic in index.ts) and the
 * React pill hit this; they share one registry so only one recovery
 * chip ever shows, not two competing ones.
 */

export function extensionAlive(): boolean {
  try {
    return !!browser.runtime?.id;
  } catch {
    return false;
  }
}

const listeners = new Set<() => void>();

export function onInvalidated(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

let firedOnce = false;

/** Call this the moment any browser.* call throws an invalidated-context
 *  error. Idempotent — later calls after the first are no-ops. */
export function notifyInvalidated(): void {
  if (firedOnce) return;
  firedOnce = true;
  for (const listener of listeners) listener();
}

// Backward-compatible alias — index.ts's existing call sites use this name.
export const showRefreshChip = notifyInvalidated;
