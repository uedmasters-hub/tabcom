import { View } from "react-native";
import { color, radius, space } from "@/theme";

interface StepIndicatorProps { steps: number; current: number; }

export function StepIndicator({ steps, current }: StepIndicatorProps) {
  return (
    <View style={{ flexDirection: "row", gap: space.xs, paddingBottom: space.xs }}>
      {Array.from({ length: steps }, (_, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: 3,
            borderRadius: radius.full,
            backgroundColor: i < current ? color.primary : color.border,
          }}
        />
      ))}
    </View>
  );
}
