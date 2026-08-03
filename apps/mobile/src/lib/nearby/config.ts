import Constants from "expo-constants";

/** Tabcom Nearby protocol service — opaque advertise names only. */
export const NEARBY_SERVICE_ID = "dev.tabcom.nearby";

/** Wire protocol version. Bump when breaking message shapes. */
export const PROTOCOL_VERSION = 1;

/** Rotate advertisement nonce while discovery is enabled. */
export const ADVERTISEMENT_ROTATION_MS = 3 * 60 * 1000;

/** Give up on an outgoing connect if the peer never accepts. */
export const CONNECT_TIMEOUT_MS = 45_000;

/** Drop stale discovered peers that haven't been seen. */
export const PEER_STALE_MS = 30_000;

/**
 * Capability flags (bitmask) advertised in the opaque blob.
 * Reserved bits leave room for offline messaging / file share later.
 */
export const CAP = {
  CHAT: 1 << 0,
  CALLS: 1 << 1,
  INVITES: 1 << 2,
  // reserved: OFFLINE_MSG = 1 << 3, FILE_SHARE = 1 << 4, …
} as const;

export const DEFAULT_CAPABILITIES = CAP.CHAT | CAP.CALLS | CAP.INVITES;

const FALLBACK_INSTALL_URL =
  "https://drive.google.com/drive/folders/tabcom-test-build";

/** Configurable install / distribution link — no UI hardcoding. */
export function getInstallUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_TABCOM_INSTALL_URL?.trim();
  if (fromEnv) return fromEnv;
  const extra = Constants.expoConfig?.extra as
    | { tabcomInstallUrl?: string }
    | undefined;
  const fromExtra = extra?.tabcomInstallUrl?.trim();
  if (fromExtra) return fromExtra;
  return FALLBACK_INSTALL_URL;
}
