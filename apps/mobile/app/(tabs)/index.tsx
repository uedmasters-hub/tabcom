import { useMemo, useState } from "react";
import { Text, View, Pressable, FlatList } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useChatStore } from "@/stores/chat";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Avatar } from "@/components/Avatar";
import { ConnectionRequestCard } from "@/components/ConnectionRequestCard";
import { usePendingRequests } from "@/hooks/useConnections";
import { formatListTime } from "@/lib/format-time";
import type { Conversation, Message } from "@tabcom/shared";

const presenceDot: Record<string, string> = {
  online: "#16a34a",
  away: "#eab308",
  busy: "#ef4444",
};

/** Chat — conversation list with rich last-message previews:
 *  media-type icons, read receipts, presence, per the design. */
export default function ChatScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const conversations = useChatStore((s) => s.conversations);
  const contacts = useChatStore((s) => s.contacts);
  const communities = useChatStore((s) => s.communities);
  const messages = useChatStore((s) => s.messages);
  const pending = usePendingRequests();

  const getTitle = (c: Conversation) =>
    c.kind === "community" && c.communityId
      ? communities[c.communityId]?.name ?? "Community"
      : contacts.find((x) => x.id === c.contactId)?.alias ??
        contacts.find((x) => x.id === c.contactId)?.name ?? "Unknown";

  const filtered = useMemo(() => {
    // Drop community threads whose community is gone (left/deleted).
    // These were rendering as a generic "Community" row that opened a
    // dead "Community not found" screen.
    const live = conversations.filter(
      (c) => c.kind !== "community" || (c.communityId && communities[c.communityId])
    );
    const q = query.trim().toLowerCase();
    if (!q) return live;
    return live.filter((c) => getTitle(c).toLowerCase().includes(q));
  }, [conversations, query, contacts, communities]);

  const lastMessage = (c: Conversation): Message | undefined => {
    const t = messages[c.id] ?? [];
    for (let i = t.length - 1; i >= 0; i--) {
      const m = t[i];
      if (m && m.kind !== "system") return m;
    }
    return undefined;
  };

  const Preview = ({ conv }: { conv: Conversation }) => {
    const m = lastMessage(conv);
    if (!m) return <Text className="text-muted text-[15px]">No messages yet</Text>;

    const mine = m.authorId === "me";
    const receipt = mine ? (
      m.readAt ? (
        <Ionicons name="checkmark-done" size={17} color="#2563eb" style={{ marginRight: 4 }} />
      ) : m.status === "delivered" ? (
        <Ionicons name="checkmark-done" size={17} color="#94a3b8" style={{ marginRight: 4 }} />
      ) : (
        <Ionicons name="checkmark" size={17} color="#94a3b8" style={{ marginRight: 4 }} />
      )
    ) : null;

    let icon: React.ReactNode = null;
    let label = m.text ?? "";
    if (m.kind === "voice") {
      icon = <Ionicons name="mic" size={16} color="#16a34a" style={{ marginRight: 4 }} />;
      label = m.durationMs ? `${Math.floor(m.durationMs / 60000)}:${String(Math.floor((m.durationMs % 60000) / 1000)).padStart(2, "0")}` : "Voice message";
    } else if (m.kind === "image") {
      icon = <Ionicons name="camera" size={16} color="#64748b" style={{ marginRight: 4 }} />;
      label = "Photo";
    } else if (m.kind === "location") {
      icon = <Ionicons name="location" size={16} color="#64748b" style={{ marginRight: 4 }} />;
      label = "Location";
    } else if (m.kind === "file") {
      icon = <Ionicons name="document" size={16} color="#64748b" style={{ marginRight: 4 }} />;
      label = m.fileName ?? "File";
    } else if (m.kind === "link") {
      icon = <Ionicons name="link" size={16} color="#64748b" style={{ marginRight: 4 }} />;
      label = m.url ?? "Link";
    }

    return (
      <View className="flex-row items-center mt-0.5">
        {receipt}
        {icon}
        <Text className={`text-[15px] flex-1 ${conv.unread > 0 ? "text-slate-700 font-medium" : "text-[#5b7a9d]"}`} numberOfLines={1}>
          {label}
        </Text>
      </View>
    );
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title="Chat"
        onAdd={() => router.push("/(tabs)/contacts" as any)}
        search={query}
        onSearch={setQuery}
      />
      {filtered.length === 0 ? (
        <View className="flex-1 items-center justify-center px-10">
          <Ionicons name="chatbubbles-outline" size={56} color="#cbd5e1" />
          <Text className="text-ink text-xl font-bold mt-4 mb-2">
            {query ? "No matches" : "No conversations yet"}
          </Text>
          <Text className="text-muted text-base text-center leading-6">
            {query ? "Try a different search." : "Add someone in Contacts and start chatting once they accept."}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingBottom: 24 }}
          ListHeaderComponent={
            pending.length > 0 ? (
              <View className="px-5 pt-1 pb-3">
                {pending.map((c) => (
                  <View key={c.id} className="bg-surface rounded-3xl px-4 py-4 mb-2.5">
                    <Pressable
                      onPress={() => {
                        const convId = useChatStore.getState().startConversation(c.id);
                        router.push(`/conversation/${convId}` as any);
                      }}
                      className="flex-row items-center mb-3.5 active:opacity-70"
                    >
                      <View className="mr-3.5">
                        <Avatar name={c.name} color={c.color} size="md" />
                      </View>
                      <View className="flex-1">
                        <Text className="text-ink font-bold text-[16px]">{c.name}</Text>
                        <Text className="text-muted text-[14px]">wants to connect</Text>
                      </View>
                    </Pressable>
                    <ConnectionRequestCard contact={c} variant="inline" />
                  </View>
                ))}
              </View>
            ) : null
          }
          renderItem={({ item: c }) => {
            const contact = c.kind === "dm" ? contacts.find((x) => x.id === c.contactId) : null;
            const dot = contact ? presenceDot[contact.presence] : null;
            return (
              <Pressable
                onPress={() => {
                  useChatStore.getState().openConversation(c.id);
                  router.push(
                    c.kind === "community" && c.communityId
                      ? (`/community/${c.communityId}` as any)
                      : (`/conversation/${c.id}` as any)
                  );
                }}
                className="flex-row items-center px-5 py-3 active:bg-surface"
              >
                <View className="mr-4">
                  <Avatar
                    name={getTitle(c)}
                    color={contact?.color ?? "#2563eb"}
                    size="lg"
                    presence={contact?.presence}
                  />
                </View>
                <View className="flex-1 border-b border-slate-100 py-2 flex-row items-center">
                  <View className="flex-1 mr-3">
                    <Text className="text-ink font-bold text-[19px]" numberOfLines={1}>{getTitle(c)}</Text>
                    <Preview conv={c} />
                  </View>
                  <View className="items-end gap-1.5">
                    <Text className="text-slate-400 text-[14px]">{formatListTime(c.lastMessageAt)}</Text>
                    {c.unread > 0 && (
                      <View className="bg-primary rounded-full min-w-[22px] h-[22px] px-1.5 items-center justify-center">
                        <Text className="text-white text-xs font-bold">{c.unread}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}
