import { View, Text, Pressable, ScrollView } from "react-native";

const GROUPS: Array<{ label: string; emojis: string[] }> = [
  { label: "Smileys", emojis: ["😀","😃","😄","😁","😆","😅","🤣","😂","🙂","😉","😊","😇","🥰","😍","😘","😗","😋","😜","🤪","🤗","🤔","🤨","😐","😴","😪","😷","🤒","🥳","🥺","😢","😭","😤","😡","🤯","😳","🥵","🥶"] },
  { label: "Gestures", emojis: ["👍","👎","👌","✌️","🤞","🤟","🤘","👏","🙌","🙏","💪","👋","🤝","☝️","👉","👈","✋","🖐️"] },
  { label: "Hearts", emojis: ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","💔","❣️","💕","💞","💯","✨","🔥","⭐","🎉","🎊"] },
  { label: "Objects", emojis: ["📌","📎","📷","🎥","🎤","📁","📍","🔗","💬","📞","⏰","✅","❌","⚠️","💡","🚀","☕","🍕"] },
];

interface Props { onSelect: (emoji: string) => void; }

/** Lightweight emoji panel for the composer. Deliberately not a native
 *  dependency — a curated set covers the common cases without adding
 *  another module to the build. */
export function EmojiPicker({ onSelect }: Props) {
  return (
    <View className="h-56 bg-surface border-t border-slate-200">
      <ScrollView contentContainerStyle={{ padding: 12 }}>
        {GROUPS.map((group) => (
          <View key={group.label} className="mb-3">
            <Text className="text-muted text-[12px] font-bold uppercase tracking-wide mb-2">
              {group.label}
            </Text>
            <View className="flex-row flex-wrap">
              {group.emojis.map((e) => (
                <Pressable
                  key={e}
                  onPress={() => onSelect(e)}
                  className="w-[11.1%] items-center py-1.5 active:opacity-50"
                >
                  <Text className="text-[26px]">{e}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
