import {
  Check,
  MoreVertical,
  Pencil,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";

import { Avatar, Button, EmptyState, Input } from "../../../components/ui";
import { cn } from "../../../lib/cn";
import { useChatStore } from "../../../stores/chat.store";
import { contactLabel } from "../../../types/chat";
import { useWorkspaceStore } from "../../../stores/workspace.store";

const presenceColors = {
  online: "bg-emerald-500",
  away: "bg-amber-400",
  busy: "bg-red-500",
  offline: "bg-slate-300",
} as const;

/**
 * Contacts — people you've CONNECTED with (accepted) and chatted with,
 * plus demo contacts in offline mode. Full management: add by username,
 * rename (local alias), remove (silently severs the connection).
 */
export default function ContactsView() {
  const contacts = useChatStore((state) => state.contacts);
  const connections = useChatStore((state) => state.connections);
  const conversations = useChatStore((state) => state.conversations);
  const messages = useChatStore((state) => state.messages);
  const startConversation = useChatStore((state) => state.startConversation);
  const addContactByUsername = useChatStore(
    (state) => state.addContactByUsername
  );
  const renameContact = useChatStore((state) => state.renameContact);
  const removeContact = useChatStore((state) => state.removeContact);
  const setTab = useWorkspaceStore((state) => state.setTab);

  const [adding, setAdding] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState("");

  const hasChatted = (contactId: string) => {
    const conversation = conversations.find(
      (item) => item.contactId === contactId
    );
    if (!conversation) return false;
    return (messages[conversation.id] ?? []).some(
      (message) => message.kind !== "system"
    );
  };

  const list = contacts.filter((contact) =>
    contact.id.startsWith("u-")
      ? connections[contact.username] === "accepted" && hasChatted(contact.id)
      : true
  );

  const submitAdd = () => {
    if (!newUsername.trim()) return;
    addContactByUsername(newUsername);
    setNewUsername("");
    setAdding(false);
    setTab("inbox");
  };

  const submitRename = (contactId: string) => {
    renameContact(contactId, aliasDraft);
    setRenaming(null);
    setAliasDraft("");
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* Add contact */}
      <div className="px-6 pt-4">
        {adding ? (
          <div className="flex gap-2">
            <Input
              placeholder="@username"
              value={newUsername}
              onChange={(event) => setNewUsername(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitAdd();
              }}
              className="h-10"
            />
            <Button size="md" onClick={submitAdd}>
              Request
            </Button>
            <Button size="md" variant="ghost" onClick={() => setAdding(false)}>
              <X size={16} />
            </Button>
          </div>
        ) : (
          <Button
            size="md"
            variant="outline"
            fullWidth
            leftIcon={<UserPlus size={15} />}
            onClick={() => setAdding(true)}
          >
            Add contact by username
          </Button>
        )}
        {adding && (
          <p className="mt-2 text-xs leading-5 text-slate-400">
            This sends a connection request — they appear here after
            accepting and chatting.
          </p>
        )}
      </div>

      {list.length === 0 ? (
        <EmptyState
          className="py-10"
          icon={<Users size={24} />}
          title="No contacts yet"
          description="People appear here once you've connected AND exchanged messages. Find people in Communities → Discover."
        />
      ) : (
        <ul className="mt-4">
          {list.map((contact) => (
            <li key={contact.id} className="relative">
              {renaming === contact.id ? (
                <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-3">
                  <Avatar
                    name={contactLabel(contact)}
                    color={contact.color}
                    photo={contact.photo}
                    size="sm"
                  />
                  <Input
                    autoFocus
                    placeholder={contact.name}
                    value={aliasDraft}
                    onChange={(event) => setAliasDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") submitRename(contact.id);
                      if (event.key === "Escape") setRenaming(null);
                    }}
                    className="h-9"
                  />
                  <Button size="md" onClick={() => submitRename(contact.id)}>
                    <Check size={15} />
                  </Button>
                </div>
              ) : (
                <div className="flex w-full items-center gap-3 border-b border-slate-100 px-6 py-4 transition hover:bg-slate-50">
                  <button
                    type="button"
                    onClick={() => {
                      startConversation(contact.id);
                      setTab("inbox");
                    }}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <div className="relative">
                      <Avatar
                        name={contactLabel(contact)}
                        color={contact.color}
                        photo={contact.photo}
                        size="md"
                      />
                      <span
                        className={cn(
                          "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white",
                          presenceColors[contact.presence]
                        )}
                      />
                    </div>

                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {contactLabel(contact)}
                        {contact.alias && (
                          <span className="ml-1.5 text-xs font-normal text-slate-400">
                            ({contact.name})
                          </span>
                        )}
                      </span>
                      <span className="block text-sm text-slate-500">
                        @{contact.username} · {contact.presence}
                      </span>
                    </span>
                  </button>

                  <button
                    type="button"
                    aria-label={`Options for ${contactLabel(contact)}`}
                    onClick={() =>
                      setMenuFor(menuFor === contact.id ? null : contact.id)
                    }
                    className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
                  >
                    <MoreVertical size={16} />
                  </button>
                </div>
              )}

              {menuFor === contact.id && (
                <>
                  <button
                    type="button"
                    aria-label="Close menu"
                    className="fixed inset-0 z-20 cursor-default"
                    onClick={() => setMenuFor(null)}
                  />
                  <div className="absolute right-6 top-14 z-30 w-44 rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg">
                    <button
                      type="button"
                      onClick={() => {
                        setAliasDraft(contact.alias ?? "");
                        setRenaming(contact.id);
                        setMenuFor(null);
                      }}
                      className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm font-medium transition hover:bg-slate-50"
                    >
                      <Pencil size={14} className="text-slate-400" />
                      Rename
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        removeContact(contact.id);
                        setMenuFor(null);
                      }}
                      className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm font-medium text-red-600 transition hover:bg-red-50"
                    >
                      <Trash2 size={14} />
                      Remove contact
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="px-6 py-4 text-xs leading-5 text-slate-400">
        Renames are local nicknames — only you see them. Removing a contact
        silently ends the connection; reconnecting needs a new request.
      </p>
    </div>
  );
}
