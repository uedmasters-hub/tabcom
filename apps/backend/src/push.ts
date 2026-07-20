/**
 * Expo push delivery.
 *
 * Design notes that matter for parity with mainstream chat apps:
 *
 *  - CATEGORIES map to Android notification channels, so a user can
 *    mute "typing" without losing calls. Channel ids must match the
 *    ones created client-side in apps/mobile/src/lib/notifications.ts.
 *
 *  - COLLAPSE IDS stop a burst becoming a wall. A second message from
 *    the same person replaces the first rather than stacking.
 *
 *  - TTL matters for ephemeral events: a "typing" or "incoming call"
 *    delivered four minutes late is noise, so those expire.
 *
 *  - RATE LIMITING applies to typing specifically. Without it a fast
 *    typist generates a push per keystroke burst and drains the
 *    recipient's battery.
 *
 * Tokens are in-memory: they survive socket reconnects but not a
 * container restart, so devices re-register on next app open.
 * Upgrade path: persist in Postgres via Drizzle.
 */

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// username -> set of Expo push tokens (a user may have several devices)
const pushTokens = new Map<string, Set<string>>();

export function registerPushToken(username: string, token: string): void {
  if (!username || !token?.startsWith("ExponentPushToken")) return;
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

export function hasPushTokens(username: string): boolean {
  return (pushTokens.get(username)?.size ?? 0) > 0;
}

/** Notification categories. Keep ids in sync with the mobile client. */
export type PushCategory =
  | "calls"
  | "messages"
  | "requests"
  | "communities"
  | "tabs"
  | "typing";

interface CategoryConfig {
  channelId: string;
  priority: "high" | "normal";
  sound: "default" | null;
  ttl?: number;
  collapse: boolean;
}

const CHANNELS: Record<PushCategory, CategoryConfig> = {
  // Ringing must cut through. Short TTL: a call notification arriving
  // after the caller gave up is worse than none at all.
  calls: { channelId: "calls", priority: "high", sound: "default", ttl: 45, collapse: true },
  messages: { channelId: "messages", priority: "high", sound: "default", collapse: true },
  requests: { channelId: "requests", priority: "high", sound: "default", collapse: true },
  communities: { channelId: "communities", priority: "high", sound: "default", collapse: true },
  tabs: { channelId: "tabs", priority: "normal", sound: "default", collapse: true },
  // Snapchat-style. Silent, low priority, expires almost immediately —
  // a stale "is typing" is actively misleading.
  typing: { channelId: "typing", priority: "normal", sound: null, ttl: 8, collapse: true },
};

export interface PushPayload {
  title: string;
  body: string;
  category: PushCategory;
  /** Deep-link target, e.g. "/conversation/abc". */
  route?: string;
  /** Groups related notifications and drives the collapse id. */
  threadId?: string;
  /** Unread count for the app badge. */
  badge?: number;
  data?: Record<string, unknown>;
}

/** Typing pushes are throttled per (recipient, thread). */
const typingThrottle = new Map<string, number>();
const TYPING_THROTTLE_MS = 25_000;

function typingAllowed(username: string, threadId: string): boolean {
  const key = `${username}:${threadId}`;
  const now = Date.now();
  const last = typingThrottle.get(key) ?? 0;
  if (now - last < TYPING_THROTTLE_MS) return false;
  typingThrottle.set(key, now);
  return true;
}

/** Periodic cleanup so the throttle map can't grow without bound. */
const throttleSweep = setInterval(() => {
  const cutoff = Date.now() - TYPING_THROTTLE_MS * 4;
  for (const [key, at] of typingThrottle) {
    if (at < cutoff) typingThrottle.delete(key);
  }
}, 5 * 60_000);
throttleSweep.unref?.();

/**
 * Fire-and-forget push to all of a user's registered devices.
 * Never throws; never blocks the relay path.
 */
export function sendPushToUser(username: string, payload: PushPayload): void {
  const tokens = pushTokens.get(username);
  if (!tokens || tokens.size === 0) return;

  const cfg = CHANNELS[payload.category] ?? CHANNELS.messages;

  if (payload.category === "typing" && !typingAllowed(username, payload.threadId ?? "unknown")) {
    return;
  }

  // One collapse identity per conversation per category, so a stream of
  // messages from one person updates a single notification.
  const collapseId = cfg.collapse
    ? `${payload.category}:${payload.threadId ?? username}`
    : undefined;

  const messages = [...tokens].map((to) => ({
    to,
    title: payload.title,
    body: payload.body.slice(0, 160),
    data: {
      ...(payload.data ?? {}),
      category: payload.category,
      route: payload.route,
      threadId: payload.threadId,
    },
    sound: cfg.sound,
    priority: cfg.priority,
    channelId: cfg.channelId,
    ...(collapseId ? { collapseId } : {}),
    ...(cfg.ttl ? { ttl: cfg.ttl } : {}),
    ...(payload.badge != null ? { badge: payload.badge } : {}),
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
      if (tokens.size === 0) pushTokens.delete(username);
    })
    .catch(() => {
      /* transient network failure — next event will retry naturally */
    });
}

/** Human-readable label for a message kind, used as notification body. */
export function describeMessageKind(kind: string, text?: string): string {
  switch (kind) {
    case "image": return "📷 Photo";
    case "video": return "🎥 Video";
    case "voice": return "🎤 Voice message";
    case "file": return "📎 File";
    case "location": return "📍 Location";
    case "contact": return "👤 Contact";
    default: return (text ?? "").slice(0, 160) || "New message";
  }
}
