import { Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useChatStore } from "@/stores/chat";
import { ChatThread } from "@/components/ChatThread";

/** DM thread — delegates entirely to the shared ChatThread so DMs,
 *  groups and communities behave identically. */
export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversation = useChatStore((s) => s.conversations.find((c) => c.id === id));
  const contacts = useChatStore((s) => s.contacts);
  const communities = useChatStore((s) => s.communities);

  if (!conversation || !id) {
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
        conversationId={id}
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
      conversationId={id}
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
