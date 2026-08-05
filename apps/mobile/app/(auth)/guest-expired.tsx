/**
 * Guest Session Ended — a two-step, privacy-focused experience:
 *
 *   1. Cleaning   — a live checklist wipes each guest-data surface
 *                   (Conversations, Contacts, Community, Media, Call logs,
 *                   Cache). Both CTAs stay disabled until every step is done.
 *   2. Completed  — the message and checklist flip to "cleaned", and the
 *                   buttons enable.
 *
 * The actual work is owned by the modular, idempotent guest-cleanup
 * engine (src/lib/guest-cleanup.ts); this screen just drives + reflects it.
 */
import { useEffect, useRef, useState } from "react";
import { Text, View, Image, StyleSheet, UIManager, Platform } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeIn } from "react-native-reanimated";
import { Button } from "@/components/ui";
import { GUEST_SESSION_MS } from "@/lib/guest-session";
import {
  beginGuestCleanup,
  runGuestCleanup,
  getCleanupProgress,
  type CleanupProgress,
  type StepStatus,
} from "@/lib/guest-cleanup";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const GUEST_MINUTES = Math.round(GUEST_SESSION_MS / 60000);

export default function GuestExpiredScreen() {
  const router = useRouter();
  const [progress, setProgress] = useState<CleanupProgress | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let mounted = true;

    (async () => {
      // Reflect any progress already persisted (e.g. re-entering mid-wipe).
      try {
        const snap = await getCleanupProgress();
        if (mounted) setProgress(snap);
      } catch {
        /* first run — nothing persisted yet */
      }
      // Mark pending, then run (or resume) with a gentle per-step pace so
      // each item can animate as it completes.
      await beginGuestCleanup(null);
      await runGuestCleanup(
        (p) => {
          if (mounted) setProgress(p);
        },
        { stepDelayMs: 320 }
      );
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const steps = progress?.steps ?? [];
  const complete = progress?.complete ?? false;

  return (
    <SafeAreaView className="flex-1 bg-background">
      {/* Hero */}
      <View style={styles.hero}>
        <Image
          source={require("../../assets/illustrations/guest-clock.png")}
          style={styles.illustration}
          resizeMode="contain"
        />
        <View style={styles.summaryRow}>
          <Text style={styles.minutes}>{GUEST_MINUTES}</Text>
          <Text style={styles.minLabel}>min</Text>
        </View>
        <Text style={styles.summaryText}>Guest session completed</Text>
      </View>

      {/* Body */}
      <View className="flex-1 px-8 pt-7">
        <Text style={styles.lead}>
          {complete
            ? "Your device has been cleaned and is ready for another guest."
            : "Please wait while we securely remove guest data from this device."}
        </Text>

        <View className="mt-6">
          {steps.map((s, i) => (
            <StepRow
              key={s.id}
              label={s.label}
              status={s.status}
              isLast={i === steps.length - 1}
            />
          ))}
        </View>
      </View>

      {/* Actions — disabled until cleanup completes */}
      <View className="px-8 pb-4 gap-3">
        <Button
          disabled={!complete}
          onPress={() => router.replace("/(auth)/guest" as any)}
        >
          Start a new guest session
        </Button>
        <Button
          variant="secondary"
          disabled={!complete}
          onPress={() => router.replace("/(auth)/welcome" as any)}
        >
          Back to welcome
        </Button>
      </View>
    </SafeAreaView>
  );
}

function StepRow({
  label,
  status,
  isLast,
}: {
  label: string;
  status: StepStatus;
  isLast: boolean;
}) {
  const labelColor =
    status === "done" ? "#16a34a" : status === "active" ? "#0f172a" : "#cbd5e1";

  return (
    <View style={styles.stepRow}>
      <View style={styles.gutter}>
        {/* Re-mounting on status change gives a clean fade per step. */}
        <Animated.View key={status} entering={FadeIn.duration(280)}>
          {status === "done" ? (
            <Ionicons name="checkmark-circle" size={22} color="#16a34a" />
          ) : status === "active" ? (
            <Text style={styles.hourglass}>⏳</Text>
          ) : (
            <View style={styles.pendingDot} />
          )}
        </Animated.View>
        {!isLast && (
          <View
            style={[
              styles.connector,
              { borderColor: status === "done" ? "#86efac" : "#e2e8f0" },
            ]}
          />
        )}
      </View>

      <View style={styles.stepBody}>
        <Text style={[styles.stepLabel, { color: labelColor }]}>{label}</Text>
        {status === "active" && <Text style={styles.cleaning}>cleaning…</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: "center",
    paddingTop: 12,
    paddingBottom: 26,
    backgroundColor: "#f8fafc",
  },
  illustration: { width: 150, height: 152 },
  summaryRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 4 },
  minutes: {
    fontSize: 40,
    fontWeight: "800",
    color: "#0f172a",
    letterSpacing: -1,
    lineHeight: 44,
  },
  minLabel: { fontSize: 16, color: "#64748b", marginLeft: 5, marginBottom: 7 },
  summaryText: { fontSize: 17, color: "#0f172a", marginTop: 2 },
  lead: { fontSize: 17, lineHeight: 24, color: "#0f172a" },
  stepRow: { flexDirection: "row" },
  gutter: { width: 30, alignItems: "center" },
  hourglass: { fontSize: 18, lineHeight: 22 },
  pendingDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#e2e8f0",
  },
  connector: {
    flex: 1,
    minHeight: 20,
    borderLeftWidth: 1.5,
    borderStyle: "dashed",
    marginTop: 2,
  },
  stepBody: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: 18,
    marginLeft: 6,
  },
  stepLabel: { fontSize: 19, fontWeight: "600" },
  cleaning: { marginLeft: 8, fontSize: 14, color: "#2563eb" },
});
