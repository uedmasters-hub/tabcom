import { Plus } from "lucide-react";

import { CommunityAvatar } from "../../../../components/ui";
import { useChatStore } from "../../../../stores/chat.store";
import { useWorkspaceStore } from "../../../../stores/workspace.store";

/**
 * Sits above the conversation list on the home screen — fast,
 * horizontal switching between communities, the same pattern as a
 * workspace switcher. Deliberately hidden entirely when the person
 * isn't in any communities yet, rather than showing an empty strip.
 */
export default function CommunitySwitcherStrip() {
  const communities = useChatStore((state) => state.communities);
  const openCommunityConversation = useChatStore(
    (state) => state.openCommunityConversation
  );
  const setTab = useWorkspaceStore((state) => state.setTab);

  const list = Object.values(communities);
  if (list.length === 0) return null;

  return (
    <div className="border-b border-slate-100 px-4 py-3">
      <div className="flex gap-4 overflow-x-auto">
        {list.map((community) => (
          <button
            key={community.id}
            type="button"
            onClick={() => openCommunityConversation(community.id)}
            className="flex shrink-0 flex-col items-center gap-1"
          >
            <CommunityAvatar
              name={community.name}
              imageVersion={community.imageVersion}
              communityId={community.id}
              size="md"
            />
            <span className="max-w-[56px] truncate text-[11px] text-slate-500">
              {community.name}
            </span>
          </button>
        ))}

        <button
          type="button"
          onClick={() => setTab("communities")}
          className="flex shrink-0 flex-col items-center gap-1"
          aria-label="Discover more communities"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-400 transition hover:border-slate-400 hover:text-slate-600">
            <Plus size={16} />
          </span>
          <span className="max-w-[56px] truncate text-[11px] text-slate-400">
            Discover
          </span>
        </button>
      </div>
    </div>
  );
}
