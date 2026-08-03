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
 *
 * Split of responsibility:
 *  - App FOREGROUND → OS banners suppressed; socket + this bridge feed
 *    the in-app bell / chat list / contacts. Open chats get no unread.
 *  - App BACKGROUND / KILLED → OS shows the push; tapping deep-links
 *    via attachNotificationRouting. Opening the app without tapping
 *    still syncs via syncPresentedNotificationsIntoStore.
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
  // FOREGROUND POLICY — this handler runs ONLY while the app is open.
  // Anything suppressed here still appears normally when the app is
  // backgrounded or killed, because the OS renders those itself without
  // consulting this callback.
  //
  // While the app is open we show NO OS notification at all:
  //   • Messages  -> delivered live by the socket into the conversation.
  //     A banner here was actively harmful: tapping it deep-linked to a
  //     different thread and yanked the user out of the chat they were
  //     already reading.
  //   • Requests / activity / communities / tabs -> the socket feeds
  //     these into the store, so they surface on the in-app bell.
  //   • Typing -> socket-only, never a notification.
  //   • Calls  -> take over the whole screen (fullScreenModal) instead
  //     of appearing as a banner; see the call fallback in the bridge.
  N.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
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

/** Dismiss every presented notification and clear the app badge. */
export async function clearAllNotifications(): Promise<void> {
  const N = mod();
  if (!N) return;
  try {
    await N.dismissAllNotificationsAsync?.();
  } catch { /* best effort */ }
  try {
    await N.setBadgeCountAsync(0);
  } catch { /* best effort */ }
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

/** Local OS notice for missed calls after reconnect (best-effort). */
export async function presentLocalCallNotice(opts: {
  title: string;
  body: string;
  from: string;
  video?: boolean;
  name?: string;
  color?: string;
}): Promise<void> {
  const N = mod();
  if (!N) return;
  try {
    await N.scheduleNotificationAsync({
      content: {
        title: opts.title,
        body: opts.body,
        data: {
          category: "calls",
          type: "missed_call",
          from: opts.from,
          video: !!opts.video,
          name: opts.name ?? opts.title,
          color: opts.color ?? "#2563eb",
          route: `/call/${opts.from}`,
          threadId: `call:${opts.from}`,
        },
        sound: true,
        ...(Platform.OS === "android" ? { channelId: "calls" } : {}),
      },
      trigger: null,
    });
  } catch (err) {
    if (__DEV__) console.warn("[tabcom-push] local call notice failed:", err);
  }
}

  /** Feed a single push payload into the chat store (deduped). */
function ingestPushData(data: Record<string, unknown>): void {
  if (!data) return;
  if (data.category === "typing") return;

  // Missed-call push (callee was offline during ring / timeout)
  if (data.type === "missed_call" && data.from) {
    try {
      const { useCallHistory } =
        require("@/stores/call-history") as typeof import("@/stores/call-history");
      useCallHistory.getState().record({
        peerUsername: String(data.from),
        peerName: String(data.name ?? data.fromName ?? data.from),
        peerColor: String(data.color ?? data.fromColor ?? "#2563eb"),
        direction: "incoming",
        video: !!data.video,
        outcome: "missed",
        startedAt: Date.now(),
        endedAt: Date.now(),
        seen: false,
      });
    } catch { /* best-effort */ }
    return;
  }

  if (data.category === "calls" && data.from) {
    try {
      const { getCallState } = require("@/lib/call-manager");
      if (getCallState().phase !== "idle") return;
      const { router } = require("expo-router");
      const name = encodeURIComponent(String(data.name ?? data.fromName ?? data.from));
      const col = encodeURIComponent(String(data.color ?? data.fromColor ?? "#2563eb"));
      const video = data.video ? "true" : "false";
      router.push(
        `/call/${data.from}?peerName=${name}&peerColor=${col}&role=callee&video=${video}` as never
      );
    } catch (err) {
      if (__DEV__) console.warn("[tabcom-push] call fallback failed:", err);
    }
    return;
  }

  if (
    (data.category === "messages" || data.type === "dm") &&
    data.from &&
    data.messageId
  ) {
    const { useChatStore } = require("@/stores/chat");
    const store = useChatStore.getState();
    const contactId = `u-${data.from}`;
    const conv = store.conversations.find((c: { contactId?: string }) => c.contactId === contactId);
    if (conv) {
      const existing = (store.messages[conv.id] ?? []).find(
        (m: { id: string }) => m.id === data.messageId
      );
      if (existing) return;
      // Open chat: merge silently, no unread (receiveDm checks activeConversationId).
      // Still pulse a subtle incoming shimmer so the user sees the arrival.
      store.receivePushDm({
        from: String(data.from),
        fromName: String(data.fromName ?? data.from),
        fromColor: String(data.fromColor ?? "#2563eb"),
        messageId: String(data.messageId),
        messageKind: String(data.messageKind ?? "text"),
        messageText: String(data.messageText ?? "New message"),
      });
      if (store.activeConversationId === conv.id) {
        store.pulseIncomingRefresh(conv.id);
        void clearThreadNotifications(String(data.threadId ?? `dm:${data.from}`));
      }
      return;
    }

    store.receivePushDm({
      from: String(data.from),
      fromName: String(data.fromName ?? data.from),
      fromColor: String(data.fromColor ?? "#2563eb"),
      messageId: String(data.messageId),
      messageKind: String(data.messageKind ?? "text"),
      messageText: String(data.messageText ?? "New message"),
    });
  }
}

/**
 * Pull shade notifications into the in-app store when the user returns
 * to the app without tapping a push. Without this, a backgrounded DM
 * only lived in the OS tray until they tapped it.
 */
export async function syncPresentedNotificationsIntoStore(): Promise<void> {
  const N = mod();
  if (!N) return;
  try {
    const shown = await N.getPresentedNotificationsAsync();
    for (const n of shown) {
      const data = n?.request?.content?.data;
      if (data) ingestPushData(data);
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
    if (data) ingestPushData(data);
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
      else if (data) navigate("", data);
    })
    .catch(() => {});

  const sub = N.addNotificationResponseReceivedListener((response: any) => {
    const data = response?.notification?.request?.content?.data;
    if (data?.route) navigate(String(data.route), data);
    else if (data) navigate("", data);
  });

  return () => {
    try { sub?.remove?.(); } catch { /* already removed */ }
  };
}
