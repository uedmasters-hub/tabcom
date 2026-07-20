import { useRef, useState } from "react";
import { Text, View, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { SecondaryHeader } from "@/components/SecondaryHeader";
import { auth } from "@/lib/auth-client";
import { useAuth } from "@/stores/auth";

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
      setError(result.reason === "rate_limited" ? "Too many attempts — wait a minute." : result.reason === "invalid_email" ? "That doesn't look like a valid email." : "Couldn't reach the server.");
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
      <SecondaryHeader title="Sign in" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        <View className="flex-1 px-8">

          {phase === "email" && (
            <>
              <Text className="text-ink text-3xl font-bold mb-2">Sign in</Text>
              <Text className="text-muted mb-8">We'll email you a sign-in link — no password needed.</Text>
              <TextInput value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor="#94a3b8" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoFocus className="border border-border rounded-xl px-4 py-3.5 text-ink text-base mb-4" />
              {error && <Text className="text-danger mb-4">{error}</Text>}
              <Pressable onPress={submit} disabled={busy || !email.trim()} className={`rounded-xl py-4 items-center ${busy || !email.trim() ? "bg-slate-300" : "bg-slate-900 active:opacity-80"}`}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-semibold text-base">Email me a link</Text>}
              </Pressable>
            </>
          )}
          {phase === "waiting" && (
            <View className="flex-1 items-center justify-center -mt-20">
              <ActivityIndicator color="#2563eb" size="large" />
              <Text className="text-ink text-xl font-semibold mt-6 mb-2">Check your email</Text>
              <Text className="text-muted text-center px-4 mb-8">We sent a link to {email.trim()}. Open it on any device.</Text>
              <Pressable onPress={() => { abortRef.current?.abort(); setPhase("email"); }}><Text className="text-muted">Use a different email</Text></Pressable>
            </View>
          )}
          {phase === "expired" && (
            <View className="flex-1 items-center justify-center -mt-20">
              <Text className="text-ink text-xl font-semibold mb-2">Link expired</Text>
              <Text className="text-muted text-center px-4 mb-8">The sign-in request timed out.</Text>
              <Pressable onPress={() => setPhase("email")} className="bg-slate-900 rounded-xl py-4 px-10 active:opacity-80"><Text className="text-white font-semibold">Try again</Text></Pressable>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
