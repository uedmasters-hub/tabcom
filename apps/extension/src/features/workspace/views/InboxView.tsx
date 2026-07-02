import { MessageSquarePlus, Inbox as InboxIcon } from "lucide-react";
import { Button, EmptyState } from "../../../components/ui";

export default function InboxView() {
  return (
    <EmptyState
      icon={<InboxIcon size={24} />}
      title="No conversations yet"
      description="Direct messages and group conversations will appear here once messaging goes live."
      action={
        <Button size="md" leftIcon={<MessageSquarePlus size={16} />} disabled>
          New message
        </Button>
      }
    />
  );
}
