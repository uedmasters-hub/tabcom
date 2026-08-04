/**
 * Horizontally scrollable Recent Calls strip — sits between Notes and
 * the chat list. Tap opens a bottom sheet; long-press offers quick shortcuts.
 */
import { useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
  ActionSheetIOS,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useCallHistory, type CallLogEntry } from "@/stores/call-history";
import { useChatStore } from "@/stores/chat";
import { Avatar } from "@/components/Avatar";
import {
  CallContactSheet,
  useOngoingPeer,
} from "@/components/CallContactSheet";
import { alert } from "@/lib/alert";
import { formatListTime } from "@/lib/format-time";
import { color, space, radius } from "@/theme";

function startCallFor(entry: CallLogEntry, video: boolean) {
  try {
    const { startCall } = require("@/lib/call-manager") as typeof import("@/lib/call-manager");
    startCall(
      {
        username: entry.peerUsername,
        name: entry.peerName,
        color: entry.peerColor,
      },
      video
    );
  } catch {
    /* Expo Go */
  }
}

function CallChip({
  entry,
  photo,
  ongoing,
  onOpen,
  onQuick,
}: {
  entry: CallLogEntry;
  photo?: string;
  ongoing: boolean;
  onOpen: () => void;
  onQuick: () => void;
}) {
  const missed = entry.outcome === "missed" && !entry.seen;
  const failed =
    entry.outcome === "failed" ||
    entry.outcome === "offline" ||
    entry.outcome === "timed_out";

  let badgeBg: string = entry.video ? color.primary : color.success;
  let badgeIcon: keyof typeof Ionicons.glyphMap = entry.video
    ? "videocam"
    : "call";
  if (ongoing) {
    badgeBg = color.success;
    badgeIcon = "radio-button-on";
  } else if (missed) {
    badgeBg = color.danger;
    badgeIcon = entry.video ? "videocam-off" : "call";
  } else if (entry.outcome === "declined" || entry.outcome === "busy") {
    badgeBg = color.warning;
  } else if (failed) {
    badgeBg = color.subtle;
  }

  return (
    <Pressable
      onPress={onOpen}
      onLongPress={onQuick}
      delayLongPress={350}
      style={styles.chip}
      className="active:opacity-75"
      accessibilityRole="button"
      accessibilityLabel={`${entry.peerName}, ${formatListTime(entry.startedAt)}`}
      accessibilityHint="Opens call actions. Long press for shortcuts."
    >
      <View>
        <Avatar
          name={entry.peerName}
          color={entry.peerColor}
          photo={photo}
          size="lg"
        />
        <View
          style={[
            styles.badge,
            { backgroundColor: badgeBg },
            ongoing && styles.badgeOngoing,
          ]}
        >
          <Ionicons name={badgeIcon} size={10} color={color.white} />
        </View>
      </View>
      <Text
        numberOfLines={1}
        style={[styles.name, missed && styles.nameMissed]}
      >
        {entry.peerName}
      </Text>
      <Text
        style={[
          styles.meta,
          missed && { color: color.danger },
          ongoing && { color: color.success },
        ]}
        numberOfLines={1}
      >
        {ongoing ? "On call" : formatListTime(entry.startedAt)}
      </Text>
    </Pressable>
  );
}

export function RecentCalls() {
  const recent = useCallHistory((s) => s.recent);
  const unseen = useCallHistory((s) => s.unseenMissed);
  const contacts = useChatStore((s) => s.contacts);
  const ongoingPeer = useOngoingPeer();
  const router = useRouter();

  const [sheetEntry, setSheetEntry] = useState<CallLogEntry | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const photoByUser = useMemo(() => {
    const map: Record<string, string | undefined> = {};
    for (const c of contacts) {
      if (c.username) map[c.username] = c.photo;
    }
    return map;
  }, [contacts]);

  const unique = useMemo(() => {
    const seen = new Set<string>();
    const list: CallLogEntry[] = [];
    for (const c of recent) {
      if (seen.has(c.peerUsername)) continue;
      seen.add(c.peerUsername);
      list.push(c);
      if (list.length >= 16) break;
    }
    return list;
  }, [recent]);

  if (unique.length === 0) return null;

  const openSheet = (entry: CallLogEntry) => {
    setSheetEntry(entry);
    setSheetOpen(true);
  };

  const closeSheet = () => setSheetOpen(false);

  const openChat = (entry: CallLogEntry) => {
    try {
      const contactId = `u-${entry.peerUsername}`;
      const convId = useChatStore.getState().startConversation(contactId);
      useCallHistory.getState().markAllMissedSeen();
      router.push(`/conversation/${convId}` as any);
    } catch {
      /* ignore */
    }
  };

  const placeCall = (entry: CallLogEntry, video: boolean) => {
    startCallFor(entry, video);
    router.push(
      `/call/${entry.peerUsername}?peerName=${encodeURIComponent(entry.peerName)}&peerColor=${encodeURIComponent(entry.peerColor)}&role=caller&video=${video}` as any
    );
  };

  const longPressShortcuts = (entry: CallLogEntry) => {
    const options = [
      "Audio Call",
      "Video Call",
      "Open Chat",
      "Call details",
      "Cancel",
    ] as const;
    const cancel = options.length - 1;

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...options],
          cancelButtonIndex: cancel,
          title: entry.peerName,
          message: "Quick actions",
        },
        (idx) => {
          if (idx === 0) placeCall(entry, false);
          else if (idx === 1) placeCall(entry, true);
          else if (idx === 2) openChat(entry);
          else if (idx === 3) openSheet(entry);
        }
      );
      return;
    }

    alert(entry.peerName, "Quick actions", [
      { text: "Audio Call", onPress: () => placeCall(entry, false) },
      { text: "Video Call", onPress: () => placeCall(entry, true) },
      { text: "Open Chat", onPress: () => openChat(entry) },
      { text: "Call details", onPress: () => openSheet(entry) },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const sheetPhoto = sheetEntry
    ? photoByUser[sheetEntry.peerUsername]
    : undefined;

  return (
    <View style={styles.wall}>
      <View style={styles.header}>
        <Text style={styles.title}>Recent calls</Text>
        {unseen > 0 ? (
          <View style={styles.missedPill}>
            <Text style={styles.missedText}>{unseen} missed</Text>
          </View>
        ) : null}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        decelerationRate="fast"
      >
        {unique.map((c) => (
          <CallChip
            key={c.peerUsername}
            entry={c}
            photo={photoByUser[c.peerUsername]}
            ongoing={ongoingPeer === c.peerUsername}
            onOpen={() => openSheet(c)}
            onQuick={() => longPressShortcuts(c)}
          />
        ))}
      </ScrollView>

      <CallContactSheet
        visible={sheetOpen}
        entry={sheetEntry}
        photo={sheetPhoto}
        onClose={closeSheet}
      />
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
    marginBottom: 12,
    gap: 8,
  },
  title: {
    fontSize: 13,
    fontWeight: "700",
    color: color.muted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  missedPill: {
    backgroundColor: color.dangerWash,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  missedText: {
    color: color.danger,
    fontSize: 11,
    fontWeight: "700",
  },
  scroll: {
    paddingHorizontal: 16,
    gap: 2,
    paddingBottom: 4,
  },
  chip: {
    width: 76,
    alignItems: "center",
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  badge: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: color.background,
  },
  badgeOngoing: {
    borderColor: color.successWash,
  },
  name: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: "600",
    color: color.ink,
    textAlign: "center",
    width: "100%",
  },
  nameMissed: {
    color: color.danger,
    fontWeight: "700",
  },
  meta: {
    fontSize: 10,
    marginTop: 2,
    textAlign: "center",
    color: color.muted,
  },
});
