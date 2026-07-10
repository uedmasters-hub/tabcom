import { LogOut, Trash2, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useChatStore } from "../../../../stores/chat.store";
import type { Community } from "../../../../types/chat";

export default function DangerZoneSection({
  community,
  isAdmin,
  onClose,
}: {
  community: Community;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const leaveCommunity = useChatStore((state) => state.leaveCommunity);
  const deleteCommunity = useChatStore((state) => state.deleteCommunity);
  const closeConversation = useChatStore((state) => state.closeConversation);

  return (
    <div className="flex flex-col gap-3 px-6 py-6">
      {!isAdmin && (
        <ConfirmableAction
          label="Leave community"
          confirmLabel="Leave — you'll need a new invite to rejoin"
          icon={<LogOut size={16} />}
          onConfirm={() => {
            leaveCommunity(community.id);
            onClose();
            closeConversation();
          }}
        />
      )}

      {isAdmin && (
        <>
          <p className="text-xs leading-5 text-slate-400">
            You're the admin — transfer ownership to another member first
            (Members tab) if you just want to step back, or delete the
            community outright below.
          </p>
          <ConfirmableAction
            label="Delete community"
            confirmLabel="Delete permanently — this can't be undone"
            icon={<Trash2 size={16} />}
            onConfirm={() => {
              deleteCommunity(community.id);
              onClose();
              closeConversation();
            }}
          />
        </>
      )}
    </div>
  );
}

function ConfirmableAction({
  label,
  confirmLabel,
  icon,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  icon: ReactNode;
  onConfirm: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3">
        <button
          type="button"
          onClick={onConfirm}
          className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white"
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          aria-label="Cancel"
          className="rounded-lg border border-slate-200 p-2.5 text-slate-500"
        >
          <X size={15} />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="flex items-center gap-2.5 rounded-xl border border-slate-200 px-4 py-3 text-left text-sm font-medium text-red-600 transition hover:border-red-200 hover:bg-red-50"
    >
      {icon}
      {label}
    </button>
  );
}
