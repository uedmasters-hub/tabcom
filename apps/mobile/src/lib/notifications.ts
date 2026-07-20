/**
 * Notifications — Expo push registration + in-app foreground banners.
 *
 * Guarded with require() so Expo Go (which dropped Android remote-push
 * support in SDK 53+) degrades gracefully: in Expo Go you get in-app
 * behavior only; a development build gets full background push.
 *
 * Flow:
 *   1. On sign-in/socket-connect: request permission, get Expo push
 *      token, emit register_push_token to the backend.
 *   2. Backend pushes ONLY when the user has no live socket — so there
 *      is never a double notification (socket delivery wins when the
 *      app is running; push covers everything else). Zero relay delay:
 *      push fires inline at the same moment the relay would have.
 *   3. Notification taps deep-link into the right conversation.
 */
import { Platform } from "react-native";

let Notifications: any = null;
let Device: any = null;
try {
  Notifications = require("expo-notifications");
  Device = require("expo-device");
} catch {
  // Expo Go without the module — degrade to no-op.
}

export async function registerForPush(): Promise<string | null> {
  if (!Notifications || !Device?.isDevice) return null;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Messages",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== "granted") return null;

    const projectId =
      require("expo-constants").default?.expoConfig?.extra?.eas?.projectId;
    const token = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    return token?.data ?? null;
  } catch {
    return null;
  }
}

/** Wire notification taps to deep links. Returns unsubscribe. */
export function onNotificationTap(
  handler: (data: Record<string, unknown>) => void
): () => void {
  if (!Notifications) return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener(
    (response: any) => {
      const data = response?.notification?.request?.content?.data ?? {};
      handler(data);
    }
  );
  return () => sub.remove();
}
