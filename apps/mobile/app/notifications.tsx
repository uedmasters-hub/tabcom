import { Text, View, Pressable, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SecondaryHeader } from "@/components/SecondaryHeader";
import { useChatStore } from "@/stores/chat";
import { formatListTime } from "@/lib/format-time";
import { Avatar } from "@/components/Avatar";
import { ConnectionRequestCard } from "@/components/ConnectionRequestCard";
import { usePendingRequests } from "@/hooks/useConnections";

export default function NotificationsScreen() {
  const router = useRouter();
  const contacts = useChatStore((s) => s.contacts);
  const conversations = useChatStore((s) => s.conversations);
  const communities = useChatStore((s) => s.communities);

  const pendingIn = usePendingRequests();
  const unread = conversations.filter((c) => c.unread > 0);

  const titleOf = (c: (typeof conversations)[number]) =>
    c.kind === "community" && c.communityId
      ? communities[c.communityId]?.name ?? "Community"
      : contacts.find((x) => x.id === c.contactId)?.alias ??
        contacts.find((x) => x.id === c.contactId)?.name ?? "Unknown";

  const colorOf = (c: (typeof conversations)[number]) => {
    if (c.kind === "community") return "#2563eb";
    const contact = contacts.find((x) => x.id === c.contactId);
    return contact?.color ?? "#2563eb";
  };

  return (
    <View className="flex-1 bg-background">
      <SecondaryHeader title="Notifications" />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        {pendingIn.length === 0 && unread.length === 0 && (
          <View className="items-center pt-24 px-10">
            <Ionicons name="notifications-off-outline" size={56} color="#cbd5e1" />
            <Text className="text-ink text-[20px] font-bold mt-4 mb-2">All caught up</Text>
            <Text className="text-muted text-base text-center leading-6">
              Connection requests and unread messages will appear here.
            </Text>
          </View>
        )}

        {pendingIn.length > 0 && (
          <View className="px-5 pt-3">
            <Text className="text-[12px] font-semibold text-slate-400 uppercase tracking-wider mb-3">
              Connection requests
            </Text>
            {pendingIn.map((c) => (
              <View key={c.id} className="bg-surface rounded-2xl px-4 py-4 mb-3">
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
                  <Ionicons name="chevron-forward" size={16} color="#d1d5db" />
                </Pressable>
                <ConnectionRequestCard contact={c} variant="inline" />
              </View>
            ))}
          </View>
        )}

        {unread.length > 0 && (
          <View className="px-5 pt-3">
            <Text className="text-[12px] font-semibold text-slate-400 uppercase tracking-wider mb-3">
              Unread
            </Text>
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
                className="flex-row items-center py-3 active:bg-surface rounded-xl px-1"
              >
                <View className="mr-3.5">
                  <Avatar name={titleOf(c)} color={colorOf(c)} size="md" />
                </View>
                <View className="flex-1">
                  <Text className="text-ink font-bold text-[16px]">{titleOf(c)}</Text>
                  <Text className="text-slate-400 text-[13px] mt-0.5">{formatListTime(c.lastMessageAt)}</Text>
                </View>
                <View className="bg-primary rounded-full min-w-[22px] h-[22px] px-1.5 items-center justify-center">
                  <Text className="text-white text-xs font-bold">{c.unread}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
