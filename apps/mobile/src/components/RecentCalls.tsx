/**
 * Horizontally scrollable Recent Calls strip — sits between Notes and
 * the chat list. One-tap call-back / message / open conversation.
 */
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useCallHistory, type CallLogEntry } from "@/stores/call-history";
import { Avatar } from "@/components/Avatar";
import { formatListTime } from "@/lib/format-time";
import { color, space } from "@/theme";

function outcomeTint(c: CallLogEntry): string {
  if (c.outcome === "missed") return "#ef4444";
  if (c.outcome === "declined" || c.outcome === "busy") return "#f59e0b";
  if (c.outcome === "failed" || c.outcome === "offline" || c.outcome === "timed_out") {
    return "#94a3b8";
  }
  return color.muted;
}

function directionIcon(c: CallLogEntry): keyof typeof Ionicons.glyphMap {
  if (c.outcome === "missed") return "call-outline";
  if (c.direction === "outgoing") return "arrow-up-outline";
  return "arrow-down-outline";
}

function CallChip({ entry }: { entry: CallLogEntry }) {
  const router = useRouter();

  const openChat = () => {
    try {
      const { useChatStore } = require("@/stores/chat");
      const contactId = `u-${entry.peerUsername}`;
      const convId = useChatStore.getState().startConversation(contactId);
      useCallHistory.getState().markAllMissedSeen();
      router.push(`/conversation/${convId}` as any);
    } catch {
      /* ignore */
    }
  };

  const callBack = (video: boolean) => {
    try {
      const { startCall } = require("@/lib/call-manager");
      startCall(
        {
          username: entry.peerUsername,
          name: entry.peerName,
          color: entry.peerColor,
        },
        video
      );
      router.push(
        `/call/${entry.peerUsername}?peerName=${encodeURIComponent(entry.peerName)}&peerColor=${encodeURIComponent(entry.peerColor)}&role=caller&video=${video}` as any
      );
    } catch {
      openChat();
    }
  };

  const tint = outcomeTint(entry);
  const missed = entry.outcome === "missed" && !entry.seen;

  return (
    <Pressable
      onPress={openChat}
      onLongPress={() => callBack(entry.video)}
      style={styles.chip}
      className="active:opacity-75"
    >
      <View>
        <Avatar name={entry.peerName} color={entry.peerColor} size="md" />
        <View
          style={[
            styles.badge,
            { backgroundColor: missed ? "#ef4444" : entry.video ? "#2563eb" : "#16a34a" },
          ]}
        >
          <Ionicons
            name={entry.video ? "videocam" : directionIcon(entry)}
            size={10}
            color="#fff"
          />
        </View>
      </View>
      <Text
        numberOfLines={1}
        style={[styles.name, missed && { color: "#ef4444", fontWeight: "700" }]}
      >
        {entry.peerName}
      </Text>
      <Text style={[styles.meta, { color: tint }]} numberOfLines={1}>
        {formatListTime(entry.startedAt)}
      </Text>
      <View style={styles.actions}>
        <Pressable
          onPress={() => callBack(false)}
          hitSlop={8}
          className="active:opacity-60"
          style={styles.actionBtn}
        >
          <Ionicons name="call" size={14} color="#16a34a" />
        </Pressable>
        <Pressable
          onPress={() => callBack(true)}
          hitSlop={8}
          className="active:opacity-60"
          style={styles.actionBtn}
        >
          <Ionicons name="videocam" size={14} color="#2563eb" />
        </Pressable>
        <Pressable
          onPress={openChat}
          hitSlop={8}
          className="active:opacity-60"
          style={styles.actionBtn}
        >
          <Ionicons name="chatbubble" size={13} color="#64748b" />
        </Pressable>
      </View>
    </Pressable>
  );
}

export function RecentCalls() {
  const recent = useCallHistory((s) => s.recent);
  const unseen = useCallHistory((s) => s.unseenMissed);

  if (recent.length === 0) return null;

  // Deduplicate by peer — keep the newest call per person for the strip.
  const seen = new Set<string>();
  const unique: CallLogEntry[] = [];
  for (const c of recent) {
    if (seen.has(c.peerUsername)) continue;
    seen.add(c.peerUsername);
    unique.push(c);
    if (unique.length >= 12) break;
  }

  return (
    <View style={styles.wall}>
      <View style={styles.header}>
        <Text style={styles.title}>Recent calls</Text>
        {unseen > 0 ? (
          <View style={styles.missedPill}>
            <Text style={styles.missedText}>
              {unseen} missed
            </Text>
          </View>
        ) : null}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {unique.map((c) => (
          <CallChip key={c.id} entry={c} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wall: {
    paddingTop: space.sm,
    paddingBottom: space.xs,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    marginBottom: 10,
    gap: 8,
  },
  title: {
    fontSize: 13,
    fontWeight: "700",
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  missedPill: {
    backgroundColor: "#fef2f2",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  missedText: {
    color: "#ef4444",
    fontSize: 11,
    fontWeight: "700",
  },
  scroll: {
    paddingHorizontal: 16,
    gap: 4,
  },
  chip: {
    width: 88,
    alignItems: "center",
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  badge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  name: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: "600",
    color: "#0f172a",
    textAlign: "center",
    width: "100%",
  },
  meta: {
    fontSize: 10,
    marginTop: 1,
    textAlign: "center",
  },
  actions: {
    flexDirection: "row",
    marginTop: 6,
    gap: 4,
  },
  actionBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
  },
});
