import { View, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { color, radius, size, space } from "@/theme";
import { Action } from "@/theme";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "md" | "sm";

export interface ButtonProps {
  children: string;
  variant?: ButtonVariant;
  /** md = standard full-height CTA. sm = compact inline action. */
  size?: ButtonSize;
  /** Optional leading Ionicon. Inherits the label color automatically. */
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
}

/**
 * The only button in the app. Every CTA — primary, secondary, inline,
 * with or without an icon — routes through here so shape (radius.lg),
 * height and color stay identical everywhere. Want pills instead of
 * rounded rectangles app-wide? Change the one `borderRadius` below to
 * `radius.full` and every CTA follows.
 */
export function Button({
  children,
  variant = "primary",
  size: sizeProp = "md",
  icon,
  onPress,
  disabled = false,
  loading = false,
  fullWidth = true,
}: ButtonProps) {
  const off = disabled || loading;
  const sm = sizeProp === "sm";

  const bg = off
    ? color.disabled
    : variant === "primary"
      ? color.ink
      : variant === "secondary"
        ? color.white
        : "transparent";

  const fg = off
    ? color.disabledText
    : variant === "primary"
      ? color.white
      : color.ink;

  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => ({
        alignSelf: fullWidth ? "stretch" : "center",
        opacity: pressed && !off ? 0.85 : 1,
      })}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: space.sm,
          backgroundColor: bg,
          borderWidth: variant === "secondary" && !off ? 1.5 : 0,
          borderColor: color.border,
          borderRadius: radius.full,
          height: sm ? 40 : size.button,
          paddingHorizontal: fullWidth ? space.lg : sm ? space.lg : space.xxxl,
        }}
      >
        {loading ? (
          <ActivityIndicator size={18} color={fg} />
        ) : (
          <>
            {icon ? <Ionicons name={icon} size={sm ? 17 : 19} color={fg} /> : null}
            <Action style={{ color: fg }}>{children}</Action>
          </>
        )}
      </View>
    </Pressable>
  );
}
