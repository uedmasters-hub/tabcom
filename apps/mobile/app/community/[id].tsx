import { useEffect, useState } from "react";
import { Text, View, Pressable, FlatList, Linking } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useChatStore } from "@/stores/chat";
import { useAuth } from "@/stores/auth";
import { ChatThread } from "@/components/ChatThread";
import { BoardItemCard } from "@/components/BoardItemCard";

type Tab = "chat" | "board";

/** Community detail — Chat tab uses the SAME ChatThread as DMs, so the
 *  experience is identical across chats, groups and communities. */
export default function CommunityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const [tab, setTab] = useState<Tab>("chat");

  const community = useChatStore((s) => (id ? s.communities[id] : undefined));
  const conversations = useChatStore((s) => s.conversations);

  useEffect(() => {
    if (id) useChatStore.getState().openCommunityConversation(id);
  }, [id]);

  if (!community || !id) {
    return (
      <SafeAreaView className="flex-1 bg-background items-center justify-center">
        <Text className="text-muted text-base">Community not found</Text>
      </SafeAreaView>
    );
  }

  const conversation = conversations.find((c) => c.communityId === id);
  const isAdmin = community.admin === user?.username;

  if (tab === "chat" && conversation) {
    return (
      <View className="flex-1 bg-background">
        <ChatThread
          conversationId={conversation.id}
          peer={{
            title: community.name,
            subtitle: `${community.members.length} members`,
            color: "#2563eb",
          }}
          onHeaderAction={() => setTab("board")}
          headerActionIcon="albums-outline"
        />
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <View className="flex-row items-center px-4 py-3">
        <Pressable onPress={() => setTab("chat")} hitSlop={8} className="pr-2 active:opacity-50">
          <Ionicons name="chevron-back" size={30} color="#2563eb" />
        </Pressable>
        <View className="flex-1">
          <Text className="text-ink font-bold text-[21px]" numberOfLines={1}>{community.name}</Text>
          <Text className="text-muted text-[13px]">Board · {community.board.length} tabs</Text>
        </View>
        <Pressable
          onPress={() => router.push(`/community/manage/${id}` as any)}
          className="w-11 h-11 rounded-full bg-surface items-center justify-center active:opacity-60"
        >
          <Ionicons name="settings-outline" size={22} color="#334155" />
        </Pressable>
      </View>

      <FlatList
        data={community.board}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16 }}
        className="flex-1"
        ListEmptyComponent={
          <View className="items-center py-16">
            <Ionicons name="albums-outline" size={52} color="#cbd5e1" />
            <Text className="text-ink font-bold text-lg mt-4">No tabs shared yet</Text>
            <Text className="text-muted text-center mt-1">Tabs are added from the extension.</Text>
          </View>
        }
        renderItem={({ item }) => <BoardItemCard item={item} communityId={id} isAdmin={isAdmin} />}
      />
    </SafeAreaView>
  );
}
