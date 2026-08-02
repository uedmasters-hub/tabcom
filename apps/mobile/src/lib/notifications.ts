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
      const data = notification?.request?.content?.data;
      const category = data?.category;
      const isTyping = category === "typing";

      // Typing is a live, socket-only signal — it must NEVER surface as a
      // notification. The server no longer pushes it, but older/stale
      // servers might; suppress it entirely here so a pushed "is typing…"
      // can never land in the tray, play a sound, or bump the badge.
      if (isTyping) {
        return {
          shouldShowBanner: false,
          shouldShowList: false,
          shouldPlaySound: false,
          shouldSetBadge: false,
        };
      }

      // Everything else (messages, calls, requests, communities, tabs)
      // shows a banner with sound.
      return {
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
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
        // NOTE: a `sound` STRING is interpreted as a bundled custom
        // sound FILE. Passing "default" makes expo-notifications look
        // for default.wav and log an error per channel. Omit the key
        // for the system default; pass null for a silent channel.
        ...(c.sound ? {} : { sound: null }),
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
    if (status !== "granted") {
      if (__DEV__) console.log("[tabcom-push] permission not granted");
      return null;
    }

    // SDK 57+ requires projectId for getExpoPushTokenAsync().
    // Pull it from app config (Constants.expoConfig) or hardcode
    // the EAS project id. Without this, the call silently fails.
    let projectId: string | undefined;
    try {
      const Constants = require("expo-constants").default;
      projectId = Constants.expoConfig?.extra?.eas?.projectId
        ?? Constants.easConfig?.projectId;
    } catch {
      // expo-constants not available — try without projectId
    }

    const tokenOpts: any = {};
    if (projectId) tokenOpts.projectId = projectId;

    if (__DEV__) console.log(`[tabcom-push] requesting token (projectId=${projectId ?? "none"})`);
    const token = await N.getExpoPushTokenAsync(tokenOpts);
    if (__DEV__) console.log(`[tabcom-push] got token: ${token?.data?.slice(0, 30)}...`);
    return token?.data ?? null;
  } catch (err) {
    if (__DEV__) console.warn("[tabcom-push] token error:", err);
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
 * Foreground push bridge — routes incoming push data into the Zustand
 * chat store so typing indicators and messages appear even when the
 * socket is stale or reconnecting. Deduplication is message-id based:
 * if the socket delivered the DM first, the push is a no-op.
 *
 * Must be called once from _layout.tsx after sign-in. Returns unsub.
 */
export function attachForegroundPushBridge(): () => void {
  const N = mod();
  if (!N) return () => {};

  const sub = N.addNotificationReceivedListener((notification: any) => {
    const data = notification?.request?.content?.data;
    if (!data) return;

    // Typing is delivered exclusively over the live socket. A pushed
    // typing signal is always stale by the time it arrives, so we never
    // feed it into the store here — it is intentionally ignored.
    if (data.category === "typing") return;

    // Lazy import to avoid circular deps (notifications ↔ stores)
    const { useChatStore } = require("@/stores/chat");
    const store = useChatStore.getState();

    if (data.category === "messages" && data.from && data.messageId) {
      // Deduplicate: if the socket already delivered this message,
      // the store will have it. Skip to avoid double-render.
      const contactId = `u-${data.from}`;
      const conv = store.conversations.find(
        (c: any) => c.contactId === contactId
      );
      if (conv) {
        const existing = (store.messages[conv.id] ?? []).find(
          (m: any) => m.id === data.messageId
        );
        if (existing) return; // already delivered via socket
      }

      // Socket didn't deliver — create a lightweight placeholder
      // so the user sees the notification AND the conversation list
      // updates. The full message body arrives when they open the
      // app and the socket reconnects.
      store.receivePushDm({
        from: data.from,
        fromName: data.fromName ?? data.from,
        fromColor: data.fromColor ?? "#2563eb",
        messageId: data.messageId,
        messageKind: data.messageKind ?? "text",
        messageText: data.messageText ?? "New message",
      });
    }
  });

  return () => {
    try { sub?.remove?.(); } catch { /* already removed */ }
  };
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
