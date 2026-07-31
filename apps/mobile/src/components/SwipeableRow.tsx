/**
 * SwipeableRow — Apple-style swipe-to-delete.
 *
 * Wraps any list row. Swipe left to reveal a red delete button.
 * Full swipe past threshold auto-triggers the action.
 *
 * Uses react-native-gesture-handler + reanimated for 60fps.
 */
import { useRef } from "react";
import { View, Text, Pressable, Alert, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { alert } from "@/lib/alert";

const BUTTON_WIDTH = 80;
const FULL_SWIPE_THRESHOLD = 0.4; // 40% of row width → auto-delete
const SPRING = { damping: 20, stiffness: 200, overshootClamping: true };

interface Props {
  children: React.ReactNode;
  /** Called when the user confirms deletion. */
  onDelete: () => void;
  /** Optional confirmation dialog. If omitted, deletes immediately. */
  confirmTitle?: string;
  confirmMessage?: string;
}

export function SwipeableRow({
  children,
  onDelete,
  confirmTitle = "Delete",
  confirmMessage = "Are you sure you want to delete this?",
}: Props) {
  const translateX = useSharedValue(0);
  const rowWidth = useRef(300);

  const confirmDelete = () => {
    alert(confirmTitle, confirmMessage, [
      { text: "Cancel", style: "cancel", onPress: () => close() },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          // Animate out, then delete
          translateX.value = withTiming(-rowWidth.current, { duration: 200 });
          setTimeout(onDelete, 220);
        },
      },
    ]);
  };

  const close = () => {
    translateX.value = withSpring(0, SPRING);
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-5, 5])
    .onUpdate((e) => {
      // Only allow left swipe (negative), clamp to row width
      const x = Math.min(0, Math.max(-rowWidth.current, e.translationX));
      translateX.value = x;
    })
    .onEnd((e) => {
      const ratio = Math.abs(translateX.value) / rowWidth.current;
      if (ratio > FULL_SWIPE_THRESHOLD) {
        // Full swipe — trigger delete
        translateX.value = withSpring(-BUTTON_WIDTH - 10, SPRING);
        runOnJS(confirmDelete)();
      } else if (Math.abs(translateX.value) > BUTTON_WIDTH * 0.4) {
        // Partial swipe — snap to button reveal
        translateX.value = withSpring(-BUTTON_WIDTH, SPRING);
      } else {
        // Too small — snap back
        translateX.value = withSpring(0, SPRING);
      }
    });

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const deleteStyle = useAnimatedStyle(() => {
    const width = interpolate(
      -translateX.value,
      [0, BUTTON_WIDTH],
      [0, BUTTON_WIDTH],
      Extrapolation.CLAMP,
    );
    const opacity = interpolate(
      -translateX.value,
      [0, BUTTON_WIDTH * 0.3],
      [0, 1],
      Extrapolation.CLAMP,
    );
    return { width, opacity };
  });

  const onLayout = (e: LayoutChangeEvent) => {
    rowWidth.current = e.nativeEvent.layout.width;
  };

  return (
    <View
      onLayout={onLayout}
      style={{ overflow: "hidden", backgroundColor: "#ef4444" }}
    >
      {/* Delete action behind the row */}
      <Animated.View
        style={[
          deleteStyle,
          {
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            justifyContent: "center",
            alignItems: "center",
          },
        ]}
      >
        <Pressable
          onPress={confirmDelete}
          style={{
            width: BUTTON_WIDTH,
            height: "100%",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <Ionicons name="trash" size={24} color="#fff" />
        </Pressable>
      </Animated.View>

      {/* Foreground row */}
      <GestureDetector gesture={pan}>
        <Animated.View style={[rowStyle, { backgroundColor: "#ffffff" }]}>
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
