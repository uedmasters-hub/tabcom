import { Check, Flag, ShieldBan, UserPlus, X } from "lucide-react";

import { Button } from "../../../../components/ui";
import { useChatStore } from "../../../../stores/chat.store";
import type { Contact } from "../../../../types/chat";
import type { ConnectionStatus } from "../../../../lib/realtime";

/**
 * Replaces the composer until a connection is ACCEPTED.
 * Covers every state of the consent lifecycle. The server enforces all
 * of this regardless — this panel is honest UX on top of that.
 */
export default function ConsentPanel({
  contact,
  status,
}: {
  contact: Contact;
  status: ConnectionStatus;
}) {
  const requestConnect = useChatStore((state) => state.requestConnect);
  const respondToRequest = useChatStore((state) => state.respondToRequest);
  const block = useChatStore((state) => state.block);
  const unblock = useChatStore((state) => state.unblock);
  const report = useChatStore((state) => state.report);

  if (status === "pending_in") {
    return (
      <div className="border-t border-slate-200 bg-slate-50 px-5 py-4">
        <p className="text-sm font-semibold">
          @{contact.username} wants to connect
        </p>

        <p className="mt-1.5 text-xs leading-5 text-slate-500">
          By accepting, you agree to share your profile, presence and
          messages with @{contact.username}. You can block or report them
          at any time. Messages are never stored on Tabcom servers.
        </p>

        <div className="mt-3 flex gap-2">
          <Button
            size="md"
            className="flex-1"
            leftIcon={<Check size={15} />}
            onClick={() => respondToRequest(contact, "accept")}
          >
            Accept
          </Button>

          <Button
            size="md"
            variant="outline"
            className="flex-1"
            leftIcon={<X size={15} />}
            onClick={() => respondToRequest(contact, "deny")}
          >
            Deny
          </Button>
        </div>

        <div className="mt-2 flex justify-center gap-5">
          <button
            type="button"
            onClick={() => block(contact)}
            className="flex items-center gap-1 text-xs font-medium text-slate-500 transition hover:text-red-600"
          >
            <ShieldBan size={13} /> Block
          </button>

          <button
            type="button"
            onClick={() => report(contact, "Reported from connection request")}
            className="flex items-center gap-1 text-xs font-medium text-slate-500 transition hover:text-red-600"
          >
            <Flag size={13} /> Report
          </button>
        </div>
      </div>
    );
  }

  if (status === "pending_out") {
    return (
      <div className="border-t border-slate-200 bg-slate-50 px-6 py-4">
        <p className="text-center text-xs leading-5 text-slate-500">
          Request sent. You'll be able to chat once @{contact.username}
          {" "}accepts.
        </p>
      </div>
    );
  }

  if (status === "blocked") {
    return (
      <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3.5">
        <p className="text-xs leading-5 text-slate-500">
          You blocked @{contact.username}. Unblocking won't reconnect you —
          a new request is required.
        </p>

        <Button size="md" variant="outline" onClick={() => unblock(contact)}>
          Unblock
        </Button>
      </div>
    );
  }

  // "none" or "declined"
  return (
    <div className="border-t border-slate-200 bg-slate-50 px-5 py-4">
      {status === "declined" && (
        <p className="mb-2 text-center text-xs text-slate-500">
          Your previous request was declined.
        </p>
      )}

      <Button
        fullWidth
        size="md"
        leftIcon={<UserPlus size={15} />}
        onClick={() => requestConnect(contact)}
      >
        Send connection request
      </Button>

      <p className="mt-2 text-center text-xs leading-5 text-slate-400">
        Chatting starts only after @{contact.username} accepts.
      </p>
    </div>
  );
}
