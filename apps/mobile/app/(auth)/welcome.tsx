import { Text, View, Pressable, Image } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 px-7 pt-6 pb-8 justify-between">
        {/* Brand */}
        <View className="items-center">
          <Image
            source={require("../../assets/images/icon.png")}
            style={{ width: 66, height: 66, borderRadius: 16 }}
            resizeMode="contain"
          />
          <Text className="text-ink text-[30px] font-extrabold tracking-tight mt-5">
            Meet Tabcom
          </Text>
          <Text className="text-muted text-[15px] leading-[22px] text-center mt-2">
            For teams, communities, and collaboration.
          </Text>
        </View>

        {/* Hero */}
        <View className="flex-1 items-center justify-center py-4">
          <Image
            source={require("../../assets/images/hero-logo.png")}
            style={{ width: "82%", height: undefined, aspectRatio: 1 }}
            resizeMode="contain"
          />
        </View>

        <Text className="text-muted text-[15px] text-center mb-7">
          Made for teams. Built for everyone.
        </Text>

        {/* Actions */}
        <View className="gap-3">
          <Pressable
            onPress={() => router.push("/(auth)/register" as any)}
            className="flex-row items-center justify-center gap-2.5 bg-ink rounded-full py-[19px] active:opacity-85"
          >
            <Ionicons name="ticket-outline" size={20} color="#fff" />
            <Text className="text-white font-semibold text-[16px]">Join with an invite code</Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/(auth)/guest" as any)}
            className="flex-row items-center justify-center gap-2.5 bg-white border border-border rounded-full py-[19px] active:opacity-70"
          >
            <Ionicons name="person-outline" size={20} color="#0f172a" />
            <Text className="text-ink font-semibold text-[16px]">Continue as a guest</Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/(auth)/sign-in" as any)}
            hitSlop={8}
            className="flex-row items-center justify-center pt-3 active:opacity-60"
          >
            <Text className="text-slate-400 text-[14.5px]">Already have an account? </Text>
            <Text className="text-ink text-[14.5px] font-semibold underline">Sign in</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
