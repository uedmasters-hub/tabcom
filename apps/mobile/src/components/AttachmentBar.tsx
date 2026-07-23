import { useRef } from "react";
import { Text, Pressable, ScrollView } from "react-native";
import Animated, {
  useAnimatedStyle, interpolate, Extrapolation,
  type SharedValue,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";

export type AttachmentAction =
  | "camera-photo"
  | "camera-video"
  | "library"
  | "document"
  | "location"
  | "contact";

/** Geometry shared with the composer so the button can travel exactly
 *  between the two anchor points without magic numbers drifting apart. */
export const ATTACH_BTN = 44;
export const ATTACH_ROW_H = 52;
export const ATTACH_GAP = 10;
export const ATTACH_LEFT = 12;
/** Vertical distance the button travels when detaching. */
export const ATTACH_TRAVEL = ATTACH_ROW_H + ATTACH_GAP;

/**
 * Spring with overshoot clamped: organic acceleration and settle, but
 * no bounce — matching the motion language established elsewhere.
 * Settles in ~400ms.
 */
export const ATTACH_SPRING = {
  damping: 20,
  stiffness: 200,
  mass: 0.9,
  overshootClamping: true,
} as const;

/**
 * One elevation for every floating element in this interaction.
 * Deliberately soft — iOS/M3-style ambient depth, not hard contrast.
 */
export const CHIP_SHADOW = {
  shadowColor: "#0f172a",
  shadowOpacity: 0.06,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;

/** The row's height fully resolves in this first slice of the spring,
 *  BEFORE any chip becomes visible — so no row ever appears to slide
 *  out from behind the composer. Only the button moves vertically. */
const ROW_RESOLVE = 0.18;

const CHIPS: Array<{
  id: AttachmentAction;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}> = [
  { id: "camera-photo", icon: "camera-outline", label: "Camera" },
  { id: "camera-video", icon: "videocam-outline", label: "Video" },
  { id: "library", icon: "image-outline", label: "Images" },
  { id: "document", icon: "document-outline", label: "Files" },
  { id: "location", icon: "location-outline", label: "Location" },
  { id: "contact", icon: "person-outline", label: "Contacts" },
];

interface Props {
  /** 0 = folded into the composer, 1 = fully expanded. */
  progress: SharedValue<number>;
  onPick: (action: AttachmentAction) => void;
  /** True once the expand spring has fully settled. The close control
   *  is then rendered as the row's real first chip, and the travelling
   *  button (which cannot scroll) hands over invisibly. */
  settled: boolean;
  onClose: () => void;
}

/**
 * Floating attachment chips.
 *
 * Deliberately has NO background of its own — each chip is an
 * independently elevated pill sitting on the conversation surface, so
 * the toolbar reads as a separate layer floating above the composer
 * rather than an extension of it.
 *
 * While animating, the leading circular control is the composer's own
 * "+" travelling up into this row (see MorphAttachButton). Once the
 * spring settles, an identical close chip takes its place INSIDE the
 * ScrollView so it scrolls as one continuous row with the others.
 */
export function AttachmentBar({ progress, onPick, settled, onClose }: Props) {
  const scrollRef = useRef<ScrollView>(null);

  const rowStyle = useAnimatedStyle(() => ({
    height: interpolate(progress.value, [0, ROW_RESOLVE], [0, ATTACH_ROW_H], Extrapolation.CLAMP),
    opacity: interpolate(progress.value, [0, ROW_RESOLVE * 0.6], [0, 1], Extrapolation.CLAMP),
  }));

  const handleClose = () => {
    // Snap home first so the travelling button reappears at exactly the
    // close chip's position — making the reverse handover invisible.
    scrollRef.current?.scrollTo({ x: 0, animated: false });
    onClose();
  };

  return (
    <Animated.View style={rowStyle} className="overflow-visible">
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          // While animating, leave the leading slot empty — the
          // travelling "+" occupies it. Once settled, the close chip
          // fills exactly that slot (ATTACH_BTN + 8 = its width+margin).
          paddingLeft: settled ? ATTACH_LEFT : ATTACH_LEFT + ATTACH_BTN + 8,
          paddingRight: 12,
          alignItems: "center",
          height: ATTACH_ROW_H,
        }}
      >
        {settled && (
          <Pressable
            onPress={handleClose}
            className="active:opacity-70"
            style={[
              CHIP_SHADOW,
              {
                width: ATTACH_BTN,
                height: ATTACH_BTN,
                borderRadius: ATTACH_BTN / 2,
                backgroundColor: "#f1f5f9",
                alignItems: "center",
                justifyContent: "center",
                marginRight: 8,
              },
            ]}
          >
            {/* Same glyph, same 135° rotation as the settled travelling
                button — pixel-identical at the moment of handover. */}
            <Ionicons
              name="add"
              size={28}
              color="#334155"
              style={{ transform: [{ rotate: "135deg" }] }}
            />
          </Pressable>
        )}

        {CHIPS.map((chip, i) => (
          <Chip key={chip.id} index={i} progress={progress}>
            <Pressable
              onPress={() => onPick(chip.id)}
              className="flex-row items-center bg-white rounded-full pl-3.5 pr-4 py-2.5 mr-2 active:opacity-70"
              style={CHIP_SHADOW}
            >
              <Ionicons name={chip.icon} size={19} color="#0f172a" />
              <Text className="text-ink font-semibold text-[15px] ml-2">{chip.label}</Text>
            </Pressable>
          </Chip>
        ))}
      </ScrollView>
    </Animated.View>
  );
}

/**
 * Each chip grows PURELY HORIZONTALLY out of the trailing edge of the
 * element before it — the first one out of the detached button itself.
 * No Y motion anywhere: vertical movement belongs to the button alone.
 * Reveal windows begin only after the row height has resolved.
 */
function Chip({
  index, progress, children,
}: {
  index: number;
  progress: SharedValue<number>;
  children: React.ReactNode;
}) {
  const style = useAnimatedStyle(() => {
    const start = ROW_RESOLVE + index * 0.09;
    const local = interpolate(progress.value, [start, start + 0.5], [0, 1], Extrapolation.CLAMP);
    return {
      opacity: interpolate(local, [0, 0.45], [0, 1], Extrapolation.CLAMP),
      transform: [
        { translateX: (1 - local) * -26 },
        { scaleX: 0.72 + local * 0.28 },
      ],
    };
  });

  return <Animated.View style={style}>{children}</Animated.View>;
}
