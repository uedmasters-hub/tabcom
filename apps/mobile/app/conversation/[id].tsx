import { useEffect, useRef, useState } from "react";
import { Text, View, TextInput, Pressable, FlatList, KeyboardAvoidingView, Platform } from "react-native";
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

  useEffect(() => { if (id) useChatStore.getState().openConversation(id); return () => useChatStore.getState().closeConversation(); }, [id]);

  if (!conversation || !id) return <SafeAreaView className="flex-1 bg-background items-center justify-center"><Text className="text-muted">Conversation not found</Text></SafeAreaView>;

  const isDm = conversation.kind === "dm";
  const contact = isDm ? contacts.find((c) => c.id === conversation.contactId) : null;
  const title = isDm ? contact?.alias ?? contact?.name ?? "Unknown" : conversation.communityId ? communities[conversation.communityId]?.name ?? "Community" : "Unknown";
  const isTyping = contact ? typing.includes(contact.id) : false;

  const send = () => { const t = text.trim(); if (!t) return; useChatStore.getState().sendText(id, t); setText(""); setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100); };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <View className="flex-row items-center px-6 py-4 border-b border-border">
        <Pressable onPress={() => router.back()} className="mr-3"><Text className="text-muted text-lg">←</Text></Pressable>
        <View className="flex-1">
          <Text className="text-ink font-bold text-base" numberOfLines={1}>{title}</Text>
          {isTyping && <Text className="text-primary text-xs">typing…</Text>}
          {contact && !isTyping && <Text className="text-muted text-xs">{contact.presence}</Text>}
        </View>
        {isDm && contact && <CallButton peer={{ username: contact.username, name: contact.name, color: contact.color }} />}
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        <FlatList ref={listRef} data={messages.filter((m) => m.kind !== "system" || m.text)} keyExtractor={(m) => m.id} renderItem={({ item }) => <MessageBubble message={item} onRetry={() => useChatStore.getState().retryMessage(id, item.id)} />} contentContainerStyle={{ paddingVertical: 8 }} onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })} />
        <View className="flex-row items-end px-4 py-3 border-t border-border">
          <TextInput value={text} onChangeText={setText} placeholder="Message…" placeholderTextColor="#94a3b8" multiline className="flex-1 border border-border rounded-xl px-4 py-3 text-ink text-sm max-h-24 mr-2" />
          <Pressable onPress={send} disabled={!text.trim()} className={`w-10 h-10 rounded-xl items-center justify-center ${text.trim() ? "bg-slate-900" : "bg-slate-200"}`}>
            <Text className={text.trim() ? "text-white font-bold" : "text-slate-400 font-bold"}>↑</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
