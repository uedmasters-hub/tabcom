import { useChatStore } from "../../../stores/chat.store";

import ChatView from "./chat/ChatView";
import ConversationList from "./chat/ConversationList";

export default function InboxView() {
  const activeConversationId = useChatStore(
    (state) => state.activeConversationId
  );

  if (activeConversationId) {
    return <ChatView conversationId={activeConversationId} />;
  }

  return <ConversationList />;
}
