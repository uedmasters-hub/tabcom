/**
 * Placeholder when content is temporarily unavailable due to privacy policy.
 * Message row stays in the conversation; payload remains on device.
 */
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { color, radius, space } from "@/theme";

export function PrivacyPlaceholder({
  label,
  mine,
  onDetails,
}: {
  label: string;
  mine?: boolean;
  onDetails?: () => void;
}) {
  return (
    <Pressable
      onPress={onDetails}
      disabled={!onDetails}
      style={[styles.box, mine ? styles.mine : styles.theirs]}
      className="active:opacity-80"
    >
      <Ionicons
        name="shield-outline"
        size={16}
        color={mine ? "rgba(255,255,255,0.55)" : color.subtle}
      />
      <Text style={[styles.text, mine && styles.textMine]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: space.md + 2,
    paddingVertical: space.md,
    minWidth: 160,
  },
  mine: {},
  theirs: {},
  text: {
    flex: 1,
    fontSize: 14,
    color: color.muted,
    fontStyle: "italic",
  },
  textMine: {
    color: "rgba(255,255,255,0.65)",
  },
});
