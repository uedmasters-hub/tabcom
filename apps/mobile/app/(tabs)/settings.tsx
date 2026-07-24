import { useState } from "react";
import { Text, View, Pressable, ScrollView, Alert } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Avatar } from "@/components/Avatar";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useAuth } from "@/stores/auth";
import { usePresence } from "@/stores/presence";
import { useRealtime } from "@/stores/realtime";
import { useChatStore } from "@/stores/chat";
import { auth } from "@/lib/auth-client";

/* ── Shared row components ── */

function SectionTitle({ children }: { children: string }) {
  return (
    <Text className="text-[12px] font-semibold text-slate-400 uppercase tracking-wider px-6 pt-6 pb-2">
      {children}
    </Text>
  );
}

function Row({ icon, label, sub, onPress, danger, locked, trailing }: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string; sub?: string; onPress?: () => void;
  danger?: boolean; locked?: boolean; trailing?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={locked ? undefined : onPress}
      className={`flex-row items-center px-6 py-[14px] ${locked ? "opacity-40" : "active:bg-slate-50"}`}
    >
      <View className="w-9 items-center">
        <Ionicons name={icon} size={19} color={danger ? "#dc2626" : "#64748b"} />
      </View>
      <View className="flex-1 ml-1">
        <Text className={`text-[15px] ${danger ? "text-danger font-medium" : "text-ink font-medium"}`}>
          {label}
        </Text>
        {sub && <Text className="text-[12px] text-slate-400 mt-0.5">{sub}</Text>}
      </View>
      {locked ? (
        <View className="flex-row items-center gap-1">
          <Ionicons name="lock-closed" size={13} color="#cbd5e1" />
          <Text className="text-[11px] text-slate-300">Account required</Text>
        </View>
      ) : trailing !== undefined ? trailing : (
        <Ionicons name="chevron-forward" size={16} color="#d1d5db" />
      )}
    </Pressable>
  );
}

function Divider() {
  return <View className="h-px bg-slate-100 mx-6" />;
}

export default function SettingsScreen() {
  const router = useRouter();
  const { user, sessionToken, guest, signOut } = useAuth();
  const connected = useRealtime((s) => s.connected);
  const presence = usePresence((s) => s.presence);
  const [signingOut, setSigningOut] = useState(false);

  const isGuest = !!guest;
  const isRegistered = !!sessionToken;

  const presenceDot =
    presence === "online" ? "#16a34a"
    : presence === "away" ? "#d97706"
    : presence === "busy" ? "#dc2626" : "#94a3b8";

  const handleSignOut = async () => {
    setSigningOut(true);
    useChatStore.getState().resetChat();
    await signOut();
  };

  const handleDeleteAccount = () => {
    Alert.alert("Delete account",
      "This permanently deletes your account and all data. This cannot be undone.",
      [{ text: "Cancel", style: "cancel" },
       { text: "Delete forever", style: "destructive", onPress: async () => {
         if (!sessionToken) return;
         const r = await auth.deleteAccount(sessionToken);
         if (r.ok) { useChatStore.getState().resetChat(); await signOut(); }
         else Alert.alert("Error", "Couldn't delete account.");
       }}],
    );
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Settings" />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 56 }}
        showsVerticalScrollIndicator={false}>

        {/* ── Profile card ── */}
        <Pressable
          onPress={() => router.push("/settings/profile" as any)}
          className="flex-row items-center px-6 py-5 active:bg-slate-50"
        >
          <Avatar
            name={user?.displayName ?? "?"}
            color={user?.avatarColor ?? "#2563eb"}
            size="lg"
          />
          <View className="flex-1 ml-4">
            <View className="flex-row items-center gap-2">
              <Text className="text-ink text-[18px] font-bold">
                {user?.displayName}
              </Text>
              {isGuest && (
                <View className="bg-amber-50 rounded-md px-2 py-0.5">
                  <Text className="text-amber-600 text-[10px] font-bold uppercase">Guest</Text>
                </View>
              )}
            </View>
            <Text className="text-slate-400 text-[14px] mt-0.5">
              @{user?.username}
            </Text>
          </View>
          <View className="flex-row items-center gap-2.5">
            <View style={{ backgroundColor: presenceDot }}
              className="w-2 h-2 rounded-full" />
            <Ionicons name="chevron-forward" size={16} color="#d1d5db" />
          </View>
        </Pressable>

        {/* ── Guest invite request banner ── */}
        {isGuest && (
          <View className="mx-6 mb-2 mt-1">
            <Pressable
              onPress={() => router.push("/settings/request-invite" as any)}
              className="bg-primary/5 border border-primary/20 rounded-2xl px-5 py-4 active:opacity-80"
            >
              <View className="flex-row items-center gap-3">
                <View className="w-10 h-10 rounded-full bg-primary/10 items-center justify-center">
                  <Ionicons name="ticket-outline" size={20} color="#2563eb" />
                </View>
                <View className="flex-1">
                  <Text className="text-ink text-[15px] font-semibold">
                    Get a Tabcom account
                  </Text>
                  <Text className="text-slate-400 text-[12px] mt-0.5">
                    Request an invitation to unlock all features
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#2563eb" />
              </View>
            </Pressable>
          </View>
        )}

        <View className="h-2 bg-slate-50" />

        {/* ── General ── */}
        <SectionTitle>General</SectionTitle>
        <Row icon="options-outline" label="Preferences"
          sub="Cursors, animations, floating chat"
          onPress={() => router.push("/settings/preferences" as any)} />

        <Divider />

        {/* ── Communications ── */}
        <SectionTitle>Communications</SectionTitle>
        <Row icon="chatbubble-outline" label="Chat"
          sub="Privacy, media, blocked users"
          onPress={() => router.push("/settings/chat" as any)} />
        <Row icon="ticket-outline" label="Invite codes"
          sub={isRegistered ? "Share codes to invite friends" : undefined}
          onPress={() => router.push("/settings/invite-codes" as any)}
          locked={isGuest} />
        <Row icon="notifications-outline" label="Notifications"
          sub={isRegistered ? "Sounds, badges, channels" : undefined}
          onPress={() => router.push("/settings/notifications" as any)}
          locked={isGuest} />

        <Divider />

        {/* ── Account ── */}
        <SectionTitle>Account</SectionTitle>
        <Row icon="log-out-outline"
          label={signingOut ? "Signing out\u2026" : isGuest ? "End guest session" : "Sign out"}
          onPress={handleSignOut} danger trailing={<View />} />
        {isRegistered && (
          <Row icon="warning-outline" label="Delete account"
            onPress={handleDeleteAccount} danger trailing={<View />} />
        )}

        {/* ── Footer ── */}
        <View className="items-center mt-10 mb-4">
          <Text className="text-slate-300 text-[12px]">
            {isRegistered
              ? "Settings sync with the extension automatically."
              : "Create an account to sync settings across devices."}
          </Text>
          <Text className="text-slate-300 text-[11px] mt-1">Tabcom v0.2</Text>
        </View>
      </ScrollView>
    </View>
  );
}
