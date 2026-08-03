import { useEffect, useRef, useState } from "react";
import {
  Text,
  View,
  Pressable,
  ActivityIndicator,
  Keyboard,
  ScrollView,
} from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useRouter } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { isMagicLinkGranted } from "@tabcom/shared";
import { auth } from "@/lib/auth-client";
import { useAuth } from "@/stores/auth";
import { FormField, Button } from "@/components/ui";

type Phase = "email" | "waiting" | "expired" | "not_registered";

const NOT_REGISTERED_MESSAGE =
  "We couldn't find an active account associated with this email address. Invitations are not yet available for your account. We'll notify you once invitations are ready. In the meantime, you can continue using Tabcom as a Guest.";

const CTA_KEYBOARD_GAP = 8;

export default function SignInScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const signIn = useAuth((s) => s.signIn);
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>("email");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Keep CTAs clear of the keyboard on every auth result screen.
  useEffect(() => {
    if (phase === "not_registered") {
      Keyboard.dismiss();
    }
  }, [phase]);

  const submit = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setBusy(true);
    setError(null);

    const eligibility = await auth.checkEmail(trimmed);
    if (!eligibility.ok) {
      setBusy(false);
      setError(
        eligibility.reason === "invalid_email"
          ? "That doesn't look like a valid email."
          : "Couldn't reach the server."
      );
      return;
    }

    // Only trust explicit false. Legacy `{ ok: true }` without eligible
    // must fall through to request-link (otherwise every address shows
    // "no account found" while magic-link emails still fire).
    if (eligibility.eligible === false) {
      setBusy(false);
      Keyboard.dismiss();
      setPhase("not_registered");
      void auth.submitInviteRequest(trimmed);
      return;
    }

    const result = await auth.requestMagicLink(trimmed);
    setBusy(false);

    if (!isMagicLinkGranted(result)) {
      if (result.reason === "not_registered") {
        Keyboard.dismiss();
        setPhase("not_registered");
        void auth.submitInviteRequest(trimmed);
        return;
      }
      setError(
        result.reason === "rate_limited"
          ? "Too many attempts — wait a minute."
          : result.reason === "invalid_email"
            ? "That doesn't look like a valid email."
            : "Couldn't reach the server."
      );
      return;
    }

    setPhase("waiting");
    abortRef.current = new AbortController();
    const login = await auth.waitForLogin(result.pollId, {
      signal: abortRef.current.signal,
    });
    if (login) await signIn(login.sessionToken, login.user);
    else if (!abortRef.current.signal.aborted) setPhase("expired");
  };

  const stickyOffset = {
    closed: 0,
    opened: CTA_KEYBOARD_GAP,
  };
  const ctaPad = { paddingBottom: Math.max(insets.bottom, CTA_KEYBOARD_GAP) };

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <Pressable
        onPress={() => router.back()}
        hitSlop={10}
        className="flex-row items-center gap-1 self-start px-5 pt-3 pb-1 active:opacity-60"
      >
        <Ionicons name="chevron-back" size={20} color="#0f172a" />
        <Text className="text-ink text-[16px] font-medium">Back</Text>
      </Pressable>

      {phase === "email" && (
        <>
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 16, flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text className="text-ink text-[30px] font-extrabold tracking-tight mb-2">
              Sign in
            </Text>
            <Text className="text-muted text-[15px] leading-[22px] mb-8">
              We'll email you a sign-in link — no password needed. You must
              already have a Tabcom account.
            </Text>

            <FormField
              label="Email"
              placeholder="name@example.com"
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                if (error) setError(null);
              }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              autoFocusOnMount
              status={
                error && error.toLowerCase().includes("email")
                  ? "invalid"
                  : error
                    ? "invalid"
                    : "idle"
              }
              hint={error ?? undefined}
            />
          </ScrollView>

          <KeyboardStickyView offset={stickyOffset}>
            <View className="px-6 pt-2" style={ctaPad}>
              <Button
                onPress={submit}
                disabled={busy || !email.trim()}
                loading={busy}
              >
                Email me a link
              </Button>
            </View>
          </KeyboardStickyView>
        </>
      )}

      {phase === "not_registered" && (
        <>
          <ScrollView
            className="flex-1"
            contentContainerStyle={{
              paddingHorizontal: 24,
              paddingTop: 16,
              paddingBottom: 16,
              flexGrow: 1,
            }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View className="w-14 h-14 rounded-full bg-amber-50 items-center justify-center mb-5">
              <Ionicons name="mail-unread-outline" size={28} color="#d97706" />
            </View>
            <Text className="text-ink text-[26px] font-extrabold tracking-tight mb-2">
              No account found
            </Text>
            <Text className="text-muted text-[14px] mb-4">
              For{" "}
              <Text className="text-ink font-semibold">
                {email.trim().toLowerCase()}
              </Text>
            </Text>
            <View className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
              <Text className="text-amber-950 text-[14px] leading-[21px]">
                {NOT_REGISTERED_MESSAGE}
              </Text>
            </View>
          </ScrollView>

          <KeyboardStickyView offset={stickyOffset}>
            <View className="px-6 pt-2 gap-3" style={ctaPad}>
              <Button onPress={() => router.replace("/(auth)/guest" as any)}>
                Continue as Guest
              </Button>
              <Pressable
                onPress={() => router.push("/(auth)/register" as any)}
                className="self-center active:opacity-60 py-1"
              >
                <Text className="text-blue-600 text-[14px] font-semibold">
                  I have an invite code
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setPhase("email");
                  setError(null);
                }}
                className="self-center active:opacity-60 py-1"
              >
                <Text className="text-muted text-[14px]">Try a different email</Text>
              </Pressable>
            </View>
          </KeyboardStickyView>
        </>
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
            onPress={() => {
              abortRef.current?.abort();
              setPhase("email");
            }}
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
    </SafeAreaView>
  );
}
