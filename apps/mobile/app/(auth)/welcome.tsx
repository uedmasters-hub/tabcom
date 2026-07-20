import { Text, View, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Avatar } from "@/components/Avatar";

/**
 * Onboarding entry — mirrors the extension's WelcomeScreen exactly.
 * Two paths only: invite code, or guest. No email is requested here on
 * either route; the guest path never asks for one at all.
 */
export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 px-7 justify-between py-10">
        <View className="flex-1 items-center justify-center">
          <Avatar name="Tabcom" color="#2563eb" size="xl" />
          <Text className="text-ink text-[28px] font-extrabold tracking-tight mt-6">
            Start your journey
          </Text>
          <Text className="text-muted text-[16px] leading-[24px] text-center mt-2.5 px-4">
            with Tabcom — a new era of browser-first communication.
          </Text>
        </View>

        <View className="gap-3">
          <Pressable
            onPress={() => router.push("/(auth)/register" as any)}
            className="flex-row items-center justify-center gap-2.5 bg-primary rounded-2xl py-4.5 py-[18px] active:opacity-85"
          >
            <Ionicons name="ticket-outline" size={19} color="#fff" />
            <Text className="text-white font-bold text-[16px]">Join with an invite code</Text>
            <Ionicons name="arrow-forward" size={17} color="#fff" />
          </Pressable>

          <Pressable
            onPress={() => router.push("/(auth)/guest" as any)}
            className="flex-row items-center justify-center gap-2.5 bg-white border border-slate-200 rounded-2xl py-[18px] active:opacity-70"
          >
            <Ionicons name="person-outline" size={19} color="#0f172a" />
            <Text className="text-ink font-bold text-[16px]">Continue as guest</Text>
          </Pressable>

          <Text className="text-slate-400 text-[13px] text-center mt-2 leading-5">
            Tabcom is invite-only. Guests get a 30-minute session — no email, no account.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
