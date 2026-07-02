import { Globe } from "lucide-react";
import { EmptyState } from "../../../components/ui";

export default function CommunitiesView() {
  return (
    <EmptyState
      icon={<Globe size={24} />}
      title="No communities yet"
      description="Join or create communities to collaborate with groups around shared topics and workspaces."
    />
  );
}
