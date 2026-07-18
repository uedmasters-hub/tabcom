import { useState } from "react";
import {
  Text, View, Pressable, FlatList, TextInput, Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useChatStore } from "@/stores/chat";
import type { Contact } from "@tabcom/shared";

const presenceColors: Record<string, string> = {
  online: "#4ade80",
  away: "#facc15",
  busy: "#ef4444",
};

/**
 * Contacts — accepted connections you've chatted with. Full
 * management: add by username (sends connection request), rename
 * (local alias), remove (silently severs connection).
 */
export default function ContactsScreen() {
  const router = useRouter();
  const contacts = useChatStore((s) => s.contacts);
  const connections = useChatStore((s) => s.connections);
  const conversations = useChatStore((s) => s.conversations);
  const messages = useChatStore((s) => s.messages);

  const [adding, setAdding] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState("");

  const hasChatted = (contactId: string) => {
    const c = conversations.find((x) => x.contactId === contactId);
    if (!c) return false;
    return (messages[c.id] ?? []).some((m) => m.kind !== "system");
  };

  // Show accepted connections + anyone with chat history
  const list = contacts.filter((c) =>
    c.id.startsWith("u-")
      ? connections[c.username] === "accepted" || hasChatted(c.id)
      : false
  );

  const submitAdd = () => {
    const username = newUsername.trim().replace(/^@/, "").toLowerCase();
    if (!username) return;
    useChatStore.getState().addContactByUsername(username);
    setNewUsername("");
    setAdding(false);
  };

  const submitRename = (contactId: string) => {
    const contact = contacts.find((c) => c.id === contactId);
    if (!contact) return;
    // renameContact isn't in the mobile chat store yet — apply locally
    // via a direct store mutation (local alias, never leaves device)
    useChatStore.setState((state) => ({
      contacts: state.contacts.map((c) =>
        c.id === contactId ? { ...c, alias: aliasDraft.trim() || undefined } : c
      ),
    }));
    setRenaming(null);
    setAliasDraft("");
  };

  const confirmRemove = (contact: Contact) => {
    Alert.alert(
      "Remove contact",
      `Remove @${contact.username}? This silently ends the connection.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => useChatStore.getState().removeContact(contact.id),
        },
      ]
    );
  };

  const openChat = (contact: Contact) => {
    const convId = useChatStore.getState().startConversation(contact.id);
    router.push(`/conversation/${convId}` as any);
  };

  return (
    <View className="flex-1 bg-background">
      {/* Add contact */}
      <View className="px-4 py-3 border-b border-border">
        {adding ? (
          <View>
            <View className="flex-row gap-2">
              <TextInput
                value={newUsername}
                onChangeText={setNewUsername}
                placeholder="@username"
                placeholderTextColor="#5A5A68"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                className="flex-1 bg-surface border border-border rounded-xl px-4 py-2.5 text-ink text-sm"
              />
              <Pressable
                onPress={submitAdd}
                disabled={!newUsername.trim()}
                className={`px-4 py-2.5 rounded-xl ${newUsername.trim() ? "bg-primary" : "bg-slate-300"}`}
              >
                <Text className="text-ink text-sm font-semibold">Request</Text>
              </Pressable>
              <Pressable onPress={() => { setAdding(false); setNewUsername(""); }}>
                <Text className="text-muted text-sm py-2.5">✕</Text>
              </Pressable>
            </View>
            <Text className="text-slate-400 text-xs mt-2">
              Sends a connection request — they appear here after accepting.
            </Text>
          </View>
        ) : (
          <Pressable
            onPress={() => setAdding(true)}
            className="bg-surface border border-border rounded-xl py-3 items-center active:opacity-70"
          >
            <Text className="text-primary font-semibold">+ Add contact by username</Text>
          </Pressable>
        )}
      </View>

      {list.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-ink text-lg font-semibold mb-2">No contacts yet</Text>
          <Text className="text-muted text-center">
            People appear here once you've connected and exchanged messages.
          </Text>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(item) => item.id}
          renderItem={({ item: contact }) => {
            const color = presenceColors[contact.presence];

            if (renaming === contact.id) {
              return (
                <View className="flex-row items-center px-4 py-3 gap-2">
                  <TextInput
                    value={aliasDraft}
                    onChangeText={setAliasDraft}
                    placeholder={contact.name}
                    placeholderTextColor="#5A5A68"
                    autoFocus
                    className="flex-1 bg-surface border border-border rounded-xl px-4 py-2 text-ink text-sm"
                  />
                  <Pressable onPress={() => submitRename(contact.id)} className="bg-primary rounded-xl px-3 py-2">
                    <Text className="text-ink text-sm">Save</Text>
                  </Pressable>
                  <Pressable onPress={() => setRenaming(null)}>
                    <Text className="text-muted text-sm py-2">✕</Text>
                  </Pressable>
                </View>
              );
            }

            return (
              <View className="flex-row items-center px-4 py-3">
                <Pressable onPress={() => openChat(contact)} className="flex-row items-center flex-1">
                  <View className="relative mr-3">
                    <View
                      style={{ backgroundColor: contact.color }}
                      className="w-11 h-11 rounded-full items-center justify-center"
                    >
                      <Text className="text-ink font-bold">
                        {(contact.alias ?? contact.name).slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                    {color && (
                      <View
                        style={{ backgroundColor: color }}
                        className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-ink"
                      />
                    )}
                  </View>
                  <View className="flex-1">
                    <Text className="text-ink font-medium">
                      {contact.alias ?? contact.name}
                      {contact.alias ? (
                        <Text className="text-muted text-xs font-normal"> ({contact.name})</Text>
                      ) : null}
                    </Text>
                    <Text className="text-muted text-xs">
                      @{contact.username} · {contact.presence}
                    </Text>
                  </View>
                </Pressable>

                <View className="flex-row gap-1">
                  <Pressable
                    onPress={() => { setAliasDraft(contact.alias ?? ""); setRenaming(contact.id); }}
                    className="px-2 py-1.5 bg-surface border border-border rounded-lg"
                  >
                    <Text className="text-muted text-[10px]">Rename</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => confirmRemove(contact)}
                    className="px-2 py-1.5 bg-surface border border-red-200 rounded-lg"
                  >
                    <Text className="text-red-600 text-[10px]">Remove</Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
      )}

      <View className="px-4 py-4">
        <Text className="text-slate-400 text-xs">
          Renames are local nicknames — only you see them. Removing silently ends the connection.
        </Text>
      </View>
    </View>
  );
}
