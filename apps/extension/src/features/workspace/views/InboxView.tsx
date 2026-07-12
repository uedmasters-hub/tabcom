import { useChatStore } from "../../../stores/chat.store";

import ChatView from "./chat/ChatView";
import CommunitySwitcherStrip from "./chat/CommunitySwitcherStrip";
import ConversationList from "./chat/ConversationList";

export default function InboxView() {
  const activeConversationId = useChatStore(
    (state) => state.activeConversationId
  );

  if (activeConversationId) {
    return <ChatView conversationId={activeConversationId} />;
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <CommunitySwitcherStrip />
      <ConversationList />
    </div>
  );
}
