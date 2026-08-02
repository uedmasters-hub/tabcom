/**
 * SwipeableRow — Apple-style swipe-to-delete.
 *
 * Wraps any list row. Swipe left to reveal a red delete button.
 * Full swipe past threshold auto-triggers the action.
 *
 * Uses react-native-gesture-handler + reanimated for 60fps.
 */
import { useCallback, useEffect, useRef } from "react";
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
  // Worklets can't read a plain ref — mirror the width into a shared value.
  const rowWidthShared = useSharedValue(300);
  // Stable handle so runOnJS always has the latest confirmDelete
  // without needing a new function identity each render.
  const confirmDeleteRef = useRef<(() => void) | null>(null);

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

  useEffect(() => {
    confirmDeleteRef.current = confirmDelete;
  });

  // runOnJS needs a STABLE function reference. A closure re-created
  // every render can't be serialised to the UI thread reliably and
  // crashes on Android when the gesture handler initialises.
  const askDelete = useCallback(() => {
    confirmDeleteRef.current?.();
  }, []);

  const pan = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-5, 5])
    .onUpdate((e) => {
      "worklet";
      const x = Math.min(0, Math.max(-rowWidthShared.value, e.translationX));
      translateX.value = x;
    })
    .onEnd(() => {
      "worklet";
      const ratio = Math.abs(translateX.value) / rowWidthShared.value;
      if (ratio > FULL_SWIPE_THRESHOLD) {
        translateX.value = withSpring(-BUTTON_WIDTH - 10, SPRING);
        runOnJS(askDelete)();
      } else if (Math.abs(translateX.value) > BUTTON_WIDTH * 0.4) {
        translateX.value = withSpring(-BUTTON_WIDTH, SPRING);
      } else {
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
    const w = e.nativeEvent.layout.width;
    rowWidth.current = w;
    rowWidthShared.value = w;
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
