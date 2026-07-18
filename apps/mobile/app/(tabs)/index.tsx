import { Text, View, Pressable, FlatList } from "react-native";
import { useRouter } from "expo-router";
import { useChatStore } from "@/stores/chat";
import { useRealtime } from "@/stores/realtime";
import type { Conversation } from "@tabcom/shared";

function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return "now";
  if (d < 3600_000) return `${Math.floor(d / 60_000)}m`;
  if (d < 86400_000) return `${Math.floor(d / 3600_000)}h`;
  return `${Math.floor(d / 86400_000)}d`;
}

export default function ChatsScreen() {
  const router = useRouter();
  const { connected } = useRealtime();
  const conversations = useChatStore((s) => s.conversations);
  const contacts = useChatStore((s) => s.contacts);
  const communities = useChatStore((s) => s.communities);
  const messages = useChatStore((s) => s.messages);

  const getTitle = (c: Conversation) => c.kind === "community" && c.communityId ? communities[c.communityId]?.name ?? "Community" : contacts.find((x) => x.id === c.contactId)?.alias ?? contacts.find((x) => x.id === c.contactId)?.name ?? "Unknown";
  const getPresenceColor = (c: Conversation) => { if (c.kind !== "dm") return null; const ct = contacts.find((x) => x.id === c.contactId); return ct?.presence === "online" ? "#16a34a" : ct?.presence === "away" ? "#d97706" : null; };
  const getLastMsg = (c: Conversation) => { const t = messages[c.id] ?? []; return t[t.length - 1]?.text || "No messages yet"; };

  return (
    <View className="flex-1 bg-background">
      <View className="flex-row items-center gap-2 px-6 py-2">
        <View className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500" : "bg-amber-400"}`} />
        <Text className={`text-xs font-semibold uppercase tracking-wide ${connected ? "text-emerald-600" : "text-amber-600"}`}>
          {connected ? "Live" : "Connecting"}
        </Text>
      </View>
      {conversations.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-ink text-lg font-semibold mb-2">No conversations yet</Text>
          <Text className="text-muted text-center">Discover people in Communities, send a connection request, and chat once they accept.</Text>
        </View>
      ) : (
        <FlatList data={conversations} keyExtractor={(i) => i.id} renderItem={({ item: c }) => {
          const pc = getPresenceColor(c);
          return (
            <Pressable onPress={() => { useChatStore.getState().openConversation(c.id); router.push(c.kind === "community" && c.communityId ? `/community/${c.communityId}` as any : `/conversation/${c.id}` as any); }} className="flex-row items-center px-6 py-4 border-b border-border active:bg-surface">
              <View className="relative mr-3">
                <View style={{ backgroundColor: contacts.find((x) => x.id === c.contactId)?.color ?? "#2563eb" }} className="w-10 h-10 rounded-full items-center justify-center">
                  <Text className="text-white font-semibold text-sm">{getTitle(c).slice(0, 1).toUpperCase()}</Text>
                </View>
                {pc && <View style={{ backgroundColor: pc }} className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white" />}
              </View>
              <View className="flex-1 mr-2">
                <Text className={`text-sm ${c.unread > 0 ? "font-semibold text-ink" : "font-medium text-ink"}`} numberOfLines={1}>{getTitle(c)}</Text>
                <Text className="text-muted text-sm" numberOfLines={1}>{getLastMsg(c)}</Text>
              </View>
              <View className="items-end">
                <Text className="text-slate-400 text-xs">{timeAgo(c.lastMessageAt)}</Text>
                {c.unread > 0 && <View className="bg-primary rounded-full px-1.5 py-0.5 mt-1 min-w-[18px] items-center"><Text className="text-white text-[10px] font-semibold">{c.unread}</Text></View>}
              </View>
            </Pressable>
          );
        }} />
      )}
    </View>
  );
}
