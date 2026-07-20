import { useState } from "react";
import { Text, View, Pressable, TextInput, ScrollView, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useChatStore } from "@/stores/chat";
import { useAuth } from "@/stores/auth";
import { SecondaryHeader } from "@/components/SecondaryHeader";
import { Avatar } from "@/components/Avatar";
import {
  renameCommunity, inviteToCommunity, removeCommunityMember,
  leaveCommunity, deleteCommunity,
} from "@/lib/realtime";

export default function ManageCommunityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const me = useAuth((s) => s.user);
  const community = useChatStore((s) => (id ? s.communities[id] : undefined));

  const [nameDraft, setNameDraft] = useState(community?.name ?? "");
  const [inviteName, setInviteName] = useState("");

  if (!community || !id) {
    return (
      <View className="flex-1 bg-background">
        <SecondaryHeader title="Manage" />
        <View className="flex-1 items-center justify-center px-10">
          <Ionicons name="people-outline" size={52} color="#cbd5e1" />
          <Text className="text-ink font-bold text-lg mt-4">Community unavailable</Text>
          <Text className="text-muted text-center mt-1">It may have been deleted.</Text>
        </View>
      </View>
    );
  }

  const isAdmin = community.admin === me?.username;

  const submitRename = () => {
    const next = nameDraft.trim();
    if (!next || next === community.name) return;
    renameCommunity(id, next);
  };

  const submitInvite = () => {
    const u = inviteName.trim().replace(/^@/, "").toLowerCase();
    if (!u) return;
    inviteToCommunity(id, u);
    setInviteName("");
    Alert.alert("Invite sent", `@${u} was invited to ${community.name}.`);
  };

  const confirmRemove = (username: string) =>
    Alert.alert("Remove member", `Remove @${username} from ${community.name}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => removeCommunityMember(id, username) },
    ]);

  const confirmDestructive = () => {
    if (isAdmin) {
      Alert.alert("Delete community", `Delete "${community.name}" for everyone? This cannot be undone.`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
          onPress: () => {
            deleteCommunity(id);
            useChatStore.getState().receiveCommunityDeleted(id);
            router.replace("/(tabs)/communities" as any);
          },
        },
      ]);
    } else {
      Alert.alert("Leave community", `Leave "${community.name}"? You'll need a new invite to rejoin.`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave", style: "destructive",
          onPress: () => {
            leaveCommunity(id);
            useChatStore.getState().receiveCommunityLeft(id);
            router.replace("/(tabs)/communities" as any);
          },
        },
      ]);
    }
  };

  return (
    <View className="flex-1 bg-background">
      <SecondaryHeader
        title={community.name}
        subtitle={`${community.members.length} members${isAdmin ? " · You're admin" : ""}`}
      />

      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        <View className="items-center py-5">
          <Avatar name={community.name} color="#2563eb" size="xl" />
        </View>

        {isAdmin && (
          <View className="px-5 mb-7">
            <Text className="text-muted text-[13px] uppercase font-bold tracking-wide mb-3">Name</Text>
            <View className="flex-row items-center gap-2.5">
              <TextInput
                value={nameDraft}
                onChangeText={setNameDraft}
                placeholder="Community name"
                placeholderTextColor="#94a3b8"
                className="flex-1 bg-surface rounded-2xl px-5 py-3.5 text-ink text-[16px]"
              />
              <Pressable
                onPress={submitRename}
                disabled={!nameDraft.trim() || nameDraft.trim() === community.name}
                className={`px-5 py-3.5 rounded-2xl ${nameDraft.trim() && nameDraft.trim() !== community.name ? "bg-primary" : "bg-slate-200"}`}
              >
                <Text className={`text-[15px] font-bold ${nameDraft.trim() && nameDraft.trim() !== community.name ? "text-white" : "text-slate-400"}`}>
                  Rename
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        <View className="px-5 mb-7">
          <Text className="text-muted text-[13px] uppercase font-bold tracking-wide mb-3">
            Members · {community.members.length}
          </Text>
          {community.members.map((m) => {
            const isMe = m.username === me?.username;
            const memberIsAdmin = community.admin === m.username;
            return (
              <View key={m.username} className="flex-row items-center py-3 border-b border-slate-100">
                <View className="mr-3.5">
                  <Avatar name={m.name || m.username} color={m.color || "#2563eb"} size="md" />
                </View>
                <View className="flex-1">
                  <Text className="text-ink font-semibold text-[16px]">
                    {m.name || m.username}{isMe ? " (you)" : ""}
                  </Text>
                  <Text className="text-muted text-[14px]">
                    @{m.username}{memberIsAdmin ? " · Admin" : ""}
                  </Text>
                </View>
                {isAdmin && !isMe && (
                  <View className="flex-row gap-2">
                    <Pressable onPress={() => confirmRemove(m.username)} className="px-3 py-2 rounded-xl bg-red-50 active:opacity-70">
                      <Text className="text-red-600 text-[13px] font-semibold">Remove</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}
        </View>

        {isAdmin && (
          <View className="px-5 mb-8">
            <Text className="text-muted text-[13px] uppercase font-bold tracking-wide mb-3">Add people</Text>
            <View className="flex-row items-center gap-2.5">
              <TextInput
                value={inviteName}
                onChangeText={setInviteName}
                placeholder="@username"
                placeholderTextColor="#94a3b8"
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={submitInvite}
                className="flex-1 bg-surface rounded-2xl px-5 py-3.5 text-ink text-[16px]"
              />
              <Pressable
                onPress={submitInvite}
                disabled={!inviteName.trim()}
                className={`px-5 py-3.5 rounded-2xl ${inviteName.trim() ? "bg-primary" : "bg-slate-200"}`}
              >
                <Text className={`text-[15px] font-bold ${inviteName.trim() ? "text-white" : "text-slate-400"}`}>
                  Invite
                </Text>
              </Pressable>
            </View>
            {community.pendingInvites.length > 0 && (
              <View className="mt-3">
                <Text className="text-slate-400 text-[13px]">
                  Pending: {community.pendingInvites.map((p) => `@${p.username}`).join(", ")}
                </Text>
              </View>
            )}
          </View>
        )}

        <View className="px-5">
          <Pressable
            onPress={confirmDestructive}
            className="flex-row items-center justify-center gap-2 border border-red-200 rounded-2xl py-4 active:opacity-70"
          >
            <Ionicons name={isAdmin ? "trash-outline" : "exit-outline"} size={19} color="#dc2626" />
            <Text className="text-red-600 font-bold text-[16px]">
              {isAdmin ? "Delete community" : "Leave community"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
