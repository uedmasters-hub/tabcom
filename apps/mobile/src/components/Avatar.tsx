import { View, Text } from "react-native";

/** One avatar scale for the whole app. Contacts, Chats, Communities and
 *  threads all draw from this table so nothing drifts. */
export const AVATAR_SIZES = {
  xs: 32,
  sm: 40,
  md: 48,
  lg: 60,   // list rows: Chats, Communities, Contacts, Discover
  xl: 96,   // Settings profile hero
} as const;

export type AvatarSize = keyof typeof AVATAR_SIZES;

const PRESENCE_COLORS: Record<string, string> = {
  online: "#16a34a",
  away: "#eab308",
  busy: "#ef4444",
};

interface Props {
  name: string;
  color?: string;
  size?: AvatarSize;
  presence?: string;
  /** Communities render the same circle; kept explicit for clarity. */
  square?: boolean;
}

export function Avatar({ name, color = "#2563eb", size = "lg", presence, square }: Props) {
  const px = AVATAR_SIZES[size];
  const dot = presence ? PRESENCE_COLORS[presence] : undefined;
  const dotPx = Math.max(10, Math.round(px * 0.3));
  const fontPx = Math.round(px * 0.4);

  return (
    <View style={{ width: px, height: px }} className="relative">
      <View
        style={{
          width: px,
          height: px,
          backgroundColor: color,
          borderRadius: square ? px * 0.28 : px / 2,
        }}
        className="items-center justify-center"
      >
        <Text style={{ fontSize: fontPx }} className="text-white font-bold">
          {(name || "?").slice(0, 1).toUpperCase()}
        </Text>
      </View>
      {dot && (
        <View
          style={{
            backgroundColor: dot,
            width: dotPx,
            height: dotPx,
            borderRadius: dotPx / 2,
            borderWidth: Math.max(2, Math.round(px * 0.05)),
            position: "absolute",
            bottom: 0,
            right: 0,
          }}
          className="border-white"
        />
      )}
    </View>
  );
}
