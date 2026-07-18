import { useEffect, useState } from "react";
import {
  Text, View, Pressable, ScrollView, Alert, Share,
} from "react-native";
import { useAuth } from "@/stores/auth";
import { useChatStore } from "@/stores/chat";
import { useRealtime } from "@/stores/realtime";
import { auth } from "@/lib/auth-client";
import { updatePresence, updateVisibility, clearMyHistory } from "@/lib/realtime";
import type { WirePresence } from "@tabcom/shared";

const PRESENCE_OPTIONS: Array<{ value: WirePresence; label: string; color: string }> = [
  { value: "online", label: "Online", color: "#4ade80" },
  { value: "away", label: "Away", color: "#facc15" },
  { value: "busy", label: "Busy", color: "#ef4444" },
  { value: "offline", label: "Appear offline", color: "#6b7280" },
];

interface InviteSummary {
  code: string;
  used: boolean;
  usedAt: string | null;
}

export default function SettingsScreen() {
  const { user, sessionToken, signOut } = useAuth();
  const connected = useRealtime((s) => s.connected);
  const [presence, setPresenceState] = useState<WirePresence>("online");
  const [invites, setInvites] = useState<InviteSummary[] | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  // Load invite codes
  useEffect(() => {
    if (!sessionToken) return;
    auth.fetchInvites(sessionToken).then((r) => {
      if (r.ok) setInvites(r.invites);
    });
  }, [sessionToken]);

  const handlePresence = (p: WirePresence) => {
    setPresenceState(p);
    updatePresence(p);
  };

  const shareInvite = (code: string) => {
    Share.share({
      message: `Join me on Tabcom! Use this invite code: ${code}`,
    });
  };

  const handleClearHistory = () => {
    Alert.alert(
      "Clear history",
      "This clears all messages and conversations on this device and the server. Contacts, communities, and your account stay intact.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear", style: "destructive",
          onPress: async () => {
            await clearMyHistory();
            useChatStore.getState().resetChat();
          },
        },
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
          text: "Delete forever",
          style: "destructive",
          onPress: async () => {
            if (!sessionToken) return;
            const result = await auth.deleteAccount(sessionToken);
            if (result.ok) {
              useChatStore.getState().resetChat();
              await signOut();
            } else {
              Alert.alert("Error", "Couldn't delete account. Try again.");
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView className="flex-1 bg-ink" contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Profile card */}
      <View className="bg-card border border-line rounded-2xl p-5 mx-4 mt-4 mb-4">
        <View className="flex-row items-center gap-4">
          <View
            style={{ backgroundColor: user?.avatarColor ?? "#7C6CF6" }}
            className="w-14 h-14 rounded-full items-center justify-center"
          >
            <Text className="text-white font-bold text-xl">
              {(user?.displayName ?? "?").slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <View className="flex-1">
            <Text className="text-white font-semibold text-lg">{user?.displayName}</Text>
            <Text className="text-neutral-500">@{user?.username}</Text>
            <Text className="text-neutral-600 text-xs mt-0.5">{user?.email}</Text>
          </View>
        </View>
      </View>

      {/* Connection status */}
      <View className="flex-row items-center gap-2 px-4 mb-4">
        <View className={`w-2 h-2 rounded-full ${connected ? "bg-green-400" : "bg-red-400"}`} />
        <Text className="text-neutral-500 text-xs">
          {connected ? "Connected to Tabcom" : "Reconnecting…"}
        </Text>
      </View>

      {/* Presence */}
      <View className="px-4 mb-6">
        <Text className="text-neutral-500 text-xs uppercase mb-2">Status</Text>
        <View className="flex-row gap-2">
          {PRESENCE_OPTIONS.map((opt) => (
            <Pressable
              key={opt.value}
              onPress={() => handlePresence(opt.value)}
              className={`flex-1 flex-row items-center justify-center gap-1.5 py-2.5 rounded-xl border ${
                presence === opt.value ? "border-accent bg-accent/10" : "border-line bg-card"
              }`}
            >
              <View style={{ backgroundColor: opt.color }} className="w-2 h-2 rounded-full" />
              <Text className={`text-xs ${presence === opt.value ? "text-white font-semibold" : "text-neutral-400"}`}>
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Invite codes */}
      {invites && invites.length > 0 && (
        <View className="px-4 mb-6">
          <Text className="text-neutral-500 text-xs uppercase mb-2">
            Your invite codes ({invites.filter((i) => !i.used).length} available)
          </Text>
          {invites.map((inv) => (
            <View
              key={inv.code}
              className="flex-row items-center bg-card border border-line rounded-xl px-4 py-3 mb-1.5"
            >
              <Text className={`flex-1 text-sm font-mono ${inv.used ? "text-neutral-600" : "text-white"}`}>
                {inv.code}
              </Text>
              {inv.used ? (
                <Text className="text-neutral-600 text-xs">Used</Text>
              ) : (
                <Pressable onPress={() => shareInvite(inv.code)} className="active:opacity-70">
                  <Text className="text-accent text-xs font-semibold">Share</Text>
                </Pressable>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Actions */}
      <View className="px-4 gap-2">
        <Pressable
          onPress={handleClearHistory}
          className="bg-card border border-line rounded-xl py-3 items-center active:opacity-70"
        >
          <Text className="text-neutral-300 font-semibold text-sm">Clear history</Text>
        </Pressable>

        <Pressable
          onPress={handleSignOut}
          disabled={signingOut}
          className="bg-card border border-line rounded-xl py-3 items-center active:opacity-70"
        >
          <Text className="text-red-400 font-semibold text-sm">
            {signingOut ? "Signing out…" : "Sign out"}
          </Text>
        </Pressable>

        <Pressable
          onPress={handleDeleteAccount}
          className="bg-card border border-red-900/30 rounded-xl py-3 items-center active:opacity-70"
        >
          <Text className="text-red-500 font-semibold text-sm">Delete account</Text>
        </Pressable>
      </View>

      <Text className="text-neutral-700 text-xs text-center mt-6 px-4">
        Settings changes sync with the extension automatically via the shared backend.
      </Text>
    </ScrollView>
  );
}
