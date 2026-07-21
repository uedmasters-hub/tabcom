import { Pressable } from "react-native";
import Animated, {
  useAnimatedStyle, interpolate, interpolateColor, Extrapolation,
  type SharedValue,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import {
  ATTACH_BTN, ATTACH_LEFT, ATTACH_TRAVEL,
} from "./AttachmentBar";

interface Props {
  progress: SharedValue<number>;
  /** Distance from the wrapper's bottom edge to the button's resting
   *  slot inside the composer. Keeps the anchor exact across devices
   *  with different safe-area insets. */
  restBottom: number;
  onToggle: () => void;
  disabled?: boolean;
}

/**
 * The single physical element behind the whole interaction.
 *
 * There is exactly ONE of these. At rest it sits in the composer's
 * leading slot. On tap it lifts upward into the attachment row's
 * leading position — the same element, continuously trackable, never
 * faded out and re-created somewhere else.
 *
 * The "+" becomes "×" by ROTATION: a plus turned 45° is a cross, so the
 * glyph genuinely transforms rather than being swapped for a different
 * icon. It travels 135° for a fuller turn and lands on the cross.
 *
 * Absolutely positioned so it can overhang both the composer's white
 * surface and the transparent toolbar above it without either layout
 * clipping it.
 */
export function MorphAttachButton({ progress, restBottom, onToggle, disabled }: Props) {
  const containerStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -progress.value * ATTACH_TRAVEL },
      // Barely perceptible lift as it detaches, so the motion reads as
      // the button coming off the surface rather than sliding along it.
      { scale: 1 + interpolate(progress.value, [0, 0.5, 1], [0, 0.06, 0], Extrapolation.CLAMP) },
    ],
  }));

  const surfaceStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      ["rgba(241,245,249,0)", "rgba(241,245,249,1)"]
    ),
    shadowOpacity: interpolate(progress.value, [0, 1], [0, 0.1], Extrapolation.CLAMP),
    elevation: interpolate(progress.value, [0, 1], [0, 4], Extrapolation.CLAMP),
  }));

  const glyphStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${progress.value * 135}deg` }],
  }));

  return (
    <Animated.View
      style={[
        containerStyle,
        {
          position: "absolute",
          left: ATTACH_LEFT,
          bottom: restBottom,
          width: ATTACH_BTN,
          height: ATTACH_BTN,
        },
      ]}
    >
      <Pressable
        onPress={onToggle}
        disabled={disabled}
        hitSlop={8}
        className="flex-1 items-center justify-center active:opacity-60"
      >
        <Animated.View
          style={[
            surfaceStyle,
            {
              width: ATTACH_BTN,
              height: ATTACH_BTN,
              borderRadius: ATTACH_BTN / 2,
              alignItems: "center",
              justifyContent: "center",
              shadowColor: "#0f172a",
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 3 },
            },
          ]}
        >
          <Animated.View style={glyphStyle}>
            <Ionicons name="add" size={28} color="#334155" />
          </Animated.View>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}
