import { Text, View, Pressable, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useChatStore } from "@/stores/chat";
import { formatListTime } from "@/lib/format-time";
import { Avatar } from "@/components/Avatar";
import { ConnectionRequestCard } from "@/components/ConnectionRequestCard";
import { usePendingRequests } from "@/hooks/useConnections";

/** Notifications — bell target. Connection requests + unread activity,
 *  replacing the old Inbox tab per the 4-tab design. */
export default function NotificationsScreen() {
  const router = useRouter();
  const contacts = useChatStore((s) => s.contacts);
  const connections = useChatStore((s) => s.connections);
  const conversations = useChatStore((s) => s.conversations);
  const communities = useChatStore((s) => s.communities);

  const pendingIn = usePendingRequests();
  const unread = conversations.filter((c) => c.unread > 0);

  const handleRequest = (username: string, action: "accept" | "deny") => {
    const contact = contacts.find((c) => c.username === username);
    if (contact) useChatStore.getState().respondToRequest(contact, action);
  };

  const titleOf = (c: (typeof conversations)[number]) =>
    c.kind === "community" && c.communityId
      ? communities[c.communityId]?.name ?? "Community"
      : contacts.find((x) => x.id === c.contactId)?.alias ??
        contacts.find((x) => x.id === c.contactId)?.name ?? "Unknown";

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <View className="flex-row items-center px-5 py-3">
        <Pressable onPress={() => router.back()} className="w-11 h-11 rounded-full bg-surface items-center justify-center mr-3.5 active:opacity-60">
          <Ionicons name="arrow-back" size={20} color="#0f172a" />
        </Pressable>
        <Text className="text-ink font-extrabold text-[26px]">Notifications</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        {pendingIn.length === 0 && unread.length === 0 && (
          <View className="items-center pt-24 px-10">
            <Ionicons name="notifications-off-outline" size={56} color="#cbd5e1" />
            <Text className="text-ink text-xl font-bold mt-4 mb-2">All caught up</Text>
            <Text className="text-muted text-base text-center leading-6">
              Connection requests and unread messages will appear here.
            </Text>
          </View>
        )}

        {pendingIn.length > 0 && (
          <View className="px-5 pt-3">
            <Text className="text-muted text-[13px] uppercase font-bold tracking-wide mb-3">
              Connection requests
            </Text>
            {pendingIn.map((c) => (
              <View key={c.id} className="bg-surface rounded-3xl px-4 py-4 mb-3">
                <Pressable
                  onPress={() => {
                    const convId = useChatStore.getState().startConversation(c.id);
                    router.push(`/conversation/${convId}` as any);
                  }}
                  className="flex-row items-center gap-3.5 mb-4 active:opacity-70"
                >
                  <Avatar name={c.name} color={c.color} size="md" />
                  <View className="flex-1">
                    <Text className="text-ink font-bold text-[16px]">{c.name}</Text>
                    <Text className="text-muted text-[14px]">@{c.username}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />
                </Pressable>
                <ConnectionRequestCard contact={c} variant="inline" />
              </View>
            ))}
          </View>
        )}

        {unread.length > 0 && (
          <View className="px-5 pt-3">
            <Text className="text-muted text-[13px] uppercase font-bold tracking-wide mb-3">Unread</Text>
            {unread.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => {
                  useChatStore.getState().openConversation(c.id);
                  router.push(
                    c.kind === "community" && c.communityId
                      ? (`/community/${c.communityId}` as any)
                      : (`/conversation/${c.id}` as any)
                  );
                }}
                className="flex-row items-center py-3 active:bg-surface rounded-2xl"
              >
                <View className="w-12 h-12 rounded-full bg-surface items-center justify-center mr-3.5">
                  <Text className="text-ink font-bold">{titleOf(c).slice(0, 1).toUpperCase()}</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-ink font-bold text-[16px]">{titleOf(c)}</Text>
                  <Text className="text-muted text-[14px]">{formatListTime(c.lastMessageAt)}</Text>
                </View>
                <View className="bg-primary rounded-full min-w-[22px] h-[22px] px-1.5 items-center justify-center">
                  <Text className="text-white text-xs font-bold">{c.unread}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
