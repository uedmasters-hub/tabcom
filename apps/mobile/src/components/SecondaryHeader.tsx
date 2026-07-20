import { Text, View, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

interface Props {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}

/** Shared header for secondary/detail screens. Matches ScreenHeader's
 *  weight and spacing so sub-pages don't feel like a different app. */
export function SecondaryHeader({ title, subtitle, onBack, right }: Props) {
  const router = useRouter();
  return (
    <SafeAreaView edges={["top"]} className="bg-background">
      <View className="flex-row items-center px-4 pt-1 pb-3">
        <Pressable
          onPress={onBack ?? (() => router.back())}
          hitSlop={10}
          className="w-11 h-11 rounded-full bg-surface items-center justify-center mr-3 active:opacity-60"
        >
          <Ionicons name="chevron-back" size={23} color="#0f172a" />
        </Pressable>
        <View className="flex-1">
          <Text className="text-ink font-extrabold text-[24px]" numberOfLines={1}>{title}</Text>
          {subtitle ? (
            <Text className="text-muted text-[14px] mt-0.5" numberOfLines={1}>{subtitle}</Text>
          ) : null}
        </View>
        {right}
      </View>
    </SafeAreaView>
  );
}
