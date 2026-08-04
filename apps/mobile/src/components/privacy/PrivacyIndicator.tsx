/**
 * Subtle privacy indicator — shield / key / clock — no banners.
 */
import { View, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { PrivacyIndicatorKind } from "@tabcom/shared";
import { color } from "@/theme";

const ICONS: Record<PrivacyIndicatorKind, keyof typeof Ionicons.glyphMap> = {
  shield: "shield-outline",
  key: "key-outline",
  clock: "time-outline",
};

export function PrivacyIndicator({
  kind,
  light,
  size = 11,
}: {
  kind: PrivacyIndicatorKind | null | undefined;
  light?: boolean;
  size?: number;
}) {
  if (!kind) return null;
  return (
    <View style={styles.wrap} accessibilityLabel="Protected by privacy settings">
      <Ionicons
        name={ICONS[kind]}
        size={size}
        color={light ? "rgba(255,255,255,0.7)" : color.muted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginLeft: 4,
    justifyContent: "center",
  },
});
