import { View, Pressable, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { usePendingCount } from "@/hooks/useConnections";
import { color, space, radius, size, type } from "@/theme";
import { ScreenTitle, Micro } from "@/theme";

interface Props {
  title: string;
  onAdd?: () => void;
  search?: string;
  onSearch?: (q: string) => void;
  searchPlaceholder?: string;
}

/** Global screen header for tab screens. All geometry from tokens. */
export function ScreenHeader({ title, onAdd, search, onSearch, searchPlaceholder }: Props) {
  const router = useRouter();
  const pending = usePendingCount();

  return (
    <SafeAreaView edges={["top"]} style={{ backgroundColor: color.background }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: space.screen,
          paddingTop: space.xs,
          paddingBottom: space.md,
        }}
      >
        <ScreenTitle style={{ flex: 1 }}>{title}</ScreenTitle>

        {onAdd && (
          <Pressable
            onPress={onAdd}
            style={{
              width: size.iconButton,
              height: size.iconButton,
              borderRadius: radius.full,
              backgroundColor: color.surface,
              alignItems: "center",
              justifyContent: "center",
              marginRight: space.sm,
            }}
          >
            <Ionicons name="add" size={size.iconLg} color={color.ink} />
          </Pressable>
        )}

        <Pressable
          onPress={() => router.push("/notifications" as any)}
          style={{
            width: size.iconButton,
            height: size.iconButton,
            borderRadius: radius.full,
            backgroundColor: color.surface,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="notifications-outline" size={size.icon} color={color.ink} />
          {pending > 0 && (
            <View
              style={{
                position: "absolute",
                top: -2,
                right: -2,
                backgroundColor: color.primary,
                borderRadius: radius.full,
                minWidth: 20,
                height: 20,
                paddingHorizontal: space.xs,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 2,
                borderColor: color.white,
              }}
            >
              <Micro>{String(pending)}</Micro>
            </View>
          )}
        </Pressable>
      </View>

      {onSearch && (
        <View style={{ paddingHorizontal: space.screen, paddingBottom: space.md }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: color.surface,
              borderRadius: radius.xl,
              paddingHorizontal: space.lg,
            }}
          >
            <Ionicons
              name="search"
              size={size.icon}
              color={color.subtle}
              style={{ marginRight: space.sm }}
            />
            <TextInput
              value={search}
              onChangeText={onSearch}
              placeholder={searchPlaceholder ?? "Search"}
              placeholderTextColor={color.subtle}
              style={{
                flex: 1,
                paddingVertical: space.md,
                color: color.ink,
                fontSize: type.input.fontSize,
              }}
            />
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}
