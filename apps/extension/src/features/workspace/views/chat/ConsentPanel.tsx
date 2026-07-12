import { Check, Flag, ShieldBan, UserPlus, X } from "lucide-react";

import { Button, Illustration } from "../../../../components/ui";
import { useChatStore } from "../../../../stores/chat.store";
import type { Contact } from "../../../../types/chat";
import type { ConnectionStatus } from "../../../../lib/realtime";

/**
 * Takes over the chat view until a connection is ACCEPTED — the
 * illustrated moment of "you're about to let this person message you"
 * (or "you're waiting on them to"), not a small bar squeezed under an
 * empty message list. The server enforces all of this regardless —
 * this panel is honest UX on top of that.
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
  const revokeConnectRequest = useChatStore((state) => state.revokeConnectRequest);
  const block = useChatStore((state) => state.block);
  const unblock = useChatStore((state) => state.unblock);
  const report = useChatStore((state) => state.report);

  if (status === "pending_in") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-6 text-center">
        <Illustration
          name="connection-request.png"
          alt="Illustration of an incoming connection request"
          size={140}
        />

        <div className="mt-6 w-full max-w-xs rounded-2xl border border-slate-200 bg-slate-50 px-5 py-5">
          <p className="text-sm font-semibold text-blue-600">
            @{contact.username}
          </p>

          <p className="mt-2 text-xs leading-5 text-slate-500">
            By accepting, you agree to share your profile, presence and
            messages with @{contact.username}. You can block or report them
            at any time. Messages are never stored on Tabcom servers.
          </p>

          <div className="mt-4 flex gap-2">
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
        </div>

        <div className="mt-4 flex justify-center gap-5">
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
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-6 text-center">
        <Illustration
          name="connection-request.png"
          alt="Illustration of an outgoing connection request"
          size={140}
        />

        <div className="mt-6 w-full max-w-xs rounded-2xl border border-slate-200 bg-slate-50 px-5 py-5">
          <p className="text-xs leading-5 text-slate-500">
            Chatting starts only after @{contact.username} accepts.
          </p>
        </div>

        <button
          type="button"
          onClick={() => revokeConnectRequest(contact)}
          className="mt-4 flex items-center gap-1 text-xs font-medium text-slate-500 transition hover:text-red-600"
        >
          <X size={13} /> Revoke
        </button>
      </div>
    );
  }

  if (status === "blocked") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-6 text-center">
        <Illustration
          name="connection-request.png"
          alt="Illustration of a blocked connection"
          size={120}
        />
        <p className="max-w-xs text-xs leading-5 text-slate-500">
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
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-6 text-center">
      <Illustration
        name="connection-request.png"
        alt="Illustration of sending a connection request"
        size={140}
      />

      {status === "declined" && (
        <p className="mt-4 max-w-xs text-xs text-slate-500">
          Your previous request was declined.
        </p>
      )}

      <div className="mt-6 w-full max-w-xs rounded-2xl border border-slate-200 bg-slate-50 px-5 py-5">
        <p className="text-xs leading-5 text-slate-500">
          Chatting starts only after @{contact.username} accepts.
        </p>

        <Button
          fullWidth
          size="md"
          className="mt-4"
          leftIcon={<UserPlus size={15} />}
          onClick={() => requestConnect(contact)}
        >
          Send connection request
        </Button>
      </div>
    </div>
  );
}
