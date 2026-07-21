import { View, Text, Pressable, ScrollView } from "react-native";
import Animated, {
  useAnimatedStyle, withSpring, interpolate, Extrapolation,
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
}

/**
 * Floating attachment chips.
 *
 * Deliberately has NO background of its own — each chip is an
 * independently elevated pill sitting on the conversation surface, so
 * the toolbar reads as a separate layer floating above the composer
 * rather than an extension of it.
 *
 * The leading circular control is NOT rendered here: it is the
 * composer's own "+" button, which travels up into this row. See
 * MorphAttachButton.
 */
export function AttachmentBar({ progress, onPick }: Props) {
  const rowStyle = useAnimatedStyle(() => ({
    height: interpolate(progress.value, [0, 1], [0, ATTACH_ROW_H], Extrapolation.CLAMP),
    opacity: interpolate(progress.value, [0, 0.12], [0, 1], Extrapolation.CLAMP),
  }));

  return (
    <Animated.View style={rowStyle} className="overflow-visible">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          // Leave the leading slot empty — the travelling "+" lands there.
          paddingLeft: ATTACH_LEFT + ATTACH_BTN + 8,
          paddingRight: 12,
          alignItems: "center",
          height: ATTACH_ROW_H,
        }}
      >
        {CHIPS.map((chip, i) => (
          <Chip key={chip.id} index={i} progress={progress}>
            <Pressable
              onPress={() => onPick(chip.id)}
              className="flex-row items-center bg-white rounded-full pl-3.5 pr-4 py-2.5 mr-2 active:opacity-70"
              style={{
                shadowColor: "#0f172a",
                shadowOpacity: 0.1,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 3 },
                elevation: 4,
              }}
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
 * Each chip grows out of the trailing edge of the one before it.
 * Windows overlap by design (0.09 stagger against a 0.55 span), so the
 * row reads as one flowing wave rather than six separate reveals.
 */
function Chip({
  index, progress, children,
}: {
  index: number;
  progress: SharedValue<number>;
  children: React.ReactNode;
}) {
  const style = useAnimatedStyle(() => {
    const start = index * 0.09;
    const local = interpolate(progress.value, [start, start + 0.55], [0, 1], Extrapolation.CLAMP);
    return {
      opacity: interpolate(local, [0, 0.45], [0, 1], Extrapolation.CLAMP),
      transform: [
        // Emerges from the left — i.e. from behind the element before it.
        { translateX: (1 - local) * -26 },
        // Slight width expansion as it settles.
        { scaleX: 0.72 + local * 0.28 },
        { scaleY: 0.86 + local * 0.14 },
      ],
    };
  });

  return <Animated.View style={style}>{children}</Animated.View>;
}
