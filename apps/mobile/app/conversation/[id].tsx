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

  const conversation = useChatStore((s) => s.conversations.find((c) => c.id === activeId));
  const contacts = useChatStore((s) => s.contacts);
  const communities = useChatStore((s) => s.communities);
  const startConversation = useChatStore((s) => s.startConversation);

  // Deep links from push notifications route to /conversation/u-<username>
  // (a CONTACT id), but conversation `.id`s are random uids the server
  // can't know. Resolve the incoming param: if it already matches a
  // conversation use it; if it's a contact id (u-… / c-…) ensure the
  // conversation exists and switch to its real id. This is what turns a
  // tapped notification into an open thread instead of "not found".
  useEffect(() => {
    if (!id) return;
    const state = useChatStore.getState();
    const direct = state.conversations.find((c) => c.id === id);
    if (direct) {
      setActiveId(direct.id);
      return;
    }
    if (id.startsWith("u-") || id.startsWith("c-")) {
      // ensureConversation creates the thread even if the contact isn't
      // in the roster yet (cold start) — the header fills in once the
      // roster syncs, which is far better than a dead-end screen.
      setActiveId(startConversation(id));
    }
  }, [id, startConversation]);

  // Notification tap while already inside a conversation screen —
  // switch the open thread in place instead of stacking another route.
  const pendingSwitch = useChatStore((s) => s.pendingSwitchConversationId);
  useEffect(() => {
    if (!pendingSwitch) return;
    setActiveId(pendingSwitch);
    useChatStore.getState().clearPendingSwitch();
    useChatStore.getState().pulseIncomingRefresh(pendingSwitch);
  }, [pendingSwitch]);

  // While a contact-id deep link is resolving into a real conversation,
  // don't flash "not found".
  const resolving =
    !conversation && !!id && (id.startsWith("u-") || id.startsWith("c-"));

  if (!conversation || !activeId) {
    if (resolving) {
      return <SafeAreaView className="flex-1 bg-background" />;
    }
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
        photoUri: contact?.photo,
      }}
    />
  );
}
