import { Pressable, ActivityIndicator } from "react-native";
import Animated, {
  useAnimatedStyle, interpolate, interpolateColor, Extrapolation,
  type SharedValue,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import {
  ATTACH_BTN, ATTACH_LEFT, ATTACH_TRAVEL, CHIP_SHADOW,
} from "./AttachmentBar";

interface Props {
  progress: SharedValue<number>;
  /** Distance from the wrapper's bottom edge to the button's resting
   *  slot inside the composer. Keeps the anchor exact across devices
   *  with different safe-area insets. */
  restBottom: number;
  onToggle: () => void;
  disabled?: boolean;
  /** Attachment action in flight — shows a spinner in place of the
   *  glyph (the composer's old spacer slot no longer exists to host it,
   *  since it heals shut). */
  busy?: boolean;
  /** True once the expand spring has settled and the row's real close
   *  chip has taken over. The button stays mounted but becomes
   *  invisible and untouchable at the exact same pixels, so the swap
   *  can never be seen. */
  settled?: boolean;
}

/**
 * The single physical element behind the whole interaction.
 *
 * There is exactly ONE of these. At rest it sits in the composer's
 * leading slot. On tap it lifts upward into the attachment row's
 * leading position — the same element, continuously trackable, never
 * faded out and re-created somewhere else.
 *
 * Surface tension: as it detaches it stretches vertically and narrows
 * (still adhering to the composer), releases just past the first third,
 * and settles round. Because it's driven by progress, the collapse
 * plays the identical deformation in reverse — descend, reform the
 * connection, merge. Restrained on purpose: suggestion, not rubber.
 *
 * The "+" becomes "×" by ROTATION: a plus turned 45° is a cross, so the
 * glyph genuinely transforms rather than being swapped. It travels 135°
 * for a fuller turn and lands on the cross.
 */
export function MorphAttachButton({ progress, restBottom, onToggle, disabled, busy, settled }: Props) {
  const containerStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -progress.value * ATTACH_TRAVEL },
      // Squash & stretch: taller/narrower while pulling free of the
      // composer, a whisper of overshoot, then perfectly round.
      { scaleX: interpolate(progress.value, [0, 0.3, 0.65, 1], [1, 0.9, 1.03, 1], Extrapolation.CLAMP) },
      { scaleY: interpolate(progress.value, [0, 0.3, 0.65, 1], [1, 1.12, 0.97, 1], Extrapolation.CLAMP) },
    ],
  }));

  const surfaceStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      ["rgba(241,245,249,0)", "rgba(241,245,249,1)"]
    ),
    // Fades up to the same soft ambient elevation the chips use.
    shadowOpacity: interpolate(progress.value, [0, 1], [0, CHIP_SHADOW.shadowOpacity], Extrapolation.CLAMP),
    elevation: interpolate(progress.value, [0, 1], [0, CHIP_SHADOW.elevation], Extrapolation.CLAMP),
  }));

  const glyphStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${progress.value * 135}deg` }],
  }));

  return (
    <Animated.View
      pointerEvents={settled ? "none" : "auto"}
      style={[
        containerStyle,
        {
          position: "absolute",
          left: ATTACH_LEFT,
          bottom: restBottom,
          width: ATTACH_BTN,
          height: ATTACH_BTN,
          opacity: settled ? 0 : 1,
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
              shadowColor: CHIP_SHADOW.shadowColor,
              shadowRadius: CHIP_SHADOW.shadowRadius,
              shadowOffset: CHIP_SHADOW.shadowOffset,
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#64748b" />
          ) : (
            <Animated.View style={glyphStyle}>
              <Ionicons name="add" size={28} color="#334155" />
            </Animated.View>
          )}
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}
