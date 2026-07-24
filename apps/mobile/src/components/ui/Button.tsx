import { Text, View, Pressable, ActivityIndicator } from "react-native";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export interface ButtonProps {
  children: string;
  variant?: ButtonVariant;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
}

export function Button({
  children, variant = "primary", onPress,
  disabled = false, loading = false, fullWidth = true,
}: ButtonProps) {
  const off = disabled || loading;
  const bg = off ? "#e2e8f0"
    : variant === "primary" ? "#0f172a"
    : variant === "secondary" ? "#ffffff" : "transparent";
  const fg = off ? "#94a3b8" : variant === "primary" ? "#ffffff" : "#0f172a";
  const border = variant === "secondary" && !off ? "border border-border" : "";

  return (
    <Pressable onPress={onPress} disabled={off}
      className={`active:opacity-85 ${fullWidth ? "self-stretch" : "self-center px-8"}`}>
      <View style={{ backgroundColor: bg }}
        className={`h-[54px] rounded-[14px] items-center justify-center ${border}`}>
        {loading ? (
          <ActivityIndicator size={18} color={variant === "primary" ? "#fff" : "#0f172a"} />
        ) : (
          <Text style={{ color: fg }} className="text-[16px] font-semibold">{children}</Text>
        )}
      </View>
    </Pressable>
  );
}
