import { View } from "react-native";

interface StepIndicatorProps { steps: number; current: number; }

export function StepIndicator({ steps, current }: StepIndicatorProps) {
  return (
    <View className="flex-row gap-1 pb-1">
      {Array.from({ length: steps }, (_, i) => (
        <View key={i}
          style={{ backgroundColor: i < current ? "#2563eb" : "#e2e8f0" }}
          className="flex-1 h-[3px] rounded-full" />
      ))}
    </View>
  );
}
