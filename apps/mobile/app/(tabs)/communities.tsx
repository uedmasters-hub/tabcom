import { useState } from "react";
import {
  Text, View, Pressable, FlatList, TextInput, Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useChatStore } from "@/stores/chat";
import { useAuth } from "@/stores/auth";
import {
  createCommunity,
  respondToCommunityInvite,
} from "@/lib/realtime";

export default function CommunitiesScreen() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const communities = useChatStore((s) => s.communities);
  const communityInvites = useChatStore((s) => s.communityInvites);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const list = Object.values(communities);
  const invites = Object.values(communityInvites);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    await createCommunity(trimmed);
    setBusy(false);
    setName("");
    setCreating(false);
  };

  const handleInviteResponse = (communityId: string, action: "accept" | "decline") => {
    respondToCommunityInvite(communityId, action);
    useChatStore.getState().receiveCommunityLeft(communityId);
  };

  return (
    <View className="flex-1 bg-background">
      {/* Create button */}
      <View className="px-4 py-3 border-b border-border">
        {creating ? (
          <View className="flex-row items-center gap-2">
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Community name"
              placeholderTextColor="#5A5A68"
              autoFocus
              className="flex-1 bg-surface border border-border rounded-xl px-4 py-2.5 text-ink text-sm"
            />
            <Pressable
              onPress={handleCreate}
              disabled={!name.trim() || busy}
              className={`px-4 py-2.5 rounded-xl ${name.trim() && !busy ? "bg-primary" : "bg-slate-300"}`}
            >
              <Text className="text-ink text-sm font-semibold">Create</Text>
            </Pressable>
            <Pressable onPress={() => { setCreating(false); setName(""); }}>
              <Text className="text-muted text-sm">✕</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => setCreating(true)}
            className="bg-surface border border-border rounded-xl py-3 items-center active:opacity-70"
          >
            <Text className="text-primary font-semibold">+ New community</Text>
          </Pressable>
        )}
      </View>

      {/* Pending invites */}
      {invites.length > 0 && (
        <View className="px-4 pt-4">
          <Text className="text-muted text-xs uppercase mb-2">Pending invites</Text>
          {invites.map((inv) => (
            <View key={inv.community.id} className="bg-surface border border-border rounded-2xl p-4 mb-2">
              <Text className="text-ink font-semibold mb-1">{inv.community.name}</Text>
              <Text className="text-muted text-sm mb-3">
                Invited by @{inv.from.username}
              </Text>
              <View className="flex-row gap-2">
                <Pressable
                  onPress={() => handleInviteResponse(inv.community.id, "accept")}
                  className="flex-1 bg-primary rounded-xl py-2.5 items-center active:opacity-80"
                >
                  <Text className="text-ink font-semibold text-sm">Accept</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleInviteResponse(inv.community.id, "decline")}
                  className="flex-1 bg-surface border border-border rounded-xl py-2.5 items-center active:opacity-70"
                >
                  <Text className="text-muted text-sm">Decline</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Community list */}
      {list.length === 0 && invites.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-ink text-lg font-semibold mb-2">No communities yet</Text>
          <Text className="text-muted text-center">
            Create one or wait for an invite from a connection.
          </Text>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingVertical: 4 }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/community/${item.id}` as any)}
              className="flex-row items-center px-4 py-3 active:bg-surface"
            >
              <View className="w-11 h-11 rounded-full bg-blue-50 items-center justify-center mr-3">
                <Text className="text-primary font-bold text-lg">
                  {item.name.slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View className="flex-1">
                <Text className="text-ink font-medium">{item.name}</Text>
                <Text className="text-muted text-sm">
                  {item.members.length} {item.members.length === 1 ? "member" : "members"}
                  {item.admin === user?.username ? " · Admin" : ""}
                </Text>
              </View>
              <Text className="text-slate-400 text-lg">›</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
