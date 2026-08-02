/**
 * ChatListSkeleton — shimmering placeholder rows for the conversation
 * list, shown while a pull-to-refresh is in flight.
 *
 * It deliberately mirrors the real row geometry (52px avatar, a title
 * bar, a preview bar, a trailing time bar, and the hairline divider) so
 * the swap between skeleton and real content doesn't jump. One shared
 * shimmer value drives every bar — cheaper than per-bar clocks and it
 * keeps the pulse in sync across the list. Rows fade in on a stagger to
 * match the app's "staggered reveal" motion language.
 *
 * All bars are plain Views (no hooks), so the only hooks live in this
 * component's body and there's no Rules-of-Hooks risk.
 */

import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  FadeIn,
} from "react-native-reanimated";
import { avatarSize, motion } from "@/theme";

// Varied widths give the list a natural rhythm instead of a grid of
// identical bars. Title/preview are percentages of the text column.
const ROWS: Array<{ title: `${number}%`; preview: `${number}%` }> = [
  { title: "58%", preview: "80%" },
  { title: "44%", preview: "66%" },
  { title: "62%", preview: "52%" },
  { title: "50%", preview: "74%" },
  { title: "55%", preview: "61%" },
  { title: "40%", preview: "70%" },
];

interface RowProps {
  index: number;
  title: `${number}%`;
  preview: `${number}%`;
  shimmer: { opacity: number };
}

function SkeletonRow({ index, title, preview, shimmer }: RowProps) {
  return (
    <Animated.View
      entering={FadeIn.delay(index * motion.stagger).duration(motion.base)}
      className="flex-row items-center px-5 py-3"
    >
      <View className="mr-4">
        <Animated.View
          style={[shimmer, { width: avatarSize.lg, height: avatarSize.lg }]}
          className="rounded-full bg-slate-200"
        />
      </View>
      <View className="flex-1 border-b border-slate-100 py-2 flex-row items-center">
        <View className="flex-1 mr-3">
          <Animated.View
            style={[shimmer, { width: title, height: 13 }]}
            className="rounded-full bg-slate-200"
          />
          <Animated.View
            style={[shimmer, { width: preview, height: 11 }]}
            className="rounded-full bg-slate-200 mt-2.5"
          />
        </View>
        <Animated.View
          style={[shimmer, { width: 34, height: 10 }]}
          className="rounded-full bg-slate-200"
        />
      </View>
    </Animated.View>
  );
}

export function ChatListSkeleton() {
  // Single shimmer clock shared by every bar.
  const pulse = useSharedValue(0.4);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(0.85, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
  }, []);

  const shimmer = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <View className="pt-1">
      {ROWS.map((r, i) => (
        <SkeletonRow
          key={i}
          index={i}
          title={r.title}
          preview={r.preview}
          shimmer={shimmer as unknown as { opacity: number }}
        />
      ))}
    </View>
  );
}
