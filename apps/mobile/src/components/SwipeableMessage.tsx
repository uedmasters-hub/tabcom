/**
 * Swipe-to-reply wrapper for chat bubbles (iMessage-style).
 * Swipe right past threshold to reply; vertical scroll still wins.
 */
import { useCallback, useRef } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";

const REPLY_THRESHOLD = 56;
const MAX_PULL = 72;
const SPRING = { damping: 22, stiffness: 240, overshootClamping: true };

interface Props {
  children: React.ReactNode;
  enabled?: boolean;
  onReply: () => void;
}

export function SwipeableMessage({
  children,
  enabled = true,
  onReply,
}: Props) {
  const translateX = useSharedValue(0);
  const onReplyRef = useRef(onReply);
  onReplyRef.current = onReply;

  const fireReply = useCallback(() => {
    onReplyRef.current();
  }, []);

  const pan = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetX([12, 40])
    .failOffsetY([-8, 8])
    .onUpdate((e) => {
      "worklet";
      const x = Math.max(0, Math.min(MAX_PULL, e.translationX));
      translateX.value = x;
    })
    .onEnd(() => {
      "worklet";
      if (translateX.value >= REPLY_THRESHOLD) {
        runOnJS(fireReply)();
      }
      translateX.value = withSpring(0, SPRING);
    });

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const iconStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      translateX.value,
      [0, REPLY_THRESHOLD * 0.45, REPLY_THRESHOLD],
      [0, 0.45, 1],
      Extrapolation.CLAMP
    );
    const scale = interpolate(
      translateX.value,
      [0, REPLY_THRESHOLD],
      [0.6, 1],
      Extrapolation.CLAMP
    );
    return { opacity, transform: [{ scale }] };
  });

  if (!enabled) return <>{children}</>;

  return (
    <View style={{ overflow: "hidden" }}>
      <Animated.View
        style={[
          iconStyle,
          {
            position: "absolute",
            left: 10,
            top: 0,
            bottom: 0,
            width: 36,
            justifyContent: "center",
            alignItems: "center",
          },
        ]}
        pointerEvents="none"
      >
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: "#e2e8f0",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="arrow-undo" size={16} color="#334155" />
        </View>
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View style={rowStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}
