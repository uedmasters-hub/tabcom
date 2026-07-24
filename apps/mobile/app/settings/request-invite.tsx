import { useState } from "react";
import {
  Text, View, Pressable, TextInput,
  KeyboardAvoidingView, Platform, Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "@/components/ui";
import { FormField } from "@/components/ui";
import { useAuth } from "@/stores/auth";
import { REALTIME_URL } from "@/lib/config";

export default function RequestInviteScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSubmit = emailValid && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await fetch(REALTIME_URL + "/invite-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          displayName: user?.displayName ?? "Guest",
          reason: reason.trim() || undefined,
        }),
      });
      setSubmitted(true);
    } catch {
      Alert.alert("Error", "Couldn't send your request. Please try again.");
    }
    setSubmitting(false);
  };

  if (submitted) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <View className="flex-1 items-center justify-center px-8">
          <View className="w-16 h-16 rounded-full bg-success/10 items-center justify-center mb-6">
            <Ionicons name="checkmark-circle" size={40} color="#16a34a" />
          </View>
          <Text className="text-ink text-[24px] font-extrabold text-center tracking-tight">
            Request sent
          </Text>
          <Text className="text-muted text-[15px] leading-[22px] text-center mt-3 px-4">
            We'll review your request and send an invite code to {email.trim()} once approved.
          </Text>
          <View className="w-full mt-10">
            <Button onPress={() => router.back()}>Done</Button>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <Pressable
        onPress={() => router.back()}
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
            Request an invite
          </Text>
          <Text className="text-muted text-[15px] leading-[22px] mt-2 mb-8">
            Enter your email and we'll send you an invite code when a spot opens up.
          </Text>

          <FormField
            label="Email"
            placeholder="name@example.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            autoFocusOnMount
            status={email.trim().length > 3 ? (emailValid ? "valid" : "invalid") : "idle"}
            hint={email.trim().length > 3 && !emailValid ? "Enter a valid email." : undefined}
          />

          <View className="mb-5">
            <Text className="text-[13px] font-medium text-muted mb-1.5">
              Why do you want to join? (optional)
            </Text>
            <View className="border-[1.5px] border-border rounded-xl bg-white px-4 py-3">
              <TextInput
                value={reason}
                onChangeText={setReason}
                placeholder="Tell us a bit about yourself..."
                placeholderTextColor="#94a3b8"
                multiline
                numberOfLines={3}
                className="text-[15px] text-ink"
                style={{ minHeight: 72, textAlignVertical: "top" }}
              />
            </View>
          </View>
        </View>

        <View className="px-6 pb-6">
          <Button onPress={submit} disabled={!canSubmit} loading={submitting}>
            Send request
          </Button>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
