import { View, Text } from "react-native";
import { avatarSize, color, presenceColor, radius } from "@/theme";

export const AVATAR_SIZES = avatarSize;
export type AvatarSize = keyof typeof avatarSize;

interface Props {
  name: string;
  color?: string;
  size?: AvatarSize;
  presence?: string;
  square?: boolean;
}

export function Avatar({
  name, color: fill = color.primary, size = "lg", presence, square,
}: Props) {
  const px = avatarSize[size];
  const dot = presence ? presenceColor[presence] : undefined;
  const dotPx = Math.max(10, Math.round(px * 0.3));

  return (
    <View style={{ width: px, height: px, position: "relative" }}>
      <View
        style={{
          width: px,
          height: px,
          backgroundColor: fill,
          borderRadius: square ? px * 0.28 : radius.full,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text
          style={{
            fontSize: Math.round(px * 0.4),
            color: color.white,
            fontWeight: "700",
          }}
        >
          {(name || "?").slice(0, 1).toUpperCase()}
        </Text>
      </View>
      {dot && (
        <View
          style={{
            backgroundColor: dot,
            width: dotPx,
            height: dotPx,
            borderRadius: radius.full,
            borderWidth: Math.max(2, Math.round(px * 0.05)),
            borderColor: color.white,
            position: "absolute",
            bottom: 0,
            right: 0,
          }}
        />
      )}
    </View>
  );
}
