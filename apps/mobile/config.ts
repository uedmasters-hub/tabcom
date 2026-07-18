/**
 * Runtime configuration.
 *
 * EXPO_PUBLIC_REALTIME_URL is inlined at build time (same model as the
 * extension's WXT_REALTIME_URL — and the same failure mode: if it's not
 * set, the socket silently points at localhost, which on a physical
 * Android device is the PHONE itself, not your Mac). For LAN testing,
 * set it to http://<your-mac-lan-ip>:3001 in apps/mobile/.env.
 *
 * Production builds must bake in https://tabcom.onrender.com.
 */
export const REALTIME_URL =
  process.env.EXPO_PUBLIC_REALTIME_URL ?? "https://tabcom.onrender.com";

if (!process.env.EXPO_PUBLIC_REALTIME_URL && __DEV__) {
  console.warn(
    "[tabcom-mobile] EXPO_PUBLIC_REALTIME_URL not set — using production backend",
    REALTIME_URL
  );
}
