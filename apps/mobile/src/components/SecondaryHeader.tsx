import { View, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { color, space, radius, size } from "@/theme";
import { SectionTitle, Caption } from "@/theme";

interface Props {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}

/** Header for detail/push screens. All geometry from tokens. */
export function SecondaryHeader({ title, subtitle, onBack, right }: Props) {
  const router = useRouter();
  return (
    <SafeAreaView edges={["top"]} style={{ backgroundColor: color.background }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: space.lg,
          paddingTop: space.xs,
          paddingBottom: space.md,
        }}
      >
        <Pressable
          onPress={onBack ?? (() => router.back())}
          hitSlop={10}
          style={{
            width: size.iconButton,
            height: size.iconButton,
            borderRadius: radius.full,
            backgroundColor: color.surface,
            alignItems: "center",
            justifyContent: "center",
            marginRight: space.md,
          }}
        >
          <Ionicons name="chevron-back" size={size.iconLg} color={color.ink} />
        </Pressable>

        <View style={{ flex: 1 }}>
          <SectionTitle numberOfLines={1}>{title}</SectionTitle>
          {subtitle ? (
            <Caption numberOfLines={1} style={{ marginTop: space.xxs }}>
              {subtitle}
            </Caption>
          ) : null}
        </View>

        {right}
      </View>
    </SafeAreaView>
  );
}
