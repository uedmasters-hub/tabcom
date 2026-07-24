import { useState } from "react";
import {
  Text, View, Pressable, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Avatar } from "@/components/Avatar";
import { FormField, Button } from "@/components/ui";
import { generateGuestUsername } from "@/lib/guest-username";
import { useAuth } from "@/stores/auth";

const AVATAR_COLORS = ["#2563eb", "#7c3aed", "#0d9488", "#e11d48", "#d97706", "#16a34a"];

export default function GuestSetupScreen() {
  const router = useRouter();
  const startGuestSession = useAuth((s) => s.startGuestSession);
  const [displayName, setDisplayName] = useState("");
  const [color] = useState(() => AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = displayName.trim().length >= 2;

  const submit = async () => {
    if (!canSubmit || starting) return;
    setStarting(true);
    setError(null);
    try {
      const username = await generateGuestUsername();
      await startGuestSession(displayName.trim(), username, color);
    } catch {
      setError("Couldn\u2019t start a guest session \u2014 try again.");
      setStarting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      {/* Back */}
      <Pressable
        onPress={() => router.back()}
        hitSlop={10}
        className="flex-row items-center gap-1 self-start px-5 pt-3 pb-1 active:opacity-60"
      >
        <Ionicons name="chevron-back" size={20} color="#0f172a" />
        <Text className="text-ink text-[16px] font-medium">Back</Text>
      </Pressable>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <View className="flex-1 px-6 pt-4">
          <Text className="text-ink text-[30px] font-extrabold tracking-tight">
            What should people call you?
          </Text>
          <Text className="text-muted text-[15px] leading-[22px] mt-2">
            A 30-minute guest session — no email, no account. Your username is
            assigned automatically.
          </Text>

          <View className="items-center mt-8 mb-2">
            <Avatar name={displayName || "Guest"} color={color} size="xl" />
          </View>

          <FormField
            label="Display name"
            placeholder="Your name"
            value={displayName}
            onChangeText={setDisplayName}
            autoComplete="name"
            returnKeyType="go"
            onSubmitEditing={submit}
            autoFocusOnMount
            status={
              displayName.trim().length > 0 && displayName.trim().length < 2
                ? "invalid" : "idle"
            }
            hint={
              displayName.trim().length > 0 && displayName.trim().length < 2
                ? "At least 2 characters." : undefined
            }
          />

          {error && (
            <View className="flex-row items-center gap-2 bg-red-50 rounded-xl p-3.5 mb-4">
              <Ionicons name="alert-circle" size={18} color="#dc2626" />
              <Text className="flex-1 text-[13px] text-danger leading-[18px]">{error}</Text>
            </View>
          )}
        </View>

        {/* CTA pinned to bottom — above keyboard */}
        <View className="px-6 pb-8 pt-2">
          <Button onPress={submit} disabled={!canSubmit} loading={starting}>
            {starting ? "Starting session\u2026" : "Start new session"}
          </Button>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
