import { Text, View, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

export default function WelcomeScreen() {
  const router = useRouter();
  return (
    <SafeAreaView className="flex-1 bg-ink">
      <View className="flex-1 px-8 justify-between py-12">
        <View className="flex-1 justify-center">
          <Text className="text-white text-4xl font-bold mb-3">Tabcom</Text>
          <Text className="text-neutral-400 text-lg leading-7">
            Chat, calls, and your communities — the mobile side of your
            Tabcom workspace.
          </Text>
        </View>

        <View className="gap-3">
          <Pressable
            onPress={() => router.push("/(auth)/sign-in" as any)}
            className="bg-accent rounded-2xl py-4 items-center active:opacity-80"
          >
            <Text className="text-white font-semibold text-base">Sign in</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/(auth)/register" as any)}
            className="bg-card border border-line rounded-2xl py-4 items-center active:opacity-80"
          >
            <Text className="text-white font-semibold text-base">
              Create account with invite
            </Text>
          </Pressable>
          <Text className="text-neutral-600 text-xs text-center mt-2">
            Tabcom is invite-only. New accounts need an invitation code.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
