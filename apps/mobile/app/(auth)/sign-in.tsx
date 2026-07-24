import { useRef, useState } from "react";
import {
  Text, View, Pressable, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { auth } from "@/lib/auth-client";
import { useAuth } from "@/stores/auth";
import { FormField, Button } from "@/components/ui";

type Phase = "email" | "waiting" | "expired";

export default function SignInScreen() {
  const router = useRouter();
  const signIn = useAuth((s) => s.signIn);
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>("email");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const submit = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setBusy(true); setError(null);
    const result = await auth.requestMagicLink(trimmed);
    setBusy(false);
    if (!result.ok || !result.pollId) {
      setError(
        result.reason === "rate_limited" ? "Too many attempts \u2014 wait a minute."
        : result.reason === "invalid_email" ? "That doesn\u2019t look like a valid email."
        : "Couldn\u2019t reach the server."
      );
      return;
    }
    setPhase("waiting");
    abortRef.current = new AbortController();
    const login = await auth.waitForLogin(result.pollId, { signal: abortRef.current.signal });
    if (login) await signIn(login.sessionToken, login.user);
    else if (!abortRef.current.signal.aborted) setPhase("expired");
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
        {phase === "email" && (
          <View className="flex-1 px-6 pt-4">
            <Text className="text-ink text-[30px] font-extrabold tracking-tight mb-2">
              Sign in
            </Text>
            <Text className="text-muted text-[15px] leading-[22px] mb-8">
              We'll email you a sign-in link — no password needed.
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
              status={
                error && error.includes("email") ? "invalid"
                : error ? "invalid" : "idle"
              }
              hint={error ?? undefined}
            />

            <Button onPress={submit} disabled={busy || !email.trim()} loading={busy}>
              Email me a link
            </Button>
          </View>
        )}

        {phase === "waiting" && (
          <View className="flex-1 items-center justify-center px-6 -mt-16">
            <ActivityIndicator color="#2563eb" size="large" />
            <Text className="text-ink text-[22px] font-extrabold mt-6 mb-2">
              Check your email
            </Text>
            <Text className="text-muted text-[15px] leading-[22px] text-center px-4 mb-8">
              We sent a link to {email.trim()}. Open it on any device.
            </Text>
            <Pressable
              onPress={() => { abortRef.current?.abort(); setPhase("email"); }}
              className="active:opacity-60"
            >
              <Text className="text-muted text-[15px]">Use a different email</Text>
            </Pressable>
          </View>
        )}

        {phase === "expired" && (
          <View className="flex-1 items-center justify-center px-6 -mt-16">
            <Text className="text-ink text-[22px] font-extrabold mb-2">
              Link expired
            </Text>
            <Text className="text-muted text-[15px] leading-[22px] text-center px-4 mb-8">
              The sign-in request timed out.
            </Text>
            <Button onPress={() => setPhase("email")} fullWidth={false}>
              Try again
            </Button>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
