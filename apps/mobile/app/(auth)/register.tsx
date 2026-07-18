import { useEffect, useState } from "react";
import { Text, View, TextInput, Pressable, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { auth } from "@/lib/auth-client";
import { useAuth } from "@/stores/auth";

const AVATAR_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#ec4899"];

export default function RegisterScreen() {
  const router = useRouter();
  const signIn = useAuth((s) => s.signIn);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteState, setInviteState] = useState<"idle"|"checking"|"valid"|"invalid">("idle");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [usernameState, setUsernameState] = useState<"idle"|"checking"|"available"|"taken"|"invalid">("idle");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [color, setColor] = useState(AVATAR_COLORS[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { const c = inviteCode.trim(); if (!c) { setInviteState("idle"); return; } setInviteState("checking"); const t = setTimeout(async () => { const r = await auth.checkInvite(c); setInviteState(r.ok ? "valid" : "invalid"); }, 500); return () => clearTimeout(t); }, [inviteCode]);
  useEffect(() => { const n = username.trim(); if (!n) { setUsernameState("idle"); setSuggestions([]); return; } setUsernameState("checking"); const t = setTimeout(async () => { const r = await auth.checkUsernameAvailable(n); if (r.ok && r.available) { setUsernameState("available"); setSuggestions([]); } else if (r.ok) { setUsernameState("taken"); setSuggestions(r.suggestions); } else { setUsernameState(r.reason === "invalid_format" ? "invalid" : "idle"); setSuggestions([]); } }, 500); return () => clearTimeout(t); }, [username]);

  const canSubmit = inviteState === "valid" && email.trim().length > 3 && usernameState === "available" && displayName.trim().length > 0 && !busy;

  const submit = async () => {
    setBusy(true); setError(null);
    const r = await auth.registerAccount(email.trim().toLowerCase(), username.trim(), displayName.trim(), color, inviteCode.trim());
    setBusy(false);
    if (r.ok) { await signIn(r.sessionToken, r.user); return; }
    setError(r.reason === "invalid_invite" ? "That invite code isn't valid." : r.reason === "username_taken" ? "Username just taken." : r.reason === "invalid_email" ? "Invalid email." : r.reason === "invalid_username" ? "Invalid username." : "Server unreachable.");
  };

  const hint = (st: string, ok: string, bad: string) => {
    if (st === "checking") return <Text className="text-muted text-xs mt-1">Checking…</Text>;
    if (st === "valid" || st === "available") return <Text className="text-success text-xs mt-1">{ok}</Text>;
    if (st === "invalid" || st === "taken") return <Text className="text-danger text-xs mt-1">{bad}</Text>;
    return null;
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        <ScrollView className="flex-1 px-8" keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} className="mt-4 mb-6"><Text className="text-muted text-base">← Back</Text></Pressable>
          <Text className="text-ink text-3xl font-bold mb-2">Create account</Text>
          <Text className="text-muted mb-8">Tabcom is invite-only — start with your invitation code.</Text>

          <Text className="text-muted text-xs uppercase mb-2">Invite code</Text>
          <TextInput value={inviteCode} onChangeText={setInviteCode} placeholder="TAB-XXXX-XXXX-XXXX" placeholderTextColor="#94a3b8" autoCapitalize="characters" className="border border-border rounded-xl px-4 py-3.5 text-ink text-base" />
          {hint(inviteState, "Invite code is valid", "Invalid or used")}

          <Text className="text-muted text-xs uppercase mb-2 mt-6">Email</Text>
          <TextInput value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor="#94a3b8" autoCapitalize="none" keyboardType="email-address" className="border border-border rounded-xl px-4 py-3.5 text-ink text-base" />

          <Text className="text-muted text-xs uppercase mb-2 mt-6">Username</Text>
          <TextInput value={username} onChangeText={setUsername} placeholder="yourhandle" placeholderTextColor="#94a3b8" autoCapitalize="none" className="border border-border rounded-xl px-4 py-3.5 text-ink text-base" />
          {hint(usernameState, "Available", usernameState === "invalid" ? "Letters, numbers, dashes only" : "Already taken")}
          {suggestions.length > 0 && (
            <View className="flex-row flex-wrap gap-2 mt-2">
              {suggestions.map((s) => <Pressable key={s} onPress={() => setUsername(s)} className="border border-border rounded-full px-4 py-2"><Text className="text-muted text-sm">{s}</Text></Pressable>)}
            </View>
          )}

          <Text className="text-muted text-xs uppercase mb-2 mt-6">Display name</Text>
          <TextInput value={displayName} onChangeText={setDisplayName} placeholder="Your Name" placeholderTextColor="#94a3b8" className="border border-border rounded-xl px-4 py-3.5 text-ink text-base" />

          <Text className="text-muted text-xs uppercase mb-2 mt-6">Avatar color</Text>
          <View className="flex-row gap-3 mb-6">
            {AVATAR_COLORS.map((c) => <Pressable key={c} onPress={() => setColor(c)} style={{ backgroundColor: c }} className={`w-10 h-10 rounded-full ${color === c ? "border-2 border-slate-900" : "opacity-50"}`} />)}
          </View>

          {error && <Text className="text-danger mb-4">{error}</Text>}
          <Pressable onPress={submit} disabled={!canSubmit} className={`rounded-xl py-4 items-center mb-10 ${canSubmit ? "bg-slate-900 active:opacity-80" : "bg-slate-300"}`}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-semibold text-base">Create account</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
