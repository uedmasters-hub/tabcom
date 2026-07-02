import { UserPlus, Users } from "lucide-react";
import { Button, EmptyState } from "../../../components/ui";

export default function ContactsView() {
  return (
    <EmptyState
      icon={<Users size={24} />}
      title="No contacts yet"
      description="Invite people or discover public profiles to start building your network."
      action={
        <Button
          size="md"
          variant="outline"
          leftIcon={<UserPlus size={16} />}
          disabled
        >
          Invite people
        </Button>
      }
    />
  );
}
