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
    <View className="flex-1 bg-ink">
      {/* Create button */}
      <View className="px-4 py-3 border-b border-line">
        {creating ? (
          <View className="flex-row items-center gap-2">
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Community name"
              placeholderTextColor="#5A5A68"
              autoFocus
              className="flex-1 bg-card border border-line rounded-xl px-4 py-2.5 text-white text-sm"
            />
            <Pressable
              onPress={handleCreate}
              disabled={!name.trim() || busy}
              className={`px-4 py-2.5 rounded-xl ${name.trim() && !busy ? "bg-accent" : "bg-accent/40"}`}
            >
              <Text className="text-white text-sm font-semibold">Create</Text>
            </Pressable>
            <Pressable onPress={() => { setCreating(false); setName(""); }}>
              <Text className="text-neutral-500 text-sm">✕</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => setCreating(true)}
            className="bg-card border border-line rounded-xl py-3 items-center active:opacity-70"
          >
            <Text className="text-accent font-semibold">+ New community</Text>
          </Pressable>
        )}
      </View>

      {/* Pending invites */}
      {invites.length > 0 && (
        <View className="px-4 pt-4">
          <Text className="text-neutral-500 text-xs uppercase mb-2">Pending invites</Text>
          {invites.map((inv) => (
            <View key={inv.community.id} className="bg-card border border-line rounded-2xl p-4 mb-2">
              <Text className="text-white font-semibold mb-1">{inv.community.name}</Text>
              <Text className="text-neutral-500 text-sm mb-3">
                Invited by @{inv.from.username}
              </Text>
              <View className="flex-row gap-2">
                <Pressable
                  onPress={() => handleInviteResponse(inv.community.id, "accept")}
                  className="flex-1 bg-accent rounded-xl py-2.5 items-center active:opacity-80"
                >
                  <Text className="text-white font-semibold text-sm">Accept</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleInviteResponse(inv.community.id, "decline")}
                  className="flex-1 bg-card border border-line rounded-xl py-2.5 items-center active:opacity-70"
                >
                  <Text className="text-neutral-400 text-sm">Decline</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Community list */}
      {list.length === 0 && invites.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-white text-lg font-semibold mb-2">No communities yet</Text>
          <Text className="text-neutral-500 text-center">
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
              className="flex-row items-center px-4 py-3 active:bg-card"
            >
              <View className="w-11 h-11 rounded-full bg-accent/20 items-center justify-center mr-3">
                <Text className="text-accent font-bold text-lg">
                  {item.name.slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View className="flex-1">
                <Text className="text-white font-medium">{item.name}</Text>
                <Text className="text-neutral-500 text-sm">
                  {item.members.length} {item.members.length === 1 ? "member" : "members"}
                  {item.admin === user?.username ? " · Admin" : ""}
                </Text>
              </View>
              <Text className="text-neutral-600 text-lg">›</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
