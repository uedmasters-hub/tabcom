export const REALTIME_URL =
  process.env.EXPO_PUBLIC_REALTIME_URL ?? "https://tabcom.onrender.com";

if (!process.env.EXPO_PUBLIC_REALTIME_URL && __DEV__) {
  console.warn(
    "[tabcom-mobile] EXPO_PUBLIC_REALTIME_URL not set — using production backend",
    REALTIME_URL
  );
}
