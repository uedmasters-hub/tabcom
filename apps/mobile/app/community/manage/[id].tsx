import { useState } from "react";
import {
  Text, View, Pressable, ScrollView, TextInput, Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useChatStore } from "@/stores/chat";
import { useAuth } from "@/stores/auth";
import {
  renameCommunity,
  inviteToCommunity,
  removeCommunityMember,
  transferCommunityAdmin,
  cancelCommunityInvite,
  leaveCommunity,
  deleteCommunity,
} from "@/lib/realtime";

export default function CommunityManageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const community = useChatStore((s) => (id ? s.communities[id] : undefined));
  const contacts = useChatStore((s) => s.contacts);
  const connections = useChatStore((s) => s.connections);

  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [inviteUsername, setInviteUsername] = useState("");

  if (!community || !id) {
    return (
      <SafeAreaView className="flex-1 bg-background items-center justify-center">
        <Text className="text-muted">Community not found</Text>
      </SafeAreaView>
    );
  }

  const isAdmin = community.admin === user?.username;

  const submitRename = () => {
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== community.name) {
      renameCommunity(id, trimmed);
    }
    setRenaming(false);
  };

  const handleInvite = () => {
    const username = inviteUsername.trim().replace(/^@/, "").toLowerCase();
    if (!username) return;
    inviteToCommunity(id, username);
    setInviteUsername("");
  };

  const confirmRemove = (username: string) => {
    Alert.alert(
      "Remove member",
      `Remove @${username} from ${community.name}?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => removeCommunityMember(id, username) },
      ]
    );
  };

  const confirmTransfer = (username: string) => {
    Alert.alert(
      "Transfer admin",
      `Make @${username} the admin? You'll become a regular member.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Transfer", onPress: () => transferCommunityAdmin(id, username) },
      ]
    );
  };

  const confirmLeave = () => {
    Alert.alert("Leave community", `Leave ${community.name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Leave", style: "destructive",
        onPress: () => { leaveCommunity(id); router.back(); router.back(); },
      },
    ]);
  };

  const confirmDelete = () => {
    Alert.alert("Delete community", `Permanently delete ${community.name}? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: () => { deleteCommunity(id); router.back(); router.back(); },
      },
    ]);
  };

  const eligibleContacts = contacts.filter(
    (c) =>
      c.id.startsWith("u-") &&
      connections[c.username] === "accepted" &&
      !community.members.some((m) => m.username === c.username) &&
      !community.pendingInvites.some((p) => p.username === c.username)
  );

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <Pressable onPress={() => router.back()} className="mr-3">
          <Text className="text-muted text-lg">←</Text>
        </Pressable>
        <Text className="text-ink font-semibold text-base flex-1">Manage community</Text>
      </View>

      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Name */}
        <View className="mt-4 mb-6">
          <Text className="text-muted text-xs uppercase mb-2">Name</Text>
          {renaming ? (
            <View className="flex-row gap-2">
              <TextInput
                value={nameDraft}
                onChangeText={setNameDraft}
                autoFocus
                maxLength={60}
                className="flex-1 bg-surface border border-border rounded-xl px-4 py-2.5 text-ink text-sm"
              />
              <Pressable onPress={submitRename} className="bg-primary rounded-xl px-4 py-2.5">
                <Text className="text-ink text-sm font-semibold">Save</Text>
              </Pressable>
              <Pressable onPress={() => setRenaming(false)}>
                <Text className="text-muted text-sm py-2.5">✕</Text>
              </Pressable>
            </View>
          ) : (
            <View className="flex-row items-center justify-between">
              <Text className="text-ink text-base">{community.name}</Text>
              {isAdmin && (
                <Pressable
                  onPress={() => { setNameDraft(community.name); setRenaming(true); }}
                  className="px-3 py-1.5 bg-surface border border-border rounded-lg"
                >
                  <Text className="text-slate-600 text-xs">Rename</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>

        {/* Members */}
        <Text className="text-muted text-xs uppercase mb-2">
          Members ({community.members.length})
        </Text>
        {community.members.map((m) => {
          const isMeAdmin = isAdmin;
          const isMemberAdmin = m.username === community.admin;
          const isMe = m.username === user?.username;

          return (
            <View key={m.username} className="flex-row items-center py-3 border-b border-border/50">
              <View
                style={{ backgroundColor: m.color }}
                className="w-9 h-9 rounded-full items-center justify-center mr-3"
              >
                <Text className="text-ink font-bold text-sm">
                  {m.name.slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View className="flex-1">
                <Text className="text-ink text-sm">
                  {m.name} {isMe ? "(you)" : ""}
                </Text>
                <Text className="text-muted text-xs">
                  @{m.username} {isMemberAdmin ? "· Admin" : ""}
                </Text>
              </View>
              {isMeAdmin && !isMe && (
                <View className="flex-row gap-2">
                  <Pressable
                    onPress={() => confirmTransfer(m.username)}
                    className="px-2 py-1.5 bg-surface border border-border rounded-lg"
                  >
                    <Text className="text-muted text-[10px]">Make admin</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => confirmRemove(m.username)}
                    className="px-2 py-1.5 bg-surface border border-red-200 rounded-lg"
                  >
                    <Text className="text-red-600 text-[10px]">Remove</Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        })}

        {/* Pending invites */}
        {community.pendingInvites.length > 0 && (
          <>
            <Text className="text-muted text-xs uppercase mb-2 mt-6">
              Pending invites ({community.pendingInvites.length})
            </Text>
            {community.pendingInvites.map((p) => (
              <View key={p.username} className="flex-row items-center py-3 border-b border-border/50">
                <Text className="text-slate-600 text-sm flex-1">@{p.username}</Text>
                <Text className="text-slate-400 text-xs mr-2">{p.attemptsLeft} left</Text>
                {isAdmin && (
                  <Pressable
                    onPress={() => cancelCommunityInvite(id, p.username)}
                    className="px-2 py-1 bg-surface border border-border rounded-lg"
                  >
                    <Text className="text-muted text-xs">Cancel</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </>
        )}

        {/* Invite people */}
        {isAdmin && (
          <>
            <Text className="text-muted text-xs uppercase mb-2 mt-6">Add people</Text>
            <View className="flex-row gap-2 mb-2">
              <TextInput
                value={inviteUsername}
                onChangeText={setInviteUsername}
                placeholder="@username"
                placeholderTextColor="#5A5A68"
                autoCapitalize="none"
                autoCorrect={false}
                className="flex-1 bg-surface border border-border rounded-xl px-4 py-2.5 text-ink text-sm"
              />
              <Pressable
                onPress={handleInvite}
                disabled={!inviteUsername.trim()}
                className={`px-4 py-2.5 rounded-xl ${inviteUsername.trim() ? "bg-primary" : "bg-slate-300"}`}
              >
                <Text className="text-ink text-sm font-semibold">Invite</Text>
              </Pressable>
            </View>
            {eligibleContacts.length > 0 && (
              <View className="flex-row flex-wrap gap-2 mb-4">
                {eligibleContacts.slice(0, 8).map((c) => (
                  <Pressable
                    key={c.id}
                    onPress={() => { inviteToCommunity(id, c.username); }}
                    className="bg-surface border border-border rounded-full px-3 py-1.5 active:opacity-70"
                  >
                    <Text className="text-slate-600 text-xs">@{c.username}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </>
        )}

        {/* Danger zone */}
        <View className="mt-8 mb-4">
          {isAdmin ? (
            <Pressable
              onPress={confirmDelete}
              className="bg-surface border border-red-200 rounded-xl py-3 items-center active:opacity-70"
            >
              <Text className="text-red-600 font-semibold">Delete community</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={confirmLeave}
              className="bg-surface border border-border rounded-xl py-3 items-center active:opacity-70"
            >
              <Text className="text-red-600 font-semibold">Leave community</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
