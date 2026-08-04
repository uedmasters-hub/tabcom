/**
 * Bottom sheet for a recent-call contact: quick Actions + Call History timeline.
 * Opened from the Recent Calls strip — never jumps straight into a call.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Avatar } from "@/components/Avatar";
import { alert } from "@/lib/alert";
import {
  useCallHistory,
  formatCallDuration,
  outcomeLabel,
  type CallLogEntry,
} from "@/stores/call-history";
import { color, motion, radius, space, size } from "@/theme";
import type { CallOutcome } from "@/lib/local-storage";

type Tab = "actions" | "history";

interface Props {
  visible: boolean;
  entry: CallLogEntry | null;
  photo?: string;
  onClose: () => void;
}

const ACTIVE_PHASES = new Set([
  "calling",
  "ringing",
  "connecting",
  "connected",
  "reconnecting",
  "on-hold",
]);

function formatCallWhen(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  if (sameDay) return `Today · ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday · ${time}`;
  const date = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
  return `${date} · ${time}`;
}

function qualityLabel(q?: string): string | null {
  if (!q || q === "unknown") return null;
  const map: Record<string, string> = {
    good: "Good quality",
    fair: "Fair quality",
    poor: "Poor quality",
  };
  return map[q] ?? q;
}

function statusColor(outcome: CallOutcome): string {
  if (outcome === "missed") return color.danger;
  if (outcome === "declined" || outcome === "busy") return color.warning;
  if (outcome === "answered") return color.success;
  if (outcome === "failed" || outcome === "offline" || outcome === "timed_out") {
    return color.subtle;
  }
  return color.muted;
}

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
    /* call manager may be unavailable in Expo Go */
  }
}

export function CallContactSheet({ visible, entry, photo, onClose }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const [tab, setTab] = useState<Tab>("actions");
  const [showAll, setShowAll] = useState(false);
  const [mounted, setMounted] = useState(false);
  const recent = useCallHistory((s) => s.recent);
  const remove = useCallHistory((s) => s.remove);
  const clearPeer = useCallHistory((s) => s.clearPeer);
  const callsForPeer = useCallHistory((s) => s.callsForPeer);

  const backdrop = useSharedValue(0);
  const sheetY = useSharedValue(40);

  const peerCalls = useMemo(() => {
    if (!entry) return [];
    return callsForPeer(entry.peerUsername);
    // Recompute when the global recent list changes (insert/delete/clear).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.peerUsername, recent, callsForPeer]);

  const visibleCalls = showAll ? peerCalls : peerCalls.slice(0, 12);

  useEffect(() => {
    if (visible && entry) {
      setMounted(true);
      setTab("actions");
      setShowAll(false);
      useCallHistory.getState().markAllMissedSeen();
      backdrop.value = withTiming(1, {
        duration: motion.base,
        easing: Easing.out(Easing.cubic),
      });
      sheetY.value = withTiming(0, {
        duration: motion.slow,
        easing: Easing.out(Easing.cubic),
      });
    } else if (mounted) {
      backdrop.value = withTiming(0, { duration: motion.fast });
      sheetY.value = withTiming(
        48,
        { duration: motion.base, easing: Easing.in(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(setMounted)(false);
        }
      );
    }
  }, [visible, entry]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdrop.value,
  }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetY.value }],
    opacity: 0.4 + backdrop.value * 0.6,
  }));

  const openChat = useCallback(() => {
    if (!entry) return;
    try {
      const { useChatStore } = require("@/stores/chat") as typeof import("@/stores/chat");
      const contactId = `u-${entry.peerUsername}`;
      const convId = useChatStore.getState().startConversation(contactId);
      onClose();
      router.push(`/conversation/${convId}` as any);
    } catch {
      onClose();
    }
  }, [entry, onClose, router]);

  const callAudio = useCallback(() => {
    if (!entry) return;
    startCallFor(entry, false);
    onClose();
    router.push(
      `/call/${entry.peerUsername}?peerName=${encodeURIComponent(entry.peerName)}&peerColor=${encodeURIComponent(entry.peerColor)}&role=caller&video=false` as any
    );
  }, [entry, onClose, router]);

  const callVideo = useCallback(() => {
    if (!entry) return;
    startCallFor(entry, true);
    onClose();
    router.push(
      `/call/${entry.peerUsername}?peerName=${encodeURIComponent(entry.peerName)}&peerColor=${encodeURIComponent(entry.peerColor)}&role=caller&video=true` as any
    );
  }, [entry, onClose, router]);

  const callAgain = useCallback(
    (c: CallLogEntry) => {
      if (c.video) callVideo();
      else callAudio();
    },
    [callAudio, callVideo]
  );

  const confirmDelete = (id: string) => {
    alert("Delete call?", "Remove this entry from call history.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => remove(id),
      },
    ]);
  };

  const confirmClear = () => {
    if (!entry) return;
    alert(
      "Clear call history?",
      `Remove all calls with ${entry.peerName} from this device.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => {
            clearPeer(entry.peerUsername);
            setTab("actions");
          },
        },
      ]
    );
  };

  if (!mounted || !entry) return null;

  const sheetMax = Math.min(winH * 0.82, 640);

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            sheetStyle,
            { maxHeight: sheetMax, paddingBottom: Math.max(insets.bottom, 12) },
          ]}
        >
          <View style={styles.handle} />

          <View style={styles.header}>
            <Avatar
              name={entry.peerName}
              color={entry.peerColor}
              photo={photo}
              size="xl"
            />
            <Text style={styles.peerName} numberOfLines={1}>
              {entry.peerName}
            </Text>
            <Text style={styles.peerUser} numberOfLines={1}>
              @{entry.peerUsername}
            </Text>
          </View>

          <View style={styles.segments}>
            <Pressable
              onPress={() => setTab("actions")}
              style={[styles.segment, tab === "actions" && styles.segmentActive]}
              className="active:opacity-80"
            >
              <Text
                style={[
                  styles.segmentLabel,
                  tab === "actions" && styles.segmentLabelActive,
                ]}
              >
                Actions
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setTab("history")}
              style={[styles.segment, tab === "history" && styles.segmentActive]}
              className="active:opacity-80"
            >
              <Text
                style={[
                  styles.segmentLabel,
                  tab === "history" && styles.segmentLabelActive,
                ]}
              >
                Call History
              </Text>
              {peerCalls.length > 0 ? (
                <View
                  style={[
                    styles.countPill,
                    tab === "history" && styles.countPillActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.countText,
                      tab === "history" && styles.countTextActive,
                    ]}
                  >
                    {peerCalls.length}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          </View>

          {tab === "actions" ? (
            <ScrollView
              bounces={false}
              contentContainerStyle={styles.actionsPad}
              showsVerticalScrollIndicator={false}
            >
              <ActionRow
                icon="call"
                iconColor={color.success}
                wash={color.successWash}
                title="Audio Call"
                subtitle="Start a voice call"
                onPress={callAudio}
              />
              <ActionRow
                icon="videocam"
                iconColor={color.primary}
                wash={color.primaryWash}
                title="Video Call"
                subtitle="Start a video call"
                onPress={callVideo}
              />
              <ActionRow
                icon="chatbubble"
                iconColor={color.ink}
                wash={color.surfaceAlt}
                title="Open Chat"
                subtitle="Continue the conversation"
                onPress={openChat}
              />

              <View style={styles.divider} />

              <Pressable
                onPress={() => {
                  setShowAll(true);
                  setTab("history");
                }}
                style={styles.linkRow}
                className="active:opacity-70"
              >
                <Ionicons name="time-outline" size={18} color={color.muted} />
                <Text style={styles.linkText}>View full call history</Text>
                <Ionicons name="chevron-forward" size={18} color={color.faint} />
              </Pressable>

              {peerCalls.length > 0 ? (
                <Pressable
                  onPress={confirmClear}
                  style={styles.linkRow}
                  className="active:opacity-70"
                >
                  <Ionicons name="trash-outline" size={18} color={color.danger} />
                  <Text style={[styles.linkText, { color: color.danger }]}>
                    Clear call history for this contact
                  </Text>
                </Pressable>
              ) : null}
            </ScrollView>
          ) : (
            <ScrollView
              contentContainerStyle={styles.historyPad}
              showsVerticalScrollIndicator={false}
            >
              {visibleCalls.length === 0 ? (
                <View style={styles.empty}>
                  <Ionicons name="call-outline" size={36} color={color.faint} />
                  <Text style={styles.emptyTitle}>No calls yet</Text>
                  <Text style={styles.emptyBody}>
                    Calls with {entry.peerName} will show up here.
                  </Text>
                </View>
              ) : (
                visibleCalls.map((c) => (
                  <HistoryRow
                    key={c.id}
                    entry={c}
                    onCallAgain={() => callAgain(c)}
                    onDelete={() => confirmDelete(c.id)}
                  />
                ))
              )}

              {!showAll && peerCalls.length > visibleCalls.length ? (
                <Pressable
                  onPress={() => setShowAll(true)}
                  style={styles.moreBtn}
                  className="active:opacity-70"
                >
                  <Text style={styles.moreText}>
                    View full call history ({peerCalls.length})
                  </Text>
                </Pressable>
              ) : null}

              {peerCalls.length > 0 ? (
                <Pressable
                  onPress={confirmClear}
                  style={styles.clearFooter}
                  className="active:opacity-70"
                >
                  <Text style={styles.clearFooterText}>
                    Clear call history for this contact
                  </Text>
                </Pressable>
              ) : null}
            </ScrollView>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

function ActionRow({
  icon,
  iconColor,
  wash,
  title,
  subtitle,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  wash: string;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.actionRow}
      className="active:opacity-80"
    >
      <View style={[styles.actionIcon, { backgroundColor: wash }]}>
        <Ionicons name={icon} size={22} color={iconColor} />
      </View>
      <View style={styles.actionCopy}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionSub}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={color.faint} />
    </Pressable>
  );
}

function HistoryRow({
  entry,
  onCallAgain,
  onDelete,
}: {
  entry: CallLogEntry;
  onCallAgain: () => void;
  onDelete: () => void;
}) {
  const tint = statusColor(entry.outcome);
  const dir =
    entry.direction === "outgoing" ? "Outgoing" : "Incoming";
  const kind = entry.video ? "Video" : "Audio";
  const q = qualityLabel(entry.quality);
  const dur =
    entry.durationMs && entry.durationMs > 0
      ? formatCallDuration(entry.durationMs)
      : null;

  return (
    <View style={styles.histRow}>
      <View style={[styles.histIcon, { backgroundColor: `${tint}18` }]}>
        <Ionicons
          name={entry.video ? "videocam" : "call"}
          size={16}
          color={tint}
        />
      </View>
      <View style={styles.histBody}>
        <Text style={styles.histTitle}>
          {kind} · {dir}
        </Text>
        <Text style={[styles.histStatus, { color: tint }]}>
          {outcomeLabel(entry.outcome)}
          {entry.quickReply ? ` — “${entry.quickReply}”` : ""}
        </Text>
        <Text style={styles.histMeta}>{formatCallWhen(entry.startedAt)}</Text>
        <View style={styles.histChips}>
          {dur ? <Chip label={dur} /> : null}
          {entry.device ? <Chip label={entry.device} /> : null}
          {q ? <Chip label={q} /> : null}
        </View>
      </View>
      <View style={styles.histActions}>
        <Pressable
          onPress={onCallAgain}
          hitSlop={8}
          style={styles.histBtn}
          className="active:opacity-60"
          accessibilityLabel="Call again"
        >
          <Ionicons name="call" size={16} color={color.success} />
        </Pressable>
        <Pressable
          onPress={onDelete}
          hitSlop={8}
          style={styles.histBtn}
          className="active:opacity-60"
          accessibilityLabel="Delete entry"
        >
          <Ionicons name="trash-outline" size={16} color={color.danger} />
        </Pressable>
      </View>
    </View>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

/** True when this peer has an in-progress call session. */
export function useOngoingPeer(): string | null {
  const [peer, setPeer] = useState<string | null>(null);
  useEffect(() => {
    let unsub: (() => void) | undefined;
    try {
      const cm = require("@/lib/call-manager") as typeof import("@/lib/call-manager");
      unsub = cm.subscribe((s) => {
        if (ACTIVE_PHASES.has(s.phase) && s.peer.username) {
          setPeer(s.peer.username);
        } else {
          setPeer(null);
        }
      });
    } catch {
      setPeer(null);
    }
    return () => unsub?.();
  }, []);
  return peer;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
  },
  sheet: {
    backgroundColor: color.background,
    borderTopLeftRadius: radius.xxl + 4,
    borderTopRightRadius: radius.xxl + 4,
    overflow: "hidden",
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.border,
    marginTop: 10,
    marginBottom: 4,
  },
  header: {
    alignItems: "center",
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  peerName: {
    marginTop: 12,
    fontSize: 20,
    fontWeight: "700",
    color: color.ink,
  },
  peerUser: {
    marginTop: 2,
    fontSize: 14,
    color: color.muted,
  },
  segments: {
    flexDirection: "row",
    marginHorizontal: space.lg,
    marginTop: space.sm,
    marginBottom: space.xs,
    padding: 3,
    backgroundColor: color.surfaceAlt,
    borderRadius: radius.md,
  },
  segment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.sm + 2,
  },
  segmentActive: {
    backgroundColor: color.background,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  segmentLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: color.muted,
  },
  segmentLabelActive: {
    color: color.ink,
  },
  countPill: {
    minWidth: 20,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: color.border,
    alignItems: "center",
    justifyContent: "center",
  },
  countPillActive: {
    backgroundColor: color.primaryWash,
  },
  countText: {
    fontSize: 11,
    fontWeight: "700",
    color: color.muted,
  },
  countTextActive: {
    color: color.primary,
  },
  actionsPad: {
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: space.md,
    gap: 4,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: space.sm,
    borderRadius: radius.lg,
    minHeight: size.touchTarget + 8,
  },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  actionCopy: {
    flex: 1,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: color.ink,
  },
  actionSub: {
    fontSize: 13,
    color: color.muted,
    marginTop: 1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.border,
    marginVertical: space.sm,
    marginHorizontal: space.sm,
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: space.sm,
    minHeight: size.touchTarget,
  },
  linkText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
    color: color.ink,
  },
  historyPad: {
    paddingHorizontal: space.md,
    paddingTop: space.xs,
    paddingBottom: space.md,
  },
  empty: {
    alignItems: "center",
    paddingVertical: 40,
    paddingHorizontal: space.lg,
  },
  emptyTitle: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: "600",
    color: color.ink,
  },
  emptyBody: {
    marginTop: 4,
    fontSize: 14,
    color: color.muted,
    textAlign: "center",
  },
  histRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.borderLight,
  },
  histIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    marginTop: 2,
  },
  histBody: {
    flex: 1,
    minWidth: 0,
  },
  histTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: color.ink,
  },
  histStatus: {
    fontSize: 13,
    fontWeight: "600",
    marginTop: 2,
  },
  histMeta: {
    fontSize: 12,
    color: color.muted,
    marginTop: 3,
  },
  histChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  chip: {
    backgroundColor: color.surfaceAlt,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  chipText: {
    fontSize: 11,
    fontWeight: "600",
    color: color.muted,
  },
  histActions: {
    flexDirection: "row",
    gap: 4,
    marginLeft: 4,
  },
  histBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: color.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  moreBtn: {
    alignItems: "center",
    paddingVertical: 14,
  },
  moreText: {
    fontSize: 14,
    fontWeight: "600",
    color: color.primary,
  },
  clearFooter: {
    alignItems: "center",
    paddingVertical: 12,
    marginTop: 4,
  },
  clearFooterText: {
    fontSize: 13,
    fontWeight: "600",
    color: color.danger,
  },
});
