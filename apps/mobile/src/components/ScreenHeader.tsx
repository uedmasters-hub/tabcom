import { Text, View, Pressable, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { usePendingCount } from "@/hooks/useConnections";

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
  const pending = usePendingCount();

  return (
    <SafeAreaView edges={["top"]} className="bg-background">
      <View className="flex-row items-center px-5 pt-1 pb-3">
        <Text className="flex-1 text-ink font-extrabold text-[32px]">{title}</Text>
        {onAdd && (
          <Pressable onPress={onAdd} className="w-12 h-12 rounded-full bg-surface items-center justify-center mr-2.5 active:opacity-60">
            <Ionicons name="add" size={26} color="#0f172a" />
          </Pressable>
        )}
        <Pressable onPress={() => router.push("/notifications" as any)} className="w-12 h-12 rounded-full bg-surface items-center justify-center active:opacity-60">
          <Ionicons name="notifications-outline" size={22} color="#0f172a" />
          {pending > 0 && (
            <View className="absolute -top-0.5 -right-0.5 bg-primary rounded-full min-w-[20px] h-[20px] px-1 items-center justify-center border-2 border-white">
              <Text className="text-white text-[10px] font-bold">{pending}</Text>
            </View>
          )}
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
