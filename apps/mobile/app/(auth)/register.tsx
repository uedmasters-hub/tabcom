import { useEffect, useState } from "react";
import {
  Text, View, TextInput, Pressable, ActivityIndicator,
  ScrollView, KeyboardAvoidingView, Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { auth } from "@/lib/auth-client";
import { useAuth } from "@/stores/auth";

const AVATAR_COLORS = [
  "#7C6CF6", "#F67C6C", "#6CF6A8", "#F6D06C", "#6CB8F6", "#F66CD9",
];

export default function RegisterScreen() {
  const router = useRouter();
  const signIn = useAuth((s) => s.signIn);

  const [inviteCode, setInviteCode] = useState("");
  const [inviteState, setInviteState] = useState<"idle" | "checking" | "valid" | "invalid">("idle");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [usernameState, setUsernameState] = useState<"idle" | "checking" | "available" | "taken" | "invalid">("idle");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [color, setColor] = useState(AVATAR_COLORS[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const code = inviteCode.trim();
    if (!code) { setInviteState("idle"); return; }
    setInviteState("checking");
    const timer = setTimeout(async () => {
      const result = await auth.checkInvite(code);
      setInviteState(result.ok ? "valid" : "invalid");
    }, 500);
    return () => clearTimeout(timer);
  }, [inviteCode]);

  useEffect(() => {
    const name = username.trim();
    if (!name) { setUsernameState("idle"); setSuggestions([]); return; }
    setUsernameState("checking");
    const timer = setTimeout(async () => {
      const result = await auth.checkUsernameAvailable(name);
      if (result.ok && result.available) {
        setUsernameState("available"); setSuggestions([]);
      } else if (result.ok) {
        setUsernameState("taken"); setSuggestions(result.suggestions);
      } else {
        setUsernameState(result.reason === "invalid_format" ? "invalid" : "idle");
        setSuggestions([]);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [username]);

  const canSubmit =
    inviteState === "valid" &&
    email.trim().length > 3 &&
    usernameState === "available" &&
    displayName.trim().length > 0 &&
    !busy;

  const submit = async () => {
    setBusy(true); setError(null);
    const result = await auth.registerAccount(
      email.trim().toLowerCase(), username.trim(),
      displayName.trim(), color, inviteCode.trim()
    );
    setBusy(false);
    if (result.ok) { await signIn(result.sessionToken, result.user); return; }
    setError(
      result.reason === "invalid_invite" ? "That invite code isn't valid or was already used."
        : result.reason === "username_taken" ? "That username was just taken — pick another."
        : result.reason === "invalid_email" ? "That doesn't look like a valid email."
        : result.reason === "invalid_username" ? "That username isn't allowed."
        : "Couldn't reach the server. Check your connection."
    );
  };

  const hint = (state: string, okText: string, badText: string) => {
    if (state === "checking") return <Text className="text-neutral-500 text-xs mt-1">Checking…</Text>;
    if (state === "valid" || state === "available")
      return <Text className="text-green-400 text-xs mt-1">{okText}</Text>;
    if (state === "invalid" || state === "taken")
      return <Text className="text-red-400 text-xs mt-1">{badText}</Text>;
    return null;
  };

  return (
    <SafeAreaView className="flex-1 bg-ink">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        <ScrollView className="flex-1 px-8" keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} className="mt-4 mb-6">
            <Text className="text-neutral-400 text-base">← Back</Text>
          </Pressable>

          <Text className="text-white text-3xl font-bold mb-2">Create account</Text>
          <Text className="text-neutral-400 mb-8">
            Tabcom is invite-only — start with your invitation code.
          </Text>

          <Text className="text-neutral-500 text-xs uppercase mb-2">Invite code</Text>
          <TextInput value={inviteCode} onChangeText={setInviteCode}
            placeholder="TAB-XXXX-XXXX-XXXX" placeholderTextColor="#5A5A68"
            autoCapitalize="characters" autoCorrect={false}
            className="bg-card border border-line rounded-2xl px-5 py-4 text-white text-base" />
          {hint(inviteState, "Invite code is valid", "This code isn't valid or was used")}

          <Text className="text-neutral-500 text-xs uppercase mb-2 mt-6">Email</Text>
          <TextInput value={email} onChangeText={setEmail}
            placeholder="you@example.com" placeholderTextColor="#5A5A68"
            autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
            className="bg-card border border-line rounded-2xl px-5 py-4 text-white text-base" />

          <Text className="text-neutral-500 text-xs uppercase mb-2 mt-6">Username</Text>
          <TextInput value={username} onChangeText={setUsername}
            placeholder="yourhandle" placeholderTextColor="#5A5A68"
            autoCapitalize="none" autoCorrect={false}
            className="bg-card border border-line rounded-2xl px-5 py-4 text-white text-base" />
          {hint(usernameState, "Username is available",
            usernameState === "invalid" ? "Letters, numbers and dashes only" : "Already taken")}
          {suggestions.length > 0 && (
            <View className="flex-row flex-wrap gap-2 mt-2">
              {suggestions.map((s) => (
                <Pressable key={s} onPress={() => setUsername(s)}
                  className="bg-card border border-line rounded-full px-4 py-2 active:opacity-70">
                  <Text className="text-neutral-300 text-sm">{s}</Text>
                </Pressable>
              ))}
            </View>
          )}

          <Text className="text-neutral-500 text-xs uppercase mb-2 mt-6">Display name</Text>
          <TextInput value={displayName} onChangeText={setDisplayName}
            placeholder="Your Name" placeholderTextColor="#5A5A68"
            className="bg-card border border-line rounded-2xl px-5 py-4 text-white text-base" />

          <Text className="text-neutral-500 text-xs uppercase mb-2 mt-6">Avatar color</Text>
          <View className="flex-row gap-3 mb-6">
            {AVATAR_COLORS.map((c) => (
              <Pressable key={c} onPress={() => setColor(c)}
                style={{ backgroundColor: c }}
                className={`w-10 h-10 rounded-full ${color === c ? "border-2 border-white" : "opacity-60"}`} />
            ))}
          </View>

          {error && <Text className="text-red-400 mb-4">{error}</Text>}

          <Pressable onPress={submit} disabled={!canSubmit}
            className={`rounded-2xl py-4 items-center mb-10 ${
              canSubmit ? "bg-accent active:opacity-80" : "bg-accent/40"
            }`}>
            {busy ? <ActivityIndicator color="#FFFFFF" /> : (
              <Text className="text-white font-semibold text-base">Create account</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
