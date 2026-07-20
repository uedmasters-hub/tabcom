import { Text, View, Pressable, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/stores/auth";

interface Props {
  title: string;
  onAdd?: () => void;
  search?: string;
  onSearch?: (q: string) => void;
  searchPlaceholder?: string;
}

/** Global screen header: avatar · bold title · (+) · bell, plus search.
 *  Matches the design shell used across Chat / Communities / Contacts. */
export function ScreenHeader({ title, onAdd, search, onSearch, searchPlaceholder }: Props) {
  const router = useRouter();
  const user = useAuth((s) => s.user);

  return (
    <SafeAreaView edges={["top"]} className="bg-background">
      <View className="flex-row items-center px-5 pt-2 pb-3">
        <View
          style={{ backgroundColor: user?.avatarColor ?? "#2563eb" }}
          className="w-12 h-12 rounded-full items-center justify-center mr-3.5"
        >
          <Text className="text-white font-bold text-lg">
            {(user?.displayName ?? "?").slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <Text className="flex-1 text-ink font-extrabold text-[30px]">{title}</Text>
        {onAdd && (
          <Pressable onPress={onAdd} className="w-12 h-12 rounded-full bg-surface items-center justify-center mr-2.5 active:opacity-60">
            <Ionicons name="add" size={26} color="#0f172a" />
          </Pressable>
        )}
        <Pressable onPress={() => router.push("/notifications" as any)} className="w-12 h-12 rounded-full bg-surface items-center justify-center active:opacity-60">
          <Ionicons name="notifications-outline" size={22} color="#0f172a" />
        </Pressable>
      </View>
      {onSearch && (
        <View className="px-5 pb-3">
          <View className="flex-row items-center bg-surface rounded-2xl px-4">
            <Ionicons name="search" size={19} color="#94a3b8" style={{ marginRight: 8 }} />
            <TextInput
              value={search}
              onChangeText={onSearch}
              placeholder={searchPlaceholder ?? "Search"}
              placeholderTextColor="#94a3b8"
              className="flex-1 py-3.5 text-ink text-[16px]"
            />
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}
