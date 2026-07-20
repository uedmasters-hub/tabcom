/**
 * Push notifications — Expo Push API fan-out.
 *
 * Tokens live in memory and are (re)registered by the mobile app on
 * EVERY socket connect, so a server restart self-heals as soon as each
 * user next opens the app. Known v1 tradeoff on Render free tier: a
 * restart while a user is offline drops their token until they next
 * open the app. Upgrade path: persist tokens in Postgres via Drizzle
 * (users table, expo_push_token column) — do this before wide launch.
 *
 * No message CONTENT is stored server-side (zero-retention contract
 * holds): a push carries only sender name + a short preview passed
 * through at relay time, then is handed to Expo and forgotten.
 */

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// username -> set of Expo push tokens (a user may have several devices)
const pushTokens = new Map<string, Set<string>>();

export function registerPushToken(username: string, token: string): void {
  if (!username || !token || !token.startsWith("ExponentPushToken")) return;
  let set = pushTokens.get(username);
  if (!set) {
    set = new Set();
    pushTokens.set(username, set);
  }
  set.add(token);
}

export function unregisterPushTokens(username: string): void {
  pushTokens.delete(username);
}

interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** Fire-and-forget push to all of a user's registered devices.
 *  Never throws; never blocks the relay path. */
export function sendPushToUser(username: string, payload: PushPayload): void {
  const tokens = pushTokens.get(username);
  if (!tokens || tokens.size === 0) return;

  const messages = [...tokens].map((to) => ({
    to,
    title: payload.title,
    body: payload.body.slice(0, 160),
    data: payload.data ?? {},
    sound: "default",
    priority: "high",
    channelId: "default",
  }));

  void fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(messages),
  })
    .then(async (res) => {
      // Prune tokens Expo reports as dead (DeviceNotRegistered).
      const json = (await res.json().catch(() => null)) as
        | { data?: Array<{ status: string; details?: { error?: string } }> }
        | null;
      if (!json?.data) return;
      const list = [...tokens];
      json.data.forEach((ticket, i) => {
        if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
          const dead = list[i];
          if (dead) tokens.delete(dead);
        }
      });
    })
    .catch(() => {
      /* transient network failure — next event will retry naturally */
    });
}
