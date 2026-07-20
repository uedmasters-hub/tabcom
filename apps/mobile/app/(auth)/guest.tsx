import { useState } from "react";
import {
  Text, View, TextInput, Pressable, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Avatar } from "@/components/Avatar";
import { SecondaryHeader } from "@/components/SecondaryHeader";
import { generateGuestUsername } from "@/lib/guest-username";
import { useAuth } from "@/stores/auth";

const AVATAR_COLORS = ["#2563eb", "#7c3aed", "#0d9488", "#e11d48", "#d97706", "#16a34a"];

/**
 * Guest entry — display name only. No username field, no email, no
 * invite code. A unique handle is generated in the background using the
 * same generator as the extension, then the session starts immediately.
 */
export default function GuestSetupScreen() {
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
      // The auth gate in app/_layout.tsx routes to the workspace.
    } catch {
      setError("Couldn't start a guest session — try again.");
      setStarting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <SecondaryHeader title="" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <View className="flex-1 px-7">
          <Text className="text-ink text-[26px] font-extrabold tracking-tight">
            What should people call you?
          </Text>
          <Text className="text-muted text-[15px] leading-[23px] mt-2.5">
            A 30-minute guest session — no email, no account. Your username is
            assigned automatically.
          </Text>

          <View className="items-center mt-9">
            <Avatar name={displayName || "Guest"} color={color} size="xl" />
          </View>

          <Text className="text-muted text-[13px] uppercase font-bold tracking-wide mt-8 mb-2.5">
            Display name
          </Text>
          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Your name"
            placeholderTextColor="#94a3b8"
            autoFocus
            autoComplete="name"
            returnKeyType="go"
            onSubmitEditing={submit}
            className="bg-surface rounded-2xl px-5 py-4 text-ink text-[16px]"
          />
          {error && <Text className="text-red-600 text-[14px] mt-2.5">{error}</Text>}
        </View>

        <View className="px-7 pb-8">
          <Pressable
            onPress={submit}
            disabled={!canSubmit || starting}
            className={`flex-row items-center justify-center gap-2.5 rounded-2xl py-[18px] ${
              canSubmit && !starting ? "bg-primary active:opacity-85" : "bg-slate-200"
            }`}
          >
            {starting ? (
              <>
                <ActivityIndicator size="small" color="#fff" />
                <Text className="text-white font-bold text-[16px]">Starting your session…</Text>
              </>
            ) : (
              <>
                <Text className={`font-bold text-[16px] ${canSubmit ? "text-white" : "text-slate-400"}`}>
                  Start new session
                </Text>
                {canSubmit && <Ionicons name="arrow-forward" size={17} color="#fff" />}
              </>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
