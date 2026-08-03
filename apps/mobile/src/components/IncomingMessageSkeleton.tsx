import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
  FadeOut,
} from "react-native-reanimated";

/**
 * Single incoming bubble shimmer — used when a notification lands in an
 * already-open chat (or a chat that already has history). Never replaces
 * the whole thread the way ChatSkeleton does.
 */
export function IncomingMessageSkeleton() {
  const shimmer = useSharedValue(0.35);

  useEffect(() => {
    shimmer.value = withRepeat(
      withSequence(
        withTiming(0.7, { duration: 450, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.35, { duration: 450, easing: Easing.inOut(Easing.quad) })
      ),
      -1,
      false
    );
  }, [shimmer]);

  const style = useAnimatedStyle(() => ({ opacity: shimmer.value }));

  return (
    <Animated.View exiting={FadeOut.duration(200)} className="px-4 mb-3 items-start">
      <Animated.View
        style={[style, { width: 168, height: 38 }]}
        className="bg-slate-200 rounded-3xl rounded-bl-lg"
      />
    </Animated.View>
  );
}
