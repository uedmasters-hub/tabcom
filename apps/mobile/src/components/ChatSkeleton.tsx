import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing,
} from "react-native-reanimated";

/** Shimmering placeholder bubble. */
function Bubble({ mine, width, delay }: { mine: boolean; width: number; delay: number }) {
  const shimmer = useSharedValue(0.35);

  useEffect(() => {
    shimmer.value = withRepeat(
      withTiming(0.75, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
  }, []);

  const style = useAnimatedStyle(() => ({ opacity: shimmer.value }));

  return (
    <View className={`px-4 mb-3 ${mine ? "items-end" : "items-start"}`}>
      <Animated.View
        style={[style, { width, height: 42 }]}
        className={`rounded-3xl ${
          mine ? "bg-slate-300 rounded-br-lg" : "bg-slate-200 rounded-bl-lg"
        }`}
      />
      <Animated.View
        style={[style, { width: 44, height: 10 }]}
        className="bg-slate-200 rounded-full mt-1.5"
      />
    </View>
  );
}

/**
 * Shown while a newly-selected conversation resolves. Deliberately
 * mimics the real bubble rhythm — alternating sides, varied widths —
 * so the transition into real content doesn't jump.
 */
export function ChatSkeleton() {
  const rows: Array<{ mine: boolean; width: number }> = [
    { mine: false, width: 190 },
    { mine: true, width: 140 },
    { mine: false, width: 230 },
    { mine: true, width: 175 },
    { mine: false, width: 120 },
  ];

  return (
    <View className="flex-1 py-4">
      {rows.map((r, i) => (
        <Bubble key={i} mine={r.mine} width={r.width} delay={i * 90} />
      ))}
    </View>
  );
}
