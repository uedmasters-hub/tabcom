/**
 * Recent / missed call history — durable on-device log.
 * Server never stores calls; this is the source of truth for the
 * Recent Calls strip and missed-call badges.
 */
import { Platform } from "react-native";
import { create } from "zustand";
import {
  insertCall,
  getRecentCalls,
  getCallsForPeer,
  deleteCall,
  clearCallsForPeer,
  markMissedCallsSeen,
  getUnseenMissedCount,
  initLocalStorage,
  type CallOutcome,
  type StoredCall,
} from "@/lib/local-storage";

export type { CallOutcome };

export interface CallLogEntry {
  id: string;
  peerUsername: string;
  peerName: string;
  peerColor: string;
  direction: "outgoing" | "incoming";
  video: boolean;
  outcome: CallOutcome;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  quickReply?: string;
  seen: boolean;
  /** e.g. "Mobile", "Tablet" — optional. */
  device?: string;
  /** e.g. "good" | "fair" | "poor" — optional. */
  quality?: string;
}

type State = {
  recent: CallLogEntry[];
  unseenMissed: number;
  hydrate: () => void;
  record: (
    entry: Omit<CallLogEntry, "id" | "seen" | "device"> & {
      id?: string;
      seen?: boolean;
      device?: string;
    }
  ) => void;
  callsForPeer: (peerUsername: string) => CallLogEntry[];
  remove: (id: string) => void;
  clearPeer: (peerUsername: string) => void;
  markAllMissedSeen: () => void;
  notifyUnseenMissed: () => void;
};

function mapRow(r: StoredCall): CallLogEntry {
  return {
    id: r.id,
    peerUsername: r.peer_username,
    peerName: r.peer_name,
    peerColor: r.peer_color,
    direction: r.direction,
    video: r.video === 1,
    outcome: r.outcome,
    startedAt: r.started_at,
    endedAt: r.ended_at ?? undefined,
    durationMs: r.duration_ms ?? undefined,
    quickReply: r.quick_reply ?? undefined,
    seen: r.seen === 1,
    device: r.device ?? undefined,
    quality: r.quality ?? undefined,
  };
}

function newId() {
  return `call-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultDevice(): string {
  return Platform.OS === "ios" || Platform.OS === "android" ? "Mobile" : "Device";
}

export function formatCallDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function outcomeLabel(outcome: CallOutcome): string {
  switch (outcome) {
    case "answered":
      return "Answered";
    case "missed":
      return "Missed";
    case "declined":
      return "Declined";
    case "busy":
      return "Busy";
    case "cancelled":
      return "Cancelled";
    case "timed_out":
      return "No answer";
    case "offline":
      return "Network error";
    case "failed":
      return "Failed";
    default:
      return "Failed";
  }
}

function callSystemLabel(
  entry: Omit<CallLogEntry, "id" | "seen"> & { id?: string; seen?: boolean }
): string {
  const kind = entry.video ? "Video call" : "Voice call";
  const dur =
    entry.durationMs && entry.durationMs > 0
      ? ` · ${formatCallDuration(entry.durationMs)}`
      : "";
  switch (entry.outcome) {
    case "answered":
      return entry.direction === "outgoing"
        ? `${kind} · Outgoing${dur}`
        : `${kind} · Incoming${dur}`;
    case "missed":
      return `${kind} · Missed`;
    case "declined":
      return entry.quickReply
        ? `${kind} · Declined — “${entry.quickReply}”`
        : `${kind} · Declined`;
    case "busy":
      return `${kind} · Busy`;
    case "cancelled":
      return `${kind} · Cancelled`;
    case "timed_out":
      return `${kind} · No answer`;
    case "offline":
      return `${kind} · Unavailable`;
    default:
      return `${kind} · Failed`;
  }
}

function appendSystemNotice(
  entry: Omit<CallLogEntry, "id" | "seen"> & { id?: string; seen?: boolean },
  id: string
) {
  try {
    const { useChatStore } = require("@/stores/chat") as typeof import("@/stores/chat");
    const contactId = `u-${entry.peerUsername}`;
    const convId = useChatStore.getState().startConversation(contactId);
    const label = callSystemLabel(entry);
    const store = useChatStore.getState();
    const msgs = store.messages[convId] ?? [];
    const last = msgs[msgs.length - 1];
    if (last?.kind === "system" && last.text === label) return;

    const message = {
      id: `sys-${id}`,
      authorId: "system",
      kind: "system" as const,
      text: label,
      sentAt: entry.endedAt ?? entry.startedAt,
    };
    useChatStore.setState((state) => {
      const list = state.messages[convId] ?? [];
      return {
        messages: {
          ...state.messages,
          [convId]: [...list, message],
        },
        conversations: state.conversations.map((c) =>
          c.id === convId
            ? { ...c, lastMessageAt: Math.max(c.lastMessageAt, message.sentAt) }
            : c
        ),
      };
    });
  } catch {
    /* chat mirror is best-effort */
  }
}

export const useCallHistory = create<State>((set, get) => ({
  recent: [],
  unseenMissed: 0,

  hydrate: () => {
    try {
      initLocalStorage();
      set({
        recent: getRecentCalls(80).map(mapRow),
        unseenMissed: getUnseenMissedCount(),
      });
    } catch (err) {
      if (__DEV__) console.warn("[tabcom-calls] hydrate failed:", err);
    }
  },

  record: (entry) => {
    const id = entry.id || newId();
    const seen = entry.seen ?? entry.outcome !== "missed";
    const device = entry.device ?? defaultDevice();
    insertCall({
      id,
      peerUsername: entry.peerUsername,
      peerName: entry.peerName,
      peerColor: entry.peerColor,
      direction: entry.direction,
      video: entry.video,
      outcome: entry.outcome,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      durationMs: entry.durationMs,
      quickReply: entry.quickReply,
      seen,
      device,
      quality: entry.quality,
    });
    appendSystemNotice(entry, id);
    get().hydrate();
  },

  callsForPeer: (peerUsername) => {
    try {
      initLocalStorage();
      return getCallsForPeer(peerUsername, 100).map(mapRow);
    } catch {
      return get().recent.filter((c) => c.peerUsername === peerUsername);
    }
  },

  remove: (id) => {
    try {
      deleteCall(id);
    } catch (err) {
      if (__DEV__) console.warn("[tabcom-calls] delete failed:", err);
    }
    get().hydrate();
  },

  clearPeer: (peerUsername) => {
    try {
      clearCallsForPeer(peerUsername);
    } catch (err) {
      if (__DEV__) console.warn("[tabcom-calls] clear peer failed:", err);
    }
    get().hydrate();
  },

  markAllMissedSeen: () => {
    markMissedCallsSeen();
    set({
      unseenMissed: 0,
      recent: get().recent.map((c) => ({ ...c, seen: true })),
    });
  },

  notifyUnseenMissed: () => {
    get().hydrate();
    const missed = get().recent.filter((c) => c.outcome === "missed" && !c.seen);
    if (missed.length === 0) return;

    const fresh = missed.filter((c) => !notifiedMissedIds.has(c.id));
    if (fresh.length === 0) return;
    fresh.forEach((c) => notifiedMissedIds.add(c.id));

    const latest = fresh[0]!;
    const body =
      fresh.length === 1
        ? latest.video
          ? "Missed video call"
          : "Missed voice call"
        : `${fresh.length} missed calls`;

    void import("@/lib/toast").then(({ toast }) => {
      toast(`${latest.peerName}: ${body}`, "info");
    });

    void import("@/lib/notifications").then(({ presentLocalCallNotice }) => {
      void presentLocalCallNotice({
        title: latest.peerName,
        body,
        from: latest.peerUsername,
        video: latest.video,
        name: latest.peerName,
        color: latest.peerColor,
      });
    });
  },
}));

/** Session-scoped: don't re-toast the same missed call on every reconnect. */
const notifiedMissedIds = new Set<string>();
