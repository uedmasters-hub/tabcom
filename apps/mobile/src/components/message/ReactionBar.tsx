/**
 * Floating quick-reaction pill shown above a long-pressed message.
 * Positioned near the pressed row's Y; tapping an emoji reacts and the
 * caller dismisses selection. Kept deliberately simple — no per-row
 * measurement, just the touch Y handed in from the long-press.
 */
import { Pressable, Text, View } from "react-native";

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

interface Props {
  /** Absolute top (px) to float the pill at, already clamped by caller. */
  top: number;
  onReact: (emoji: string) => void;
}

export function ReactionBar({ top, onReact }: Props) {
  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", top, left: 0, right: 0, zIndex: 40 }}
      className="items-center"
    >
      <View
        className="flex-row items-center bg-slate-900 rounded-full px-2 py-1.5"
        style={{
          shadowColor: "#0f172a",
          shadowOpacity: 0.25,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        }}
      >
        {QUICK_REACTIONS.map((e) => (
          <Pressable
            key={e}
            onPress={() => onReact(e)}
            hitSlop={6}
            className="px-2 py-0.5 active:opacity-50"
          >
            <Text style={{ fontSize: 24 }}>{e}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
