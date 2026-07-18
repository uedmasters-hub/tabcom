import { Text, View, Pressable, FlatList } from "react-native";
import { useRouter } from "expo-router";
import { useChatStore } from "@/stores/chat";
import { useAuth } from "@/stores/auth";
import type { Conversation } from "@tabcom/shared";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`;
  return `${Math.floor(diff / 86400_000)}d`;
}

/**
 * Inbox — all conversations with unread messages or recent activity,
 * plus pending connection requests surfaced as system notices. Mirrors
 * the extension's InboxView which shows the ConversationList. On
 * mobile, the Chats tab already shows DM conversations, so Inbox
 * focuses on showing ALL activity (DMs + community chats) with unread
 * badges, giving a unified notification-style view.
 */
export default function InboxScreen() {
  const router = useRouter();
  const conversations = useChatStore((s) => s.conversations);
  const contacts = useChatStore((s) => s.contacts);
  const communities = useChatStore((s) => s.communities);
  const connections = useChatStore((s) => s.connections);
  const messages = useChatStore((s) => s.messages);
  const user = useAuth((s) => s.user);

  // Pending incoming connection requests
  const pendingIn = contacts.filter(
    (c) => c.id.startsWith("u-") && connections[c.username] === "pending_in"
  );

  // Conversations with unread
  const unreadConvos = conversations.filter((c) => c.unread > 0);
  // Recent (last 20) with any activity
  const recent = conversations.slice(0, 20);

  const getTitle = (c: Conversation): string => {
    if (c.kind === "community" && c.communityId) {
      return communities[c.communityId]?.name ?? "Community";
    }
    const contact = contacts.find((x) => x.id === c.contactId);
    return contact?.alias ?? contact?.name ?? "Unknown";
  };

  const getLastText = (c: Conversation): string => {
    const thread = messages[c.id] ?? [];
    const last = thread[thread.length - 1];
    return last?.text || "No messages";
  };

  const openConversation = (c: Conversation) => {
    useChatStore.getState().openConversation(c.id);
    if (c.kind === "community" && c.communityId) {
      router.push(`/community/${c.communityId}` as any);
    } else {
      router.push(`/conversation/${c.id}` as any);
    }
  };

  const handleAccept = (username: string) => {
    const contact = contacts.find((c) => c.username === username);
    if (contact) useChatStore.getState().respondToRequest(contact, "accept");
  };
  const handleDeny = (username: string) => {
    const contact = contacts.find((c) => c.username === username);
    if (contact) useChatStore.getState().respondToRequest(contact, "deny");
  };

  const totalUnread = conversations.reduce((n, c) => n + c.unread, 0);

  return (
    <View className="flex-1 bg-ink">
      {/* Connection requests */}
      {pendingIn.length > 0 && (
        <View className="px-4 pt-4 pb-2">
          <Text className="text-neutral-500 text-xs uppercase mb-2">
            Connection requests ({pendingIn.length})
          </Text>
          {pendingIn.map((c) => (
            <View key={c.id} className="bg-card border border-line rounded-2xl p-4 mb-2">
              <View className="flex-row items-center gap-3 mb-3">
                <View
                  style={{ backgroundColor: c.color }}
                  className="w-9 h-9 rounded-full items-center justify-center"
                >
                  <Text className="text-white font-bold text-sm">
                    {c.name.slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-white font-medium">{c.name}</Text>
                  <Text className="text-neutral-500 text-xs">@{c.username}</Text>
                </View>
              </View>
              <View className="flex-row gap-2">
                <Pressable
                  onPress={() => handleAccept(c.username)}
                  className="flex-1 bg-accent rounded-xl py-2.5 items-center active:opacity-80"
                >
                  <Text className="text-white font-semibold text-sm">Accept</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleDeny(c.username)}
                  className="flex-1 bg-card border border-line rounded-xl py-2.5 items-center active:opacity-70"
                >
                  <Text className="text-neutral-400 text-sm">Deny</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Unread summary */}
      {totalUnread > 0 && (
        <View className="px-4 py-2">
          <Text className="text-accent text-sm font-semibold">
            {totalUnread} unread {totalUnread === 1 ? "message" : "messages"}
          </Text>
        </View>
      )}

      {/* All recent conversations */}
      {recent.length === 0 && pendingIn.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-white text-lg font-semibold mb-2">Inbox is empty</Text>
          <Text className="text-neutral-500 text-center">
            Messages and requests will show up here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={recent}
          keyExtractor={(item) => item.id}
          renderItem={({ item: c }) => (
            <Pressable
              onPress={() => openConversation(c)}
              className="flex-row items-center px-4 py-3 active:bg-card"
            >
              <View className="w-10 h-10 rounded-full bg-card items-center justify-center mr-3">
                <Text className="text-white font-bold text-sm">
                  {getTitle(c).slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View className="flex-1 mr-2">
                <Text
                  className={`font-medium ${c.unread > 0 ? "text-white" : "text-neutral-400"}`}
                  numberOfLines={1}
                >
                  {getTitle(c)}
                  {c.kind === "community" ? " 🏘️" : ""}
                </Text>
                <Text className="text-neutral-500 text-sm" numberOfLines={1}>
                  {getLastText(c)}
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
          )}
        />
      )}
    </View>
  );
}
