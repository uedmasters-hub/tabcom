/**
 * Non-intrusive guest-expiry banner — appears in the final 5 minutes
 * with a live countdown. Shown below the screen header on tab screens.
 */
import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "@/stores/auth";
import {
  formatGuestCountdown,
  guestMsRemaining,
  shouldShowGuestExpiryBanner,
} from "@/lib/guest-session";

export function GuestExpiryBanner() {
  const guest = useAuth((s) => s.guest);
  const endGuestSession = useAuth((s) => s.endGuestSession);
  const router = useRouter();
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!guest) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [guest?.startedAt]);

  if (!guest || !shouldShowGuestExpiryBanner(guest.startedAt)) return null;

  const left = guestMsRemaining(guest.startedAt);
  const clock = formatGuestCountdown(left);

  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Ionicons name="time-outline" size={18} color="#92400e" />
      <View style={styles.copy}>
        <Text style={styles.title}>Guest session ending soon</Text>
        <Text style={styles.sub}>
          {clock} left — your data will be cleared when it expires
        </Text>
      </View>
      <Pressable
        onPress={async () => {
          await endGuestSession();
          router.replace("/(auth)/guest-expired" as any);
        }}
        hitSlop={8}
        style={styles.action}
        accessibilityLabel="End guest session now"
      >
        <Text style={styles.actionText}>End</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: "#fffbeb",
    borderWidth: 1,
    borderColor: "#fde68a",
  },
  copy: { flex: 1 },
  title: {
    fontSize: 13,
    fontWeight: "700",
    color: "#92400e",
  },
  sub: {
    fontSize: 12,
    color: "#a16207",
    marginTop: 2,
    lineHeight: 16,
  },
  action: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#fef3c7",
  },
  actionText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#92400e",
  },
});
