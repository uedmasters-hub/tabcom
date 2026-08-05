/**
 * Guest-expiry banner — appears in the final 5 minutes with a live,
 * Apple-style countdown. Purely informational: the real expiry (wipe +
 * route to the expired screen) is owned by useGuestExpiryWatcher.
 *
 * Layout mirrors the design reference: a soft cream/yellow card with a
 * rounded countdown capsule on the left and the message + supporting
 * line on the right.
 */
import { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useAuth } from "@/stores/auth";
import {
  guestExpiresAt,
  shouldShowGuestExpiryBanner,
} from "@/lib/guest-session";
import { Countdown } from "@/components/ui/Countdown";

export function GuestExpiryBanner() {
  const guest = useAuth((s) => s.guest);
  const [, setTick] = useState(0);

  // A light 1s tick only flips the banner's visibility when the final
  // 5-minute window opens. The countdown drives its own animation from a
  // stable deadline, so these re-renders never restart it.
  useEffect(() => {
    if (!guest) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [guest?.startedAt]);

  if (!guest || !shouldShowGuestExpiryBanner(guest.startedAt)) return null;

  return (
    <View style={styles.banner} accessibilityRole="alert">
      <View style={styles.capsule}>
        <Countdown
          expiresAt={guestExpiresAt(guest.startedAt)}
          digitStyle={styles.digit}
          cellHeight={26}
        />
      </View>

      <View style={styles.copy}>
        <Text style={styles.title}>Guest session ending soon</Text>
        <Text style={styles.sub}>
          Your data will be cleared when it expires
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: "#fdf6d9", // soft cream/yellow
    borderWidth: 1,
    borderColor: "#f4e4a6", // hairline gold
    // Subtle iOS-style shadow.
    shadowColor: "#b45309",
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  capsule: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    minWidth: 68,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fffdf5", // cream fill
    borderWidth: 1,
    borderColor: "#e6cf87", // thin gold border
  },
  digit: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "800",
    color: "#c2410c", // bold dark-orange
    fontVariant: ["tabular-nums"],
    textAlign: "center",
  },
  copy: { flex: 1 },
  title: {
    fontSize: 15,
    fontWeight: "700",
    color: "#b45309",
    letterSpacing: -0.2,
  },
  sub: {
    fontSize: 12.5,
    color: "#b8862f",
    marginTop: 2,
    lineHeight: 17,
  },
});
