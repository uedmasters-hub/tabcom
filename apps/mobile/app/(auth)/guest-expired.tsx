import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "@/components/ui";

export default function GuestExpiredScreen() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 items-center justify-center px-8">
        <View className="w-16 h-16 rounded-full bg-amber-50 items-center justify-center mb-6">
          <Ionicons name="hourglass-outline" size={32} color="#d97706" />
        </View>
        <Text className="text-ink text-[26px] font-extrabold text-center tracking-tight">
          Guest session ended
        </Text>
        <Text className="text-muted text-[15px] leading-[22px] text-center mt-3">
          Your 30-minute guest session expired. All guest data on this device
          has been cleared — the next session starts fresh.
        </Text>

        <View className="w-full mt-10 gap-3">
          <Button onPress={() => router.replace("/(auth)/guest" as any)}>
            Start a new guest session
          </Button>
          <Button
            variant="secondary"
            onPress={() => router.replace("/(auth)/welcome" as any)}
          >
            Back to welcome
          </Button>
        </View>
      </View>
    </SafeAreaView>
  );
}
