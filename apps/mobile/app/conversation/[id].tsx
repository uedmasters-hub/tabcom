import { useEffect, useRef, useState } from "react";
import {
  Text, View, TextInput, Pressable, FlatList,
  KeyboardAvoidingView, Platform,
} from "react-native";
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

  useEffect(() => {
    if (id) useChatStore.getState().openConversation(id);
    return () => useChatStore.getState().closeConversation();
  }, [id]);

  if (!conversation || !id) {
    return (
      <SafeAreaView className="flex-1 bg-ink items-center justify-center">
        <Text className="text-neutral-500">Conversation not found</Text>
      </SafeAreaView>
    );
  }

  const isDm = conversation.kind === "dm";
  const contact = isDm ? contacts.find((c) => c.id === conversation.contactId) : null;

  const title = isDm
    ? contact?.alias ?? contact?.name ?? "Unknown"
    : conversation.communityId
      ? communities[conversation.communityId]?.name ?? "Community"
      : "Unknown";

  const isTyping = contact ? typing.includes(contact.id) : false;

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    useChatStore.getState().sendText(id, trimmed);
    setText("");
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const visibleMessages = messages.filter((m) => m.kind !== "system" || m.text);

  return (
    <SafeAreaView className="flex-1 bg-ink" edges={["top"]}>
      <View className="flex-row items-center px-4 py-3 border-b border-line">
        <Pressable onPress={() => router.back()} className="mr-3">
          <Text className="text-neutral-400 text-lg">←</Text>
        </Pressable>
        <View className="flex-1">
          <Text className="text-white font-semibold text-base" numberOfLines={1}>
            {title}
          </Text>
          {isTyping && <Text className="text-accent text-xs">typing…</Text>}
          {contact && !isTyping && (
            <Text className="text-neutral-500 text-xs">{contact.presence}</Text>
          )}
        </View>
        {/* Call button for DMs only */}
        {isDm && contact && (
          <CallButton peer={{ username: contact.username, name: contact.name, color: contact.color }} />
        )}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={listRef}
          data={visibleMessages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              onRetry={() => useChatStore.getState().retryMessage(id, item.id)}
            />
          )}
          contentContainerStyle={{ paddingVertical: 8 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        />

        <View className="flex-row items-end px-3 py-2 border-t border-line bg-surface">
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Message…"
            placeholderTextColor="#5A5A68"
            multiline
            className="flex-1 bg-card border border-line rounded-2xl px-4 py-3 text-white text-sm max-h-24 mr-2"
          />
          <Pressable
            onPress={send}
            disabled={!text.trim()}
            className={`w-10 h-10 rounded-full items-center justify-center ${
              text.trim() ? "bg-accent" : "bg-accent/40"
            }`}
          >
            <Text className="text-white font-bold">↑</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
