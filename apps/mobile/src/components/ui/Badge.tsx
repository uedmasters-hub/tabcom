import { View } from "react-native";
import { color, radius, space } from "@/theme";
import { Micro } from "@/theme";

type BadgeVariant = "primary" | "success" | "danger" | "muted";

interface BadgeProps {
  children: string;
  variant?: BadgeVariant;
}

const V: Record<BadgeVariant, { bg: string; tone: "white" | "success" | "danger" | "muted" }> = {
  primary: { bg: color.primary, tone: "white" },
  success: { bg: color.successWash, tone: "success" },
  danger: { bg: color.dangerWash, tone: "danger" },
  muted: { bg: color.surface, tone: "muted" },
};

export function Badge({ children, variant = "primary" }: BadgeProps) {
  const { bg, tone } = V[variant];
  return (
    <View
      style={{
        backgroundColor: bg,
        borderRadius: radius.sm,
        paddingHorizontal: space.sm,
        paddingVertical: space.xs,
      }}
    >
      <Micro tone={tone}>{children}</Micro>
    </View>
  );
}
