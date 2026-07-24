import { View, Pressable, ActivityIndicator } from "react-native";
import { color, radius, size, space } from "@/theme";
import { Action } from "@/theme";

export type ButtonVariant = "primary" | "secondary" | "ghost";

export interface ButtonProps {
  children: string;
  variant?: ButtonVariant;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
}

/** The only button in the app. Every CTA uses this. */
export function Button({
  children, variant = "primary", onPress,
  disabled = false, loading = false, fullWidth = true,
}: ButtonProps) {
  const off = disabled || loading;

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
          backgroundColor: bg,
          borderWidth: variant === "secondary" && !off ? 1.5 : 0,
          borderColor: color.border,
          borderRadius: radius.lg,
          height: size.button,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: fullWidth ? 0 : space.xxxl,
        }}
      >
        {loading ? (
          <ActivityIndicator size={18} color={fg} />
        ) : (
          <Action style={{ color: fg }}>{children}</Action>
        )}
      </View>
    </Pressable>
  );
}
