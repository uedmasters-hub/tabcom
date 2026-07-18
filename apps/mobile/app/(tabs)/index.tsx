import { Text, View, Pressable, FlatList } from "react-native";
import { useRouter } from "expo-router";
import { useChatStore } from "@/stores/chat";
import { useRealtime } from "@/stores/realtime";
import { useAuth } from "@/stores/auth";
import type { Conversation, Contact, Community } from "@tabcom/shared";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`;
  return `${Math.floor(diff / 86400_000)}d`;
}

export default function ChatsScreen() {
  const router = useRouter();
  const { connected } = useRealtime();
  const conversations = useChatStore((s) => s.conversations);
  const contacts = useChatStore((s) => s.contacts);
  const communities = useChatStore((s) => s.communities);
  const messages = useChatStore((s) => s.messages);

  const getTitle = (c: Conversation): string => {
    if (c.kind === "community" && c.communityId) {
      return communities[c.communityId]?.name ?? "Community";
    }
    const contact = contacts.find((x) => x.id === c.contactId);
    return contact?.alias ?? contact?.name ?? "Unknown";
  };

  const getPresenceColor = (c: Conversation): string | null => {
    if (c.kind !== "dm") return null;
    const contact = contacts.find((x) => x.id === c.contactId);
    if (!contact) return null;
    return contact.presence === "online" ? "#4ade80" : contact.presence === "away" ? "#facc15" : null;
  };

  const getLastMessage = (c: Conversation): string => {
    const thread = messages[c.id] ?? [];
    const last = thread[thread.length - 1];
    if (!last) return "No messages yet";
    return last.text || "Media";
  };

  const openConversation = (c: Conversation) => {
    useChatStore.getState().openConversation(c.id);
    router.push(`/conversation/${c.id}` as any);
  };

  return (
    <View className="flex-1 bg-ink">
      <View className="flex-row items-center gap-2 px-4 py-2">
        <View className={`w-2 h-2 rounded-full ${connected ? "bg-green-400" : "bg-red-400"}`} />
        <Text className="text-neutral-500 text-xs">
          {connected ? "Connected" : "Connecting…"}
        </Text>
      </View>

      {conversations.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-white text-lg font-semibold mb-2">No conversations yet</Text>
          <Text className="text-neutral-500 text-center">
            Start a chat from the Contacts tab, or wait for someone to message you.
          </Text>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          renderItem={({ item: c }) => {
            const presenceColor = getPresenceColor(c);
            return (
              <Pressable
                onPress={() => openConversation(c)}
                className="flex-row items-center px-4 py-3 active:bg-card"
              >
                <View className="w-11 h-11 rounded-full bg-card items-center justify-center mr-3">
                  <Text className="text-white font-bold">
                    {getTitle(c).slice(0, 1).toUpperCase()}
                  </Text>
                  {presenceColor && (
                    <View
                      style={{ backgroundColor: presenceColor }}
                      className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-ink"
                    />
                  )}
                </View>
                <View className="flex-1 mr-2">
                  <Text className="text-white font-medium" numberOfLines={1}>
                    {getTitle(c)}
                  </Text>
                  <Text className="text-neutral-500 text-sm" numberOfLines={1}>
                    {getLastMessage(c)}
                  </Text>
                </View>
                <View className="items-end">
                  <Text className="text-neutral-600 text-xs">{timeAgo(c.lastMessageAt)}</Text>
                  {c.unread > 0 && (
                    <View className="bg-accent rounded-full px-1.5 py-0.5 mt-1 min-w-[20px] items-center">
                      <Text className="text-white text-[10px] font-bold">{c.unread}</Text>
                    </View>
                  )}
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}
