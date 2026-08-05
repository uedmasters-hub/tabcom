/**
 * Top app-bar shown while messages are selected (long-press selection
 * mode). Overlays the normal chat header. Shows the selection count and
 * a consistent action set for both incoming and outgoing messages:
 * Reply, Forward, Pin, Delete — plus Privacy, which the caller only
 * enables for a single outgoing media message.
 *
 * Reply and Pin are single-selection actions; Forward and Delete work on
 * any count. React lives in the floating ReactionBar, not here.
 */
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface Props {
  count: number;
  /** Exactly one message selected — enables Reply / Pin. */
  single: boolean;
  /** Single outgoing media message — enables Privacy. */
  canPrivacy: boolean;
  /** The (single) selected message is already pinned. */
  pinned: boolean;
  onClose: () => void;
  onReply: () => void;
  onForward: () => void;
  onPin: () => void;
  onDelete: () => void;
  onPrivacy: () => void;
}

function Action({
  icon,
  label,
  onPress,
  danger,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      className="items-center justify-center px-2.5 active:opacity-50"
    >
      <Ionicons name={icon} size={22} color={danger ? "#dc2626" : "#0f172a"} />
      <Text
        className={`text-[10px] mt-0.5 ${danger ? "text-red-600" : "text-ink"}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function SelectionBar({
  count,
  single,
  canPrivacy,
  pinned,
  onClose,
  onReply,
  onForward,
  onPin,
  onDelete,
  onPrivacy,
}: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 50, paddingTop: insets.top }}
      className="bg-background border-b border-slate-200"
    >
      <View className="flex-row items-center px-3" style={{ height: 56 }}>
        <Pressable onPress={onClose} hitSlop={8} className="pr-2 active:opacity-50">
          <Ionicons name="close" size={28} color="#0f172a" />
        </Pressable>
        <Text className="text-ink text-[18px] font-bold ml-1 flex-1">{count}</Text>

        {single && (
          <Action icon="arrow-undo-outline" label="Reply" onPress={onReply} />
        )}
        <Action icon="arrow-redo-outline" label="Forward" onPress={onForward} />
        {single && (
          <Action
            icon={pinned ? "pin" : "pin-outline"}
            label={pinned ? "Unpin" : "Pin"}
            onPress={onPin}
          />
        )}
        {canPrivacy && (
          <Action icon="lock-closed-outline" label="Privacy" onPress={onPrivacy} />
        )}
        <Action icon="trash-outline" label="Delete" onPress={onDelete} danger />
      </View>
    </View>
  );
}
