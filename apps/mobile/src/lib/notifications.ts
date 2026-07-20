/**
 * Push notifications.
 *
 * Channels are created up-front so Android's per-channel settings are
 * meaningful: a user can silence "typing" or "shared tabs" from system
 * settings while keeping calls loud. Channel ids MUST match the ones
 * the server sends (apps/backend/src/push.ts).
 *
 * Native module — only functional in a development or release build,
 * never in Expo Go (SDK 53+ dropped remote push there). Every call is
 * guarded so the app still runs in Expo Go with notifications inert.
 */
import { Platform } from "react-native";

type Nullable<T> = T | null;

// Guarded require: importing at module scope crashes Expo Go.
function mod(): any | null {
  try {
    return require("expo-notifications");
  } catch {
    return null;
  }
}

export interface ChannelSpec {
  id: string;
  name: string;
  description: string;
  importance: "max" | "high" | "default" | "low";
  sound: boolean;
  vibrate: boolean;
}

/** Mirrors the server's PushCategory list. */
export const CHANNELS: ChannelSpec[] = [
  {
    id: "calls",
    name: "Calls",
    description: "Incoming voice and video calls",
    importance: "max",
    sound: true,
    vibrate: true,
  },
  {
    id: "messages",
    name: "Messages",
    description: "Direct messages",
    importance: "high",
    sound: true,
    vibrate: true,
  },
  {
    id: "requests",
    name: "Requests & invites",
    description: "Connection requests and community invitations",
    importance: "high",
    sound: true,
    vibrate: true,
  },
  {
    id: "communities",
    name: "Communities",
    description: "Community messages and comments",
    importance: "high",
    sound: true,
    vibrate: true,
  },
  {
    id: "tabs",
    name: "Shared tabs",
    description: "When someone shares a tab to a community board",
    importance: "default",
    sound: true,
    vibrate: false,
  },
  {
    id: "typing",
    name: "Typing",
    description: "When someone starts typing to you",
    importance: "low",
    sound: false,
    vibrate: false,
  },
];

export async function configureNotifications(): Promise<void> {
  const N = mod();
  if (!N) return;

  // Foreground presentation: show banners for everything except typing,
  // which would be noise while the user is already in the app.
  N.setNotificationHandler({
    handleNotification: async (notification: any) => {
      const category = notification?.request?.content?.data?.category;
      const quiet = category === "typing";
      return {
        shouldShowBanner: !quiet,
        shouldShowList: !quiet,
        shouldPlaySound: !quiet,
        shouldSetBadge: true,
      };
    },
  });

  if (Platform.OS === "android") {
    const I = N.AndroidImportance;
    const map: Record<string, number> = {
      max: I.MAX,
      high: I.HIGH,
      default: I.DEFAULT,
      low: I.LOW,
    };
    for (const c of CHANNELS) {
      await N.setNotificationChannelAsync(c.id, {
        name: c.name,
        description: c.description,
        importance: map[c.importance] ?? I.DEFAULT,
        sound: c.sound ? "default" : null,
        vibrationPattern: c.vibrate ? [0, 250, 250, 250] : undefined,
        enableVibrate: c.vibrate,
        lockscreenVisibility: N.AndroidNotificationVisibility.PUBLIC,
        showBadge: c.id !== "typing",
      });
    }
  }
}

/** Requests permission and returns the Expo push token, or null. */
export async function registerForPush(): Promise<Nullable<string>> {
  const N = mod();
  if (!N) return null;

  try {
    const existing = await N.getPermissionsAsync();
    let status = existing.status;
    if (status !== "granted") {
      const asked = await N.requestPermissionsAsync();
      status = asked.status;
    }
    if (status !== "granted") return null;

    const token = await N.getExpoPushTokenAsync();
    return token?.data ?? null;
  } catch {
    return null;
  }
}

export async function setBadgeCount(count: number): Promise<void> {
  const N = mod();
  if (!N) return;
  try {
    await N.setBadgeCountAsync(Math.max(0, count));
  } catch {
    /* unsupported launcher */
  }
}

export async function clearThreadNotifications(threadId: string): Promise<void> {
  const N = mod();
  if (!N) return;
  try {
    const shown = await N.getPresentedNotificationsAsync();
    for (const n of shown) {
      if (n?.request?.content?.data?.threadId === threadId) {
        await N.dismissNotificationAsync(n.request.identifier);
      }
    }
  } catch {
    /* best effort */
  }
}

/**
 * Wires tap-to-open deep linking. Returns an unsubscribe function.
 * `navigate` receives the route the server put in the payload.
 */
export function attachNotificationRouting(
  navigate: (route: string, data: Record<string, unknown>) => void
): () => void {
  const N = mod();
  if (!N) return () => {};

  // Cold start: app was launched by tapping a notification.
  N.getLastNotificationResponseAsync?.()
    .then((response: any) => {
      const data = response?.notification?.request?.content?.data;
      if (data?.route) navigate(String(data.route), data);
    })
    .catch(() => {});

  const sub = N.addNotificationResponseReceivedListener((response: any) => {
    const data = response?.notification?.request?.content?.data;
    if (data?.route) navigate(String(data.route), data);
  });

  return () => {
    try { sub?.remove?.(); } catch { /* already removed */ }
  };
}
