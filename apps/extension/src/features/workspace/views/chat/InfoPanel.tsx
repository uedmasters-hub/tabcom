import {
  Bell,
  BellOff,
  Eye,
  EyeOff,
  ExternalLink,
  Flag,
  ShieldBan,
  Trash2,
  X,
} from "lucide-react";

import { browser } from "wxt/browser";

import { Avatar, SectionLabel } from "../../../../components/ui";
import { useChatStore } from "../../../../stores/chat.store";
import { contactLabel } from "../../../../types/chat";
import type { Contact, Conversation } from "../../../../types/chat";

/**
 * Slide-over detail panel for 1:1 chats: the other person's public
 * details (username always; real name and photo because their profile
 * is public), plus privacy controls — mute, shared links, clear
 * history, block/unblock, hide-presence, remove contact, report.
 *
 * Community detail/management now lives in its own dedicated view
 * (features/workspace/views/community/CommunityManageView.tsx) — see
 * ChatView's showInfo branch. This panel only ever renders for DMs.
 */
export default function InfoPanel({
  conversation,
  contact,
  onClose,
}: {
  conversation: Conversation;
  contact?: Contact;
  onClose: () => void;
}) {
  const connections = useChatStore((state) => state.connections);
  const messages = useChatStore(
    (state) => state.messages[conversation.id] ?? null
  );
  const muted = useChatStore((state) => state.muted);
  const hiddenFrom = useChatStore((state) => state.hiddenFrom);

  const toggleMute = useChatStore((state) => state.toggleMute);
  const toggleHidePresence = useChatStore((state) => state.toggleHidePresence);
  const removeContact = useChatStore((state) => state.removeContact);
  const clearHistory = useChatStore((state) => state.clearHistory);
  const block = useChatStore((state) => state.block);
  const unblock = useChatStore((state) => state.unblock);
  const report = useChatStore((state) => state.report);

  if (!contact) return null;

  const targetId = conversation.contactId ?? "";
  const isMutedTarget = muted.includes(targetId);
  const isLiveContact = contact.id.startsWith("u-");

  const sharedLinks = (messages ?? []).filter(
    (message) => message.kind === "link" && message.url
  );

  const actionRow =
    "flex w-full items-center gap-3 px-6 py-3.5 text-left text-sm font-medium transition hover:bg-slate-50";

  return (
    <div className="absolute inset-0 z-20 flex flex-col overflow-y-auto bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <p className="text-sm font-semibold">Contact info</p>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close info"
          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
        >
          <X size={18} />
        </button>
      </div>

      {/* Identity */}
      <div className="flex flex-col items-center px-6 py-6 text-center">
        <Avatar
          name={contact.name}
          color={contact.color}
          photo={contact.photo}
          size="xl"
        />
        <h2 className="mt-3 text-lg font-bold">{contactLabel(contact)}</h2>
        <p className="text-sm text-slate-500">
          @{contact.username}
          {contact.alias && ` · ${contact.name}`}
        </p>
        <p className="mt-1 text-xs capitalize text-slate-400">
          {contact.presence} ·{" "}
          {isLiveContact ? "Public profile" : "Demo contact"} ·{" "}
          {connections[contact.username] ?? "connected"}
        </p>
      </div>

      {/* Shared links */}
      {sharedLinks.length > 0 && (
        <>
          <SectionLabel className="mt-6 px-6">
            Shared links · {sharedLinks.length}
          </SectionLabel>
          <ul className="mt-2">
            {sharedLinks.slice(-8).map((message) => (
              <li key={message.id}>
                <button
                  type="button"
                  onClick={() => browser.tabs.create({ url: message.url })}
                  className="flex w-full items-start gap-2.5 px-6 py-2.5 text-left transition hover:bg-slate-50"
                >
                  <ExternalLink
                    size={15}
                    className="mt-0.5 shrink-0 text-slate-400"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {message.text}
                    </span>
                    <span className="block truncate text-xs text-slate-400">
                      {message.url}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Privacy & chat actions */}
      <SectionLabel className="mt-6 px-6">Privacy & chat</SectionLabel>
      <div className="mt-2 pb-8">
        <button
          type="button"
          className={actionRow}
          onClick={() => toggleMute(targetId)}
        >
          {isMutedTarget ? (
            <Bell size={17} className="text-slate-400" />
          ) : (
            <BellOff size={17} className="text-slate-400" />
          )}
          {isMutedTarget ? "Unmute notifications" : "Mute notifications"}
        </button>

        <button
          type="button"
          className={actionRow}
          onClick={() => clearHistory(conversation.id)}
        >
          <Trash2 size={17} className="text-slate-400" />
          Clear chat history (this device)
        </button>

        {isLiveContact &&
          (connections[contact.username] === "blocked" ? (
            <button
              type="button"
              className={actionRow}
              onClick={() => unblock(contact)}
            >
              <ShieldBan size={17} className="text-slate-400" />
              Unblock @{contact.username}
            </button>
          ) : (
            <button
              type="button"
              className={`${actionRow} text-red-600`}
              onClick={() => block(contact)}
            >
              <ShieldBan size={17} />
              Block @{contact.username}
            </button>
          ))}

        {isLiveContact && (
          <button
            type="button"
            className={actionRow}
            onClick={() => toggleHidePresence(contact)}
          >
            {hiddenFrom.includes(contact.id) ? (
              <Eye size={17} className="text-slate-400" />
            ) : (
              <EyeOff size={17} className="text-slate-400" />
            )}
            {hiddenFrom.includes(contact.id)
              ? `Show my presence to @${contact.username}`
              : `Appear offline to @${contact.username}`}
          </button>
        )}

        {isLiveContact && (
          <button
            type="button"
            className={`${actionRow} text-red-600`}
            onClick={() => {
              removeContact(contact.id);
              onClose();
            }}
          >
            <Trash2 size={17} />
            Remove contact
          </button>
        )}

        {isLiveContact && (
          <button
            type="button"
            className={`${actionRow} text-red-600`}
            onClick={() => report(contact, "Reported from contact info")}
          >
            <Flag size={17} />
            Report @{contact.username}
          </button>
        )}
      </div>
    </div>
  );
}
