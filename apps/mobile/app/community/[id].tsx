import { useEffect, useRef, useState } from "react";
import {
  Text, View, Pressable, FlatList, TextInput,
  KeyboardAvoidingView, Platform, Linking,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useChatStore } from "@/stores/chat";
import { useAuth } from "@/stores/auth";
import { MessageBubble } from "@/components/MessageBubble";
import { BoardItemCard } from "@/components/BoardItemCard";

type Tab = "chat" | "board";

export default function CommunityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const [tab, setTab] = useState<Tab>("chat");
  const [text, setText] = useState("");
  const listRef = useRef<FlatList>(null);

  const community = useChatStore((s) => (id ? s.communities[id] : undefined));
  const conversations = useChatStore((s) => s.conversations);
  const messages = useChatStore((s) => s.messages);

  // Find or create conversation for this community
  useEffect(() => {
    if (id) useChatStore.getState().openCommunityConversation(id);
    return () => useChatStore.getState().closeConversation();
  }, [id]);

  if (!community || !id) {
    return (
      <SafeAreaView className="flex-1 bg-background items-center justify-center">
        <Text className="text-muted">Community not found</Text>
      </SafeAreaView>
    );
  }

  const conversation = conversations.find((c) => c.communityId === id);
  const thread = conversation ? messages[conversation.id] ?? [] : [];
  const isAdmin = community.admin === user?.username;

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed || !conversation) return;
    useChatStore.getState().sendText(conversation.id, trimmed);
    setText("");
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <Pressable onPress={() => router.back()} className="mr-3">
          <Text className="text-muted text-lg">←</Text>
        </Pressable>
        <View className="flex-1">
          <Text className="text-ink font-semibold text-base" numberOfLines={1}>
            {community.name}
          </Text>
          <Text className="text-muted text-xs">
            {community.members.length} members
          </Text>
        </View>
        <Pressable
          onPress={() => router.push(`/community/manage/${id}` as any)}
          className="px-3 py-1.5 bg-surface border border-border rounded-lg active:opacity-70"
        >
          <Text className="text-slate-600 text-xs">Manage</Text>
        </Pressable>
      </View>

      {/* Tab switcher */}
      <View className="flex-row border-b border-border">
        {(["chat", "board"] as Tab[]).map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            className={`flex-1 py-3 items-center ${tab === t ? "border-b-2 border-primary" : ""}`}
          >
            <Text className={tab === t ? "text-primary font-semibold text-sm" : "text-muted text-sm"}>
              {t === "chat" ? "Chat" : `Board (${community.board.length})`}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === "chat" ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="flex-1"
        >
          <FlatList
            ref={listRef}
            data={thread.filter((m) => m.kind !== "system" || m.text)}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => (
              <MessageBubble
                message={item}
                onRetry={() =>
                  conversation && useChatStore.getState().retryMessage(conversation.id, item.id)
                }
              />
            )}
            contentContainerStyle={{ paddingVertical: 8 }}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          />
          <View className="flex-row items-end px-3 py-2 border-t border-border bg-surface">
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Message…"
              placeholderTextColor="#5A5A68"
              multiline
              className="flex-1 bg-surface border border-border rounded-2xl px-4 py-3 text-ink text-sm max-h-24 mr-2"
            />
            <Pressable
              onPress={send}
              disabled={!text.trim()}
              className={`w-10 h-10 rounded-full items-center justify-center ${
                text.trim() ? "bg-primary" : "bg-slate-300"
              }`}
            >
              <Text className="text-ink font-bold">↑</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      ) : (
        /* Board tab — read-only tabs + comments + open in browser */
        <FlatList
          data={community.board}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          ListEmptyComponent={
            <View className="items-center py-12">
              <Text className="text-muted">No tabs shared yet.</Text>
              <Text className="text-slate-400 text-xs mt-1">
                Tabs are added from the extension.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <BoardItemCard
              item={item}
              communityId={id}
              isAdmin={isAdmin}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}
