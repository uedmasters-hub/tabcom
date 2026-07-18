import { Text, View, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

export default function WelcomeScreen() {
  const router = useRouter();
  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 px-8 justify-between py-12">
        <View className="flex-1 justify-center">
          <Text className="text-ink text-4xl font-bold mb-3">Tabcom</Text>
          <Text className="text-muted text-lg leading-7">
            Chat, calls, and your communities — the mobile side of your Tabcom workspace.
          </Text>
        </View>
        <View className="gap-3">
          <Pressable onPress={() => router.push("/(auth)/sign-in" as any)} className="bg-slate-900 rounded-xl py-4 items-center active:opacity-80">
            <Text className="text-white font-semibold text-base">Sign in</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/(auth)/register" as any)} className="border border-border rounded-xl py-4 items-center active:opacity-80">
            <Text className="text-ink font-semibold text-base">Create account with invite</Text>
          </Pressable>
          <Text className="text-slate-400 text-xs text-center mt-2">
            Tabcom is invite-only. New accounts need an invitation code.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
