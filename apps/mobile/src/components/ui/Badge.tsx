import { Text, View } from "react-native";

type BadgeVariant = "primary" | "success" | "danger" | "muted";
interface BadgeProps { children: string; variant?: BadgeVariant; }

const V: Record<BadgeVariant, { bg: string; text: string }> = {
  primary: { bg: "#2563eb", text: "#ffffff" },
  success: { bg: "#dcfce7", text: "#16a34a" },
  danger: { bg: "#fee2e2", text: "#dc2626" },
  muted: { bg: "#f8fafc", text: "#64748b" },
};

export function Badge({ children, variant = "primary" }: BadgeProps) {
  const { bg, text } = V[variant];
  return (
    <View style={{ backgroundColor: bg }} className="rounded-md px-2.5 py-1">
      <Text style={{ color: text, fontSize: 11, letterSpacing: 0.8 }}
        className="font-bold uppercase">{children}</Text>
    </View>
  );
}
