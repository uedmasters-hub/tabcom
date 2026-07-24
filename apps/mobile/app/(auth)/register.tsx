import { useCallback, useEffect, useRef, useState } from "react";
import {
  Text, View, Pressable, ScrollView,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { auth } from "@/lib/auth-client";
import { useAuth } from "@/stores/auth";
import {
  FormField, Button, StepIndicator, Badge, type FieldStatus,
} from "@/components/ui";

const AVATAR_COLORS = [
  "#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#ec4899",
];
const INVITE_MIN_LEN = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const DEBOUNCE = 450;

type Step = "invite" | "identity";
type InviteStatus = "idle" | "checking" | "valid" | "invalid" | "unreachable";
type UsernameStatus =
  | "idle" | "checking" | "available" | "taken"
  | "invalid_format" | "unreachable";
type EmailStatus = "idle" | "valid" | "invalid";

export default function RegisterScreen() {
  const router = useRouter();
  const signIn = useAuth((s) => s.signIn);
  const [step, setStep] = useState<Step>("invite");

  const [inviteCode, setInviteCode] = useState("");
  const [inviteStatus, setInviteStatus] = useState<InviteStatus>("idle");
  const inviteCheckId = useRef(0);

  const [email, setEmail] = useState("");
  const [emailStatus, setEmailStatus] = useState<EmailStatus>("idle");

  const [username, setUsername] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>("idle");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const usernameCheckId = useRef(0);

  const [displayName, setDisplayName] = useState("");
  const [color, setColor] = useState(AVATAR_COLORS[0]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /* ── async validation ── */

  useEffect(() => {
    const c = inviteCode.trim().toUpperCase();
    if (!c || c.length < INVITE_MIN_LEN) { setInviteStatus("idle"); return; }
    setInviteStatus("checking");
    const id = ++inviteCheckId.current;
    const t = setTimeout(async () => {
      const r = await auth.checkInvite(c);
      if (id !== inviteCheckId.current) return;
      if (r.ok) setInviteStatus("valid");
      else if ("reason" in r && r.reason === "unreachable") setInviteStatus("unreachable");
      else setInviteStatus("invalid");
    }, DEBOUNCE);
    return () => clearTimeout(t);
  }, [inviteCode]);

  useEffect(() => {
    const t = email.trim();
    if (!t) { setEmailStatus("idle"); return; }
    setEmailStatus(EMAIL_RE.test(t) ? "valid" : "invalid");
  }, [email]);

  useEffect(() => {
    const c = username.trim().toLowerCase();
    if (!c) { setUsernameStatus("idle"); setSuggestions([]); return; }
    if (!USERNAME_RE.test(c)) { setUsernameStatus("invalid_format"); setSuggestions([]); return; }
    setUsernameStatus("checking");
    const id = ++usernameCheckId.current;
    const t = setTimeout(async () => {
      const r = await auth.checkUsernameAvailable(c);
      if (id !== usernameCheckId.current) return;
      if (!r.ok) {
        setUsernameStatus(r.reason === "invalid_format" ? "invalid_format" : "unreachable");
        setSuggestions([]);
      } else if (r.available) {
        setUsernameStatus("available"); setSuggestions([]);
      } else {
        setUsernameStatus("taken"); setSuggestions(r.suggestions ?? []);
      }
    }, DEBOUNCE);
    return () => clearTimeout(t);
  }, [username]);

  /* ── derived ── */

  const canContinue = inviteStatus === "valid" || inviteStatus === "unreachable";
  const canSubmit =
    emailStatus === "valid" &&
    (usernameStatus === "available" || usernameStatus === "unreachable") &&
    displayName.trim().length >= 2 && !submitting;

  /* ── handlers ── */

  const goToIdentity = useCallback(() => {
    if (canContinue) setStep("identity");
  }, [canContinue]);

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true); setError(null);
    const r = await auth.registerAccount(
      email.trim().toLowerCase(), username.trim().toLowerCase(),
      displayName.trim(), color, inviteCode.trim().toUpperCase(),
    );
    setSubmitting(false);
    if (!r.ok) {
      switch (r.reason) {
        case "invalid_invite": setInviteStatus("invalid"); setStep("invite"); break;
        case "username_taken": setUsernameStatus("taken"); break;
        case "invalid_email": setEmailStatus("invalid"); setError("That email isn\u2019t valid."); break;
        case "invalid_username": setUsernameStatus("invalid_format"); break;
        case "unreachable": setError("Couldn\u2019t reach the server. Check your connection."); break;
        default: setError("Something went wrong. Please try again.");
      }
      return;
    }
    await signIn(r.sessionToken, r.user);
  }, [canSubmit, email, username, displayName, color, inviteCode, signIn]);

  /* ── status mapping ── */

  const invFS: FieldStatus =
    inviteStatus === "checking" ? "checking"
    : inviteStatus === "valid" ? "valid"
    : inviteStatus === "invalid" ? "invalid"
    : inviteStatus === "unreachable" ? "warning" : "idle";
  const invHint =
    inviteStatus === "checking" ? "Checking your invitation\u2026"
    : inviteStatus === "valid" ? "You\u2019ve entered a valid code."
    : inviteStatus === "invalid" ? "This invitation is invalid or has already been redeemed."
    : inviteStatus === "unreachable" ? "Couldn\u2019t verify \u2014 it\u2019ll be checked when you continue."
    : undefined;

  const emFS: FieldStatus = emailStatus === "valid" ? "valid"
    : emailStatus === "invalid" ? "invalid" : "idle";
  const emHint = emailStatus === "invalid" && email.trim().length > 3
    ? "Enter a valid email address." : undefined;

  const unFS: FieldStatus =
    usernameStatus === "checking" ? "checking"
    : usernameStatus === "available" ? "valid"
    : usernameStatus === "taken" || usernameStatus === "invalid_format" ? "invalid"
    : usernameStatus === "unreachable" ? "warning" : "idle";
  const unHint =
    usernameStatus === "checking" ? "Checking availability\u2026"
    : usernameStatus === "available" ? "@" + username.trim().toLowerCase() + " is available"
    : usernameStatus === "taken" ? "That username is already taken."
    : usernameStatus === "invalid_format" ? "3\u201320 chars. Lowercase letters, numbers, underscores."
    : usernameStatus === "unreachable" ? "Couldn\u2019t check \u2014 you can still continue."
    : undefined;

  /* ── render ── */

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="px-6 pt-1">
        <StepIndicator steps={2} current={step === "invite" ? 1 : 2} />
      </View>

      <Pressable
        onPress={() => (step === "identity" ? setStep("invite") : router.back())}
        hitSlop={10}
        className="flex-row items-center gap-1 self-start px-5 pt-3 pb-1 active:opacity-60"
      >
        <Ionicons name="chevron-back" size={20} color="#0f172a" />
        <Text className="text-ink text-[16px] font-medium">Back</Text>
      </Pressable>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <ScrollView className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {step === "invite" ? (
            <View className="pt-7">
              <View className="items-center mb-4">
                <Badge>Invite only</Badge>
              </View>
              <Text className="text-ink text-[30px] font-extrabold text-center tracking-tight leading-[38px]">
                Type your invite code
              </Text>
              <Text className="text-muted text-[15px] leading-[22px] text-center mt-2.5 px-3">
                Tabcom is currently invite-only. Enter the invitation code you
                received to create your account.
              </Text>
              <View className="mt-12">
                <FormField
                  label=""
                  placeholder="TAB-XXXX-XXXX-XXXX"
                  value={inviteCode}
                  onChangeText={(t) => setInviteCode(t.toUpperCase())}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  autoComplete="off"
                  status={invFS}
                  hint={invHint}
                  inputStyle={{
                    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                    fontSize: 17, letterSpacing: 1.5, textAlign: "center",
                  }}
                />
              </View>
              <View className="mt-6">
                <Button onPress={goToIdentity} disabled={!canContinue}>Continue</Button>
              </View>
              <Pressable
                onPress={() => router.push("/(auth)/sign-in" as any)}
                hitSlop={8}
                className="flex-row items-center justify-center mt-5 active:opacity-60"
              >
                <Text className="text-[13px] text-slate-400">Already have an account? </Text>
                <Text className="text-[13px] text-ink font-semibold underline">Sign in</Text>
              </Pressable>
            </View>
          ) : (
            <View className="pt-5">
              <Text className="text-ink text-[30px] font-extrabold tracking-tight">
                Create Account
              </Text>
              <Text className="text-muted text-[15px] leading-[22px] mt-1.5">
                Complete the information below to continue.
              </Text>
              <View className="flex-row items-center gap-2 mt-3.5 mb-7">
                <View style={{ backgroundColor: "#16a34a" }}
                  className="w-[22px] h-[22px] rounded-full items-center justify-center">
                  <Ionicons name="checkmark" size={14} color="#fff" />
                </View>
                <Text style={{
                    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                    letterSpacing: 0.8,
                  }} className="text-[15px] font-bold text-success">
                  {inviteCode.trim().toUpperCase()}
                </Text>
              </View>

              <FormField label="Email" placeholder="name@example.com"
                value={email} onChangeText={setEmail}
                keyboardType="email-address" autoCapitalize="none"
                autoCorrect={false} autoComplete="email"
                status={emFS} hint={emHint} autoFocusOnMount />

              <FormField label="Username" placeholder="Choose a username"
                value={username} onChangeText={setUsername}
                autoCapitalize="none" autoCorrect={false} autoComplete="off"
                status={unFS} hint={unHint} />

              {usernameStatus === "taken" && suggestions.length > 0 && (
                <View className="-mt-2.5 mb-3">
                  <Text className="text-xs font-semibold text-warning mb-2">Suggestions</Text>
                  <View className="flex-row flex-wrap gap-2">
                    {suggestions.map((s) => (
                      <Pressable key={s} onPress={() => setUsername(s)}
                        className="border border-primary rounded-full px-3.5 py-1.5 active:opacity-70">
                        <Text className="text-[13px] font-medium text-primary">{s}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}

              <FormField label="Display Name" placeholder="Your Name"
                value={displayName} onChangeText={setDisplayName}
                autoComplete="name"
                status={displayName.trim().length > 0 && displayName.trim().length < 2 ? "invalid" : "idle"}
                hint={displayName.trim().length > 0 && displayName.trim().length < 2 ? "At least 2 characters." : undefined} />

              <View className="mb-6">
                <Text className="text-[13px] font-medium text-muted mb-2.5">Avatar color</Text>
                <View className="flex-row gap-3">
                  {AVATAR_COLORS.map((c) => (
                    <Pressable key={c} onPress={() => setColor(c)} className="active:opacity-70">
                      <View style={{
                          backgroundColor: c,
                          opacity: color === c ? 1 : 0.35,
                          borderWidth: color === c ? 2.5 : 0,
                          borderColor: "#0f172a",
                        }} className="w-10 h-10 rounded-full" />
                    </Pressable>
                  ))}
                </View>
              </View>

              {error && (
                <View className="flex-row items-center gap-2 bg-red-50 rounded-xl p-3.5 mb-4">
                  <Ionicons name="alert-circle" size={18} color="#dc2626" />
                  <Text className="flex-1 text-[13px] text-danger leading-[18px]">{error}</Text>
                </View>
              )}

              <Button onPress={submit} disabled={!canSubmit} loading={submitting}>
                {submitting ? "Creating account\u2026" : "Create account"}
              </Button>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
