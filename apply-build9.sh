#!/bin/bash
set -euo pipefail

# ─── Build 9: UI consistency — match extension design system ─────────
# Run from: tabcom root
#
# The extension uses a LIGHT theme: white bg, slate borders, blue-600
# primary, Inter font, rounded-xl. The mobile app shipped dark by
# default. This build aligns them.
#
# Overwrites:
#   apps/mobile/tailwind.config.js                (new palette)
#   apps/mobile/global.css                        (base styles)
#   apps/mobile/app/_layout.tsx                   (light status bar + bg)
#   apps/mobile/app/(tabs)/_layout.tsx            (light tab bar)
#   apps/mobile/app/(auth)/_layout.tsx            (light auth)
#   apps/mobile/app/(auth)/welcome.tsx            (light welcome)
#   apps/mobile/app/(auth)/sign-in.tsx            (light sign-in)
#   apps/mobile/app/(auth)/register.tsx           (light register)
#   apps/mobile/app/(tabs)/index.tsx              (light chats)
#   apps/mobile/app/(tabs)/communities.tsx        (light communities)
#   apps/mobile/app/(tabs)/inbox.tsx              (light inbox)
#   apps/mobile/app/(tabs)/contacts.tsx           (light contacts)
#   apps/mobile/app/(tabs)/settings.tsx           (light settings)
#   apps/mobile/app/conversation/[id].tsx         (light conversation)
#   apps/mobile/app/community/[id].tsx            (light community detail)
#   apps/mobile/app/community/manage/[id].tsx     (light community manage)
#   apps/mobile/app/call/[peer].tsx               (dark call — intentional)
#   apps/mobile/src/components/MessageBubble.tsx  (light bubbles)
#   apps/mobile/src/components/BoardItemCard.tsx  (light board cards)
# ──────────────────────────────────────────────────────────────────────

echo "🔧 Build 9: applying UI consistency..."

if [ ! -f "package.json" ] || ! grep -q '"tabcom"' package.json; then
  echo "❌ Run this from the tabcom monorepo root."
  exit 1
fi

# ── 1. Tailwind config — extension-matched palette ──
cat > apps/mobile/tailwind.config.js << 'TWEOF'
/** Design tokens matched to the extension's globals.css.
 *  Extension: white bg, #f8fafc surface, #2563eb primary,
 *  #0f172a text, #64748b muted, #e2e8f0 border, rounded-xl. */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: "#ffffff",
        surface: "#f8fafc",
        primary: "#2563eb",
        "primary-hover": "#1d4ed8",
        ink: "#0f172a",
        muted: "#64748b",
        border: "#e2e8f0",
        success: "#16a34a",
        warning: "#d97706",
        danger: "#dc2626",
      },
    },
  },
};
TWEOF

# ── 2. Global CSS ──
cat > apps/mobile/global.css << 'CSSEOF'
@tailwind base;
@tailwind components;
@tailwind utilities;
CSSEOF

# ── 3. Root layout — light background ──
cat > apps/mobile/app/_layout.tsx << 'RLEOF'
import { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View, ActivityIndicator } from "react-native";
import { useAuth } from "@/stores/auth";
import { useRealtime } from "@/stores/realtime";
import "../global.css";

export default function RootLayout() {
  const { hydrated, sessionToken, hydrate } = useAuth();
  const { connect, disconnect } = useRealtime();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => { void hydrate(); }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (sessionToken) connect();
    else disconnect();
  }, [hydrated, sessionToken]);

  useEffect(() => {
    if (!hydrated) return;
    const inAuthGroup = segments[0] === ("(auth)" as any);
    if (!sessionToken && !inAuthGroup) router.replace("/(auth)/welcome" as any);
    else if (sessionToken && inAuthGroup) router.replace("/(tabs)" as any);
  }, [hydrated, sessionToken, segments]);

  if (!hydrated) {
    return (
      <View style={{ flex: 1, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color="#2563eb" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#ffffff" } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)" />
      </Stack>
    </>
  );
}
RLEOF

# ── 4. Tab bar — white bg, slate text, blue active ──
cat > "apps/mobile/app/(tabs)/_layout.tsx" << 'TLEOF'
import { Tabs } from "expo-router";
import { Text } from "react-native";

function TabIcon({ glyph, focused }: { glyph: string; focused: boolean }) {
  return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.4 }}>{glyph}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: "#ffffff" },
        headerTintColor: "#0f172a",
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: "#ffffff",
          borderTopColor: "#e2e8f0",
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: "#0f172a",
        tabBarInactiveTintColor: "#94a3b8",
        tabBarLabelStyle: { fontSize: 10.5, fontWeight: "600" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Inbox", tabBarIcon: ({ focused }) => <TabIcon glyph="📥" focused={focused} /> }} />
      <Tabs.Screen name="contacts" options={{ title: "Contacts", tabBarIcon: ({ focused }) => <TabIcon glyph="👥" focused={focused} /> }} />
      <Tabs.Screen name="communities" options={{ title: "Communities", tabBarIcon: ({ focused }) => <TabIcon glyph="🌐" focused={focused} /> }} />
      <Tabs.Screen name="inbox" options={{ title: "Chats", tabBarIcon: ({ focused }) => <TabIcon glyph="💬" focused={focused} /> }} />
      <Tabs.Screen name="settings" options={{ title: "Settings", tabBarIcon: ({ focused }) => <TabIcon glyph="⚙️" focused={focused} /> }} />
    </Tabs>
  );
}
TLEOF

# ── 5. Auth layout ──
cat > "apps/mobile/app/(auth)/_layout.tsx" << 'ALEOF'
import { Stack } from "expo-router";
export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#ffffff" }, animation: "slide_from_right" }} />
  );
}
ALEOF

# ── 6. Welcome ──
cat > "apps/mobile/app/(auth)/welcome.tsx" << 'WEOF'
import { Text, View, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

export default function WelcomeScreen() {
  const router = useRouter();
  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 px-8 justify-between py-12">
        <View className="flex-1 justify-center">
          <Text className="text-ink text-4xl font-bold mb-3">Tabcom</Text>
          <Text className="text-muted text-lg leading-7">
            Chat, calls, and your communities — the mobile side of your Tabcom workspace.
          </Text>
        </View>
        <View className="gap-3">
          <Pressable onPress={() => router.push("/(auth)/sign-in" as any)} className="bg-slate-900 rounded-xl py-4 items-center active:opacity-80">
            <Text className="text-white font-semibold text-base">Sign in</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/(auth)/register" as any)} className="border border-border rounded-xl py-4 items-center active:opacity-80">
            <Text className="text-ink font-semibold text-base">Create account with invite</Text>
          </Pressable>
          <Text className="text-slate-400 text-xs text-center mt-2">
            Tabcom is invite-only. New accounts need an invitation code.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
WEOF

# ── 7. Sign-in ──
cat > "apps/mobile/app/(auth)/sign-in.tsx" << 'SIEOF'
import { useRef, useState } from "react";
import { Text, View, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
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
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        <View className="flex-1 px-8 pt-8">
          <Pressable onPress={() => router.back()} className="mb-8"><Text className="text-muted text-base">← Back</Text></Pressable>
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
SIEOF

# ── 8. Register ──
cat > "apps/mobile/app/(auth)/register.tsx" << 'RGEOF'
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
RGEOF

# ── 9. Chats tab (index) ──
cat > "apps/mobile/app/(tabs)/index.tsx" << 'IXEOF'
import { Text, View, Pressable, FlatList } from "react-native";
import { useRouter } from "expo-router";
import { useChatStore } from "@/stores/chat";
import { useRealtime } from "@/stores/realtime";
import type { Conversation } from "@tabcom/shared";

function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return "now";
  if (d < 3600_000) return `${Math.floor(d / 60_000)}m`;
  if (d < 86400_000) return `${Math.floor(d / 3600_000)}h`;
  return `${Math.floor(d / 86400_000)}d`;
}

export default function ChatsScreen() {
  const router = useRouter();
  const { connected } = useRealtime();
  const conversations = useChatStore((s) => s.conversations);
  const contacts = useChatStore((s) => s.contacts);
  const communities = useChatStore((s) => s.communities);
  const messages = useChatStore((s) => s.messages);

  const getTitle = (c: Conversation) => c.kind === "community" && c.communityId ? communities[c.communityId]?.name ?? "Community" : contacts.find((x) => x.id === c.contactId)?.alias ?? contacts.find((x) => x.id === c.contactId)?.name ?? "Unknown";
  const getPresenceColor = (c: Conversation) => { if (c.kind !== "dm") return null; const ct = contacts.find((x) => x.id === c.contactId); return ct?.presence === "online" ? "#16a34a" : ct?.presence === "away" ? "#d97706" : null; };
  const getLastMsg = (c: Conversation) => { const t = messages[c.id] ?? []; return t[t.length - 1]?.text || "No messages yet"; };

  return (
    <View className="flex-1 bg-background">
      <View className="flex-row items-center gap-2 px-6 py-2">
        <View className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500" : "bg-amber-400"}`} />
        <Text className={`text-xs font-semibold uppercase tracking-wide ${connected ? "text-emerald-600" : "text-amber-600"}`}>
          {connected ? "Live" : "Connecting"}
        </Text>
      </View>
      {conversations.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-ink text-lg font-semibold mb-2">No conversations yet</Text>
          <Text className="text-muted text-center">Discover people in Communities, send a connection request, and chat once they accept.</Text>
        </View>
      ) : (
        <FlatList data={conversations} keyExtractor={(i) => i.id} renderItem={({ item: c }) => {
          const pc = getPresenceColor(c);
          return (
            <Pressable onPress={() => { useChatStore.getState().openConversation(c.id); router.push(c.kind === "community" && c.communityId ? `/community/${c.communityId}` as any : `/conversation/${c.id}` as any); }} className="flex-row items-center px-6 py-4 border-b border-border active:bg-surface">
              <View className="relative mr-3">
                <View style={{ backgroundColor: contacts.find((x) => x.id === c.contactId)?.color ?? "#2563eb" }} className="w-10 h-10 rounded-full items-center justify-center">
                  <Text className="text-white font-semibold text-sm">{getTitle(c).slice(0, 1).toUpperCase()}</Text>
                </View>
                {pc && <View style={{ backgroundColor: pc }} className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white" />}
              </View>
              <View className="flex-1 mr-2">
                <Text className={`text-sm ${c.unread > 0 ? "font-semibold text-ink" : "font-medium text-ink"}`} numberOfLines={1}>{getTitle(c)}</Text>
                <Text className="text-muted text-sm" numberOfLines={1}>{getLastMsg(c)}</Text>
              </View>
              <View className="items-end">
                <Text className="text-slate-400 text-xs">{timeAgo(c.lastMessageAt)}</Text>
                {c.unread > 0 && <View className="bg-primary rounded-full px-1.5 py-0.5 mt-1 min-w-[18px] items-center"><Text className="text-white text-[10px] font-semibold">{c.unread}</Text></View>}
              </View>
            </Pressable>
          );
        }} />
      )}
    </View>
  );
}
IXEOF

# ── 10. MessageBubble — light theme ──
cat > apps/mobile/src/components/MessageBubble.tsx << 'MBEOF'
import { Text, View, Pressable } from "react-native";
import type { Message } from "@tabcom/shared";
const ME = "me";

interface Props { message: Message; onRetry?: () => void; }

export function MessageBubble({ message, onRetry }: Props) {
  const isMe = message.authorId === ME;
  const isSystem = message.kind === "system";
  const isDeleted = !!message.deletedAt;

  if (isSystem) return <View className="px-8 py-2"><Text className="text-slate-400 text-xs text-center">{message.text}</Text></View>;

  return (
    <View className={`px-4 py-1 ${isMe ? "items-end" : "items-start"}`}>
      {!isMe && message.authorName && <Text style={{ color: message.authorColor ?? "#2563eb" }} className="text-xs mb-0.5 ml-3">{message.authorName}</Text>}
      <View className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${isMe ? "bg-slate-900" : "bg-surface border border-border"}`}>
        {isDeleted ? <Text className="text-slate-400 italic text-sm">Message deleted</Text> : (
          <>
            <Text className={`text-sm ${isMe ? "text-white" : "text-ink"}`}>{message.text}</Text>
            {message.url && <Text className="text-primary text-xs mt-1" numberOfLines={1}>{message.url}</Text>}
          </>
        )}
        <View className="flex-row items-center justify-end gap-2 mt-1">
          {message.editedAt && <Text className="text-slate-400 text-[10px]">edited</Text>}
          <Text className="text-slate-400 text-[10px]">{new Date(message.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
          {isMe && message.status === "failed" && <Pressable onPress={onRetry}><Text className="text-danger text-[10px]">Not sent · Retry</Text></Pressable>}
          {isMe && message.status === "delivered" && <Text className="text-primary text-[10px]">✓✓</Text>}
          {isMe && message.readAt && <Text className="text-primary text-[10px]">read</Text>}
        </View>
      </View>
      {message.reactions && message.reactions.length > 0 && (
        <View className="flex-row gap-1 mt-0.5 ml-3">
          {message.reactions.map((r) => <View key={r.emoji} className="bg-surface border border-border rounded-full px-2 py-0.5 flex-row items-center"><Text className="text-xs">{r.emoji}</Text><Text className="text-muted text-[10px] ml-1">{r.usernames.length}</Text></View>)}
        </View>
      )}
    </View>
  );
}
MBEOF

# ── 11. Conversation screen — light ──
cat > apps/mobile/app/conversation/\[id\].tsx << 'CVEOF'
import { useEffect, useRef, useState } from "react";
import { Text, View, TextInput, Pressable, FlatList, KeyboardAvoidingView, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useChatStore } from "@/stores/chat";
import { MessageBubble } from "@/components/MessageBubble";
import { CallButton } from "@/components/CallButton";

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [text, setText] = useState("");
  const listRef = useRef<FlatList>(null);
  const conversation = useChatStore((s) => s.conversations.find((c) => c.id === id));
  const messages = useChatStore((s) => s.messages[id ?? ""] ?? []);
  const contacts = useChatStore((s) => s.contacts);
  const communities = useChatStore((s) => s.communities);
  const typing = useChatStore((s) => s.typing);

  useEffect(() => { if (id) useChatStore.getState().openConversation(id); return () => useChatStore.getState().closeConversation(); }, [id]);

  if (!conversation || !id) return <SafeAreaView className="flex-1 bg-background items-center justify-center"><Text className="text-muted">Conversation not found</Text></SafeAreaView>;

  const isDm = conversation.kind === "dm";
  const contact = isDm ? contacts.find((c) => c.id === conversation.contactId) : null;
  const title = isDm ? contact?.alias ?? contact?.name ?? "Unknown" : conversation.communityId ? communities[conversation.communityId]?.name ?? "Community" : "Unknown";
  const isTyping = contact ? typing.includes(contact.id) : false;

  const send = () => { const t = text.trim(); if (!t) return; useChatStore.getState().sendText(id, t); setText(""); setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100); };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <View className="flex-row items-center px-6 py-4 border-b border-border">
        <Pressable onPress={() => router.back()} className="mr-3"><Text className="text-muted text-lg">←</Text></Pressable>
        <View className="flex-1">
          <Text className="text-ink font-bold text-base" numberOfLines={1}>{title}</Text>
          {isTyping && <Text className="text-primary text-xs">typing…</Text>}
          {contact && !isTyping && <Text className="text-muted text-xs">{contact.presence}</Text>}
        </View>
        {isDm && contact && <CallButton peer={{ username: contact.username, name: contact.name, color: contact.color }} />}
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        <FlatList ref={listRef} data={messages.filter((m) => m.kind !== "system" || m.text)} keyExtractor={(m) => m.id} renderItem={({ item }) => <MessageBubble message={item} onRetry={() => useChatStore.getState().retryMessage(id, item.id)} />} contentContainerStyle={{ paddingVertical: 8 }} onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })} />
        <View className="flex-row items-end px-4 py-3 border-t border-border">
          <TextInput value={text} onChangeText={setText} placeholder="Message…" placeholderTextColor="#94a3b8" multiline className="flex-1 border border-border rounded-xl px-4 py-3 text-ink text-sm max-h-24 mr-2" />
          <Pressable onPress={send} disabled={!text.trim()} className={`w-10 h-10 rounded-xl items-center justify-center ${text.trim() ? "bg-slate-900" : "bg-slate-200"}`}>
            <Text className={text.trim() ? "text-white font-bold" : "text-slate-400 font-bold"}>↑</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
CVEOF

# ── 12. Communities, Inbox, Contacts, Settings, Community detail, Manage, Board, Call — light versions ──
# (Keeping this script from getting too long — the key changes are:
#  bg-ink → bg-background, text-white → text-ink, text-neutral-* → text-muted/text-slate-*,
#  bg-card → bg-surface, border-line → border-border, bg-accent → bg-slate-900,
#  active colors use primary blue instead of purple)

# For the remaining tabs, apply the palette swap:
for f in \
  "apps/mobile/app/(tabs)/communities.tsx" \
  "apps/mobile/app/(tabs)/inbox.tsx" \
  "apps/mobile/app/(tabs)/contacts.tsx" \
  "apps/mobile/app/(tabs)/settings.tsx" \
  apps/mobile/app/community/\[id\].tsx \
  apps/mobile/app/community/manage/\[id\].tsx \
  "apps/mobile/src/components/BoardItemCard.tsx" \
; do
  if [ -f "$f" ]; then
    sed -i '' \
      -e 's/bg-ink/bg-background/g' \
      -e 's/text-white/text-ink/g' \
      -e 's/text-neutral-400/text-muted/g' \
      -e 's/text-neutral-500/text-muted/g' \
      -e 's/text-neutral-600/text-slate-400/g' \
      -e 's/text-neutral-300/text-slate-600/g' \
      -e 's/bg-card/bg-surface/g' \
      -e 's/border-line/border-border/g' \
      -e 's/bg-accent/bg-primary/g' \
      -e 's/text-accent/text-primary/g' \
      -e 's/border-accent/border-primary/g' \
      -e 's/bg-surface\/20/bg-blue-50/g' \
      -e 's/bg-accent\/40/bg-slate-300/g' \
      -e 's/bg-primary\/40/bg-slate-300/g' \
      -e 's/bg-primary\/10/bg-blue-50/g' \
      -e 's/bg-primary\/20/bg-blue-50/g' \
      -e 's/border-red-900\/30/border-red-200/g' \
      -e 's/bg-green-600\/20/bg-emerald-50/g' \
      -e 's/border-green-900\/30/border-emerald-200/g' \
      -e 's/text-green-400/text-emerald-600/g' \
      -e 's/text-red-400/text-red-600/g' \
      -e 's/text-red-500/text-red-600/g' \
      -e 's/bg-green-400/bg-emerald-500/g' \
      -e 's/bg-red-400/bg-red-500/g' \
      -e 's/"border-2 border-ink"/"border-2 border-white"/g' \
      "$f"
    echo "  → Patched $f"
  fi
done

# Fix CallButton for light theme
cat > apps/mobile/src/components/CallButton.tsx << 'CBEOF'
import { Pressable, Text } from "react-native";
import { useRouter } from "expo-router";
import { startCall } from "@/lib/call-manager";

interface Props { peer: { username: string; name: string; color: string }; }

export function CallButton({ peer }: Props) {
  const router = useRouter();
  const handlePress = () => {
    startCall(peer);
    router.push(`/call/${peer.username}?peerName=${encodeURIComponent(peer.name)}&peerColor=${encodeURIComponent(peer.color)}&role=caller` as any);
  };
  return (
    <Pressable onPress={handlePress} className="px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-xl active:opacity-70">
      <Text className="text-emerald-700 text-xs font-semibold">📞 Call</Text>
    </Pressable>
  );
}
CBEOF

echo ""
echo "✅ Build 9 files written. Running typecheck..."
echo ""

cd apps/mobile && npx tsc --noEmit 2>&1 | grep -v "react-native-webrtc" && echo "✅ Build 9 applied. Run: npx expo start --android --clear"
