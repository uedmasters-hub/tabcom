import { useEffect, useState } from "react";
import { Text, View, Pressable, ScrollView, Alert, Share } from "react-native";
import { useAuth } from "@/stores/auth";
import { ScreenHeader } from "@/components/ScreenHeader";
import { usePresence } from "@/stores/presence";
import { useChatStore } from "@/stores/chat";
import { useRealtime } from "@/stores/realtime";
import { auth } from "@/lib/auth-client";
import { updatePresence, clearMyHistory } from "@/lib/realtime";
import type { WirePresence } from "@tabcom/shared";

const PRESENCE_OPTIONS: Array<{ value: WirePresence; label: string; color: string }> = [
  { value: "online", label: "Online", color: "#16a34a" },
  { value: "away", label: "Away", color: "#d97706" },
  { value: "busy", label: "Busy", color: "#dc2626" },
  { value: "offline", label: "Hidden", color: "#94a3b8" },
];

interface InviteSummary { code: string; used: boolean; usedAt: string | null; }

export default function SettingsScreen() {
  const { user, sessionToken, signOut } = useAuth();
  const connected = useRealtime((s) => s.connected);
  const presence = usePresence((s) => s.presence);
  const [invites, setInvites] = useState<InviteSummary[] | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!sessionToken) return;
    auth.fetchInvites(sessionToken).then((r) => { if (r.ok) setInvites(r.invites); });
  }, [sessionToken]);

  const handlePresence = (p: WirePresence) => usePresence.getState().changePresence(p);

  const handleClearHistory = () => {
    Alert.alert(
      "Clear history",
      "This clears all messages and conversations on this device and the server. Contacts, communities, and your account stay intact.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Clear", style: "destructive", onPress: async () => { await clearMyHistory(); useChatStore.getState().resetChat(); } },
      ]
    );
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    useChatStore.getState().resetChat();
    await signOut();
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "Delete account",
      "This permanently deletes your Tabcom account, all your data, and ends all sessions. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete forever", style: "destructive",
          onPress: async () => {
            if (!sessionToken) return;
            const r = await auth.deleteAccount(sessionToken);
            if (r.ok) { useChatStore.getState().resetChat(); await signOut(); }
            else Alert.alert("Error", "Couldn't delete account. Try again.");
          },
        },
      ]
    );
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Settings" />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 48 }}>
      {/* Profile */}
      <View className="items-center pt-4 pb-6">
        <View style={{ backgroundColor: user?.avatarColor ?? "#2563eb" }} className="w-24 h-24 rounded-full items-center justify-center mb-4">
          <Text className="text-white font-bold text-4xl">{(user?.displayName ?? "?").slice(0, 1).toUpperCase()}</Text>
        </View>
        <Text className="text-ink font-bold text-2xl">{user?.displayName}</Text>
        <Text className="text-muted text-[16px] mt-0.5">@{user?.username}</Text>
        <View className={`flex-row items-center gap-2 px-3 py-1.5 rounded-full mt-3 ${connected ? "bg-emerald-50" : "bg-amber-50"}`}>
          <View className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500" : "bg-amber-400"}`} />
          <Text className={`text-xs font-bold uppercase tracking-wider ${connected ? "text-emerald-700" : "text-amber-700"}`}>
            {connected ? "Connected" : "Reconnecting"}
          </Text>
        </View>
      </View>

      {/* Presence */}
      <View className="px-5 mb-8">
        <Text className="text-muted text-[13px] uppercase font-bold tracking-wide mb-3">Status</Text>
        <View className="flex-row gap-2.5">
          {PRESENCE_OPTIONS.map((opt) => (
            <Pressable
              key={opt.value}
              onPress={() => handlePresence(opt.value)}
              className={`flex-1 items-center py-3.5 rounded-2xl border-2 ${presence === opt.value ? "border-primary bg-blue-50" : "border-slate-100 bg-white"}`}
            >
              <View style={{ backgroundColor: opt.color }} className="w-2.5 h-2.5 rounded-full mb-1.5" />
              <Text className={`text-[13px] ${presence === opt.value ? "text-ink font-bold" : "text-muted font-medium"}`}>{opt.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Invite codes */}
      {invites && invites.length > 0 && (
        <View className="px-5 mb-8">
          <Text className="text-muted text-[13px] uppercase font-bold tracking-wide mb-3">
            Invite codes · {invites.filter((i) => !i.used).length} available
          </Text>
          {invites.map((inv) => (
            <View key={inv.code} className="flex-row items-center bg-surface rounded-2xl px-5 py-4 mb-2">
              <Text className={`flex-1 text-[15px] font-mono ${inv.used ? "text-slate-400" : "text-ink font-semibold"}`}>{inv.code}</Text>
              {inv.used ? (
                <Text className="text-slate-400 text-[13px] font-medium">Used</Text>
              ) : (
                <Pressable onPress={() => Share.share({ message: `Join me on Tabcom! Use this invite code: ${inv.code}` })} className="bg-primary rounded-full px-4 py-2 active:opacity-85">
                  <Text className="text-white text-[13px] font-bold">Share</Text>
                </Pressable>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Actions */}
      <View className="px-5 gap-2.5">
        <Pressable onPress={handleClearHistory} className="bg-surface rounded-2xl py-4 items-center active:opacity-70">
          <Text className="text-ink font-bold text-[16px]">Clear history</Text>
        </Pressable>
        <Pressable onPress={handleSignOut} disabled={signingOut} className="bg-surface rounded-2xl py-4 items-center active:opacity-70">
          <Text className="text-red-600 font-bold text-[16px]">{signingOut ? "Signing out…" : "Sign out"}</Text>
        </Pressable>
        <Pressable onPress={handleDeleteAccount} className="border border-red-200 rounded-2xl py-4 items-center active:opacity-70 mt-4">
          <Text className="text-red-600 font-bold text-[16px]">Delete account</Text>
        </Pressable>
      </View>

      <Text className="text-slate-400 text-[13px] text-center mt-8 px-8 leading-5">
        Settings sync with the extension automatically via your Tabcom account.
      </Text>
      </ScrollView>
    </View>
  );
}
