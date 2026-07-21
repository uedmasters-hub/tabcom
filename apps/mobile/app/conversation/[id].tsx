import { useEffect, useState } from "react";
import { Text } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useChatStore } from "@/stores/chat";
import { ChatThread } from "@/components/ChatThread";

/** DM thread — delegates entirely to the shared ChatThread so DMs,
 *  groups and communities behave identically. */
export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // The switcher swaps threads in place — the route param is only the
  // STARTING conversation, not the source of truth thereafter.
  const [activeId, setActiveId] = useState(id);
  useEffect(() => { if (id) setActiveId(id); }, [id]);
  const conversation = useChatStore((s) => s.conversations.find((c) => c.id === activeId));
  const contacts = useChatStore((s) => s.contacts);
  const communities = useChatStore((s) => s.communities);

  if (!conversation || !activeId) {
    return (
      <SafeAreaView className="flex-1 bg-background items-center justify-center">
        <Text className="text-muted text-base">Conversation not found</Text>
      </SafeAreaView>
    );
  }

  if (conversation.kind === "community" && conversation.communityId) {
    const community = communities[conversation.communityId];
    return (
      <ChatThread
        conversationId={activeId}
        onSwitchConversation={setActiveId}
        peer={{
          title: community?.name ?? "Community",
          subtitle: community ? `${community.members.length} members` : undefined,
          color: "#2563eb",
        }}
      />
    );
  }

  const contact = contacts.find((c) => c.id === conversation.contactId);
  return (
    <ChatThread
      conversationId={activeId}
      onSwitchConversation={setActiveId}
      peer={{
        title: contact?.alias ?? contact?.name ?? "Unknown",
        subtitle: contact?.presence,
        color: contact?.color ?? "#2563eb",
        presence: contact?.presence,
        username: contact?.username,
      }}
    />
  );
}
