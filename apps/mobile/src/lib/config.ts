/**
 * Backend endpoint.
 *
 * Baked in at BUILD time by Metro — changing it requires restarting
 * Metro (dev) or rebuilding the APK (release). It cannot be changed at
 * runtime.
 *
 * Production/default: the hosted Tabcom backend.
 * Override only when pointing at a local backend:
 *   EXPO_PUBLIC_REALTIME_URL=http://10.0.2.2:3001 npx expo start --clear --dev-client
 */
export const PRODUCTION_URL = "https://api.tabcom.space";

export const REALTIME_URL = process.env.EXPO_PUBLIC_REALTIME_URL ?? PRODUCTION_URL;

if (__DEV__) {
  const overridden = REALTIME_URL !== PRODUCTION_URL;
  console.log(
    `[tabcom] backend: ${REALTIME_URL}${overridden ? " (local override)" : " (hosted)"}`
  );
}
