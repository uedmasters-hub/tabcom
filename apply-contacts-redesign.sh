#!/bin/bash
set -euo pipefail

# ─── Contacts redesign: community-grouped, light theme ───────────────
# Run from: tabcom root
# Overwrites: apps/mobile/app/(tabs)/contacts.tsx
#
# Matches the provided mockup:
#   - Horizontal community filter strip (All + each community + Add)
#   - "All" view: every contact, with Remove (severs connection)
#   - Community view: members first (Remove = remove from community,
#     admin only), then non-members with ADD (= invite to community)
#   - Light theme per the extension design system
# ──────────────────────────────────────────────────────────────────────

if [ ! -f "package.json" ] || ! grep -q '"tabcom"' package.json; then
  echo "❌ Run this from the tabcom monorepo root."
  exit 1
fi

cat > "apps/mobile/app/(tabs)/contacts.tsx" << 'CTEOF'
import { useMemo, useState } from "react";
import {
  Text, View, Pressable, FlatList, TextInput, Alert, ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { useChatStore } from "@/stores/chat";
import { useAuth } from "@/stores/auth";
import {
  inviteToCommunity,
  removeCommunityMember,
} from "@/lib/realtime";
import type { Contact } from "@tabcom/shared";

const presenceColors: Record<string, string> = {
  online: "#16a34a",
  away: "#d97706",
  busy: "#dc2626",
};

const AVATAR_PALETTE = ["#2563eb", "#7c3aed", "#0d9488", "#e11d48", "#d97706", "#16a34a"];

/**
 * Contacts — grouped by community, per the design mockup.
 *
 * Filter strip: All | <each community> | + Add
 * - All: every accepted/chatted contact. Action: Remove (severs connection).
 * - Community selected: members of that community first (Remove — admin
 *   only, removes from community), then remaining contacts with ADD
 *   (invites them to the community).
 */
export default function ContactsScreen() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const contacts = useChatStore((s) => s.contacts);
  const connections = useChatStore((s) => s.connections);
  const conversations = useChatStore((s) => s.conversations);
  const messages = useChatStore((s) => s.messages);
  const communities = useChatStore((s) => s.communities);

  const [selected, setSelected] = useState<string>("all"); // "all" | communityId
  const [adding, setAdding] = useState(false);
  const [newUsername, setNewUsername] = useState("");

  const communityList = Object.values(communities);
  const selectedCommunity = selected === "all" ? null : communities[selected];

  const hasChatted = (contactId: string) => {
    const c = conversations.find((x) => x.contactId === contactId);
    if (!c) return false;
    return (messages[c.id] ?? []).some((m) => m.kind !== "system");
  };

  // Base contact list: accepted connections + anyone with chat history
  const allContacts = useMemo(
    () =>
      contacts.filter((c) =>
        c.id.startsWith("u-")
          ? connections[c.username] === "accepted" || hasChatted(c.id)
          : false
      ),
    [contacts, connections, conversations, messages]
  );

  // Partition for community view
  const { members, nonMembers } = useMemo(() => {
    if (!selectedCommunity) return { members: allContacts, nonMembers: [] as Contact[] };
    const memberUsernames = new Set(selectedCommunity.members.map((m) => m.username));
    return {
      members: allContacts.filter((c) => memberUsernames.has(c.username)),
      nonMembers: allContacts.filter((c) => !memberUsernames.has(c.username)),
    };
  }, [allContacts, selectedCommunity]);

  const isAdminOfSelected = selectedCommunity?.admin === user?.username;

  const submitAdd = () => {
    const username = newUsername.trim().replace(/^@/, "").toLowerCase();
    if (!username) return;
    useChatStore.getState().addContactByUsername(username);
    setNewUsername("");
    setAdding(false);
  };

  const confirmRemoveConnection = (contact: Contact) => {
    Alert.alert(
      "Remove contact",
      `Remove @${contact.username}? This silently ends the connection.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => useChatStore.getState().removeContact(contact.id) },
      ]
    );
  };

  const confirmRemoveFromCommunity = (contact: Contact) => {
    if (!selectedCommunity) return;
    Alert.alert(
      "Remove from community",
      `Remove @${contact.username} from ${selectedCommunity.name}?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => removeCommunityMember(selectedCommunity.id, contact.username) },
      ]
    );
  };

  const handleInviteToCommunity = (contact: Contact) => {
    if (!selectedCommunity) return;
    inviteToCommunity(selectedCommunity.id, contact.username);
    Alert.alert("Invite sent", `@${contact.username} was invited to ${selectedCommunity.name}.`);
  };

  const openChat = (contact: Contact) => {
    const convId = useChatStore.getState().startConversation(contact.id);
    router.push(`/conversation/${convId}` as any);
  };

  const communityInitialColor = (idx: number) => AVATAR_PALETTE[idx % AVATAR_PALETTE.length];

  const pendingInviteUsernames = new Set(
    selectedCommunity?.pendingInvites.map((p) => p.username) ?? []
  );

  const renderContact = (contact: Contact, action: "remove-connection" | "remove-member" | "add-member") => {
    const dot = presenceColors[contact.presence];
    const isPendingInvite = pendingInviteUsernames.has(contact.username);
    return (
      <View key={contact.id} className="flex-row items-center px-6 py-3.5 border-b border-border">
        <Pressable onPress={() => openChat(contact)} className="flex-row items-center flex-1">
          <View className="relative mr-3.5">
            <View style={{ backgroundColor: contact.color }} className="w-12 h-12 rounded-full items-center justify-center">
              <Text className="text-white font-bold text-base">
                {(contact.alias ?? contact.name).slice(0, 1).toUpperCase()}
              </Text>
            </View>
            {dot && (
              <View style={{ backgroundColor: dot }} className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white" />
            )}
          </View>
          <View className="flex-1">
            <Text className="text-ink font-semibold text-base">
              {contact.alias ?? contact.name}
            </Text>
            <Text className="text-muted text-sm">
              @{contact.username} · {contact.presence}
            </Text>
          </View>
        </Pressable>

        {action === "remove-connection" && (
          <Pressable onPress={() => confirmRemoveConnection(contact)} className="active:opacity-60">
            <Text className="text-muted text-sm">Remove</Text>
          </Pressable>
        )}
        {action === "remove-member" && isAdminOfSelected && (
          <Pressable onPress={() => confirmRemoveFromCommunity(contact)} className="active:opacity-60">
            <Text className="text-muted text-sm">Remove</Text>
          </Pressable>
        )}
        {action === "add-member" && (
          isPendingInvite ? (
            <Text className="text-slate-400 text-xs font-semibold uppercase">Invited</Text>
          ) : (
            <Pressable onPress={() => handleInviteToCommunity(contact)} className="active:opacity-60">
              <Text className="text-primary text-sm font-bold uppercase">Add</Text>
            </Pressable>
          )
        )}
      </View>
    );
  };

  return (
    <View className="flex-1 bg-background">
      {/* Community filter strip */}
      <View className="border-b border-border pb-1">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 20 }}>
          {/* All */}
          <Pressable onPress={() => setSelected("all")} className="items-center">
            <View className={`w-14 h-14 rounded-full items-center justify-center ${selected === "all" ? "bg-primary" : "bg-blue-100"}`}>
              <Text className={`font-bold text-lg ${selected === "all" ? "text-white" : "text-primary"}`}>A</Text>
            </View>
            <Text className={`text-xs mt-1.5 ${selected === "all" ? "text-ink font-bold" : "text-muted"}`}>All</Text>
            {selected === "all" && <View className="h-0.5 bg-ink w-10 mt-1 rounded-full" />}
          </Pressable>

          {/* Communities */}
          {communityList.map((c, idx) => (
            <Pressable key={c.id} onPress={() => setSelected(c.id)} className="items-center">
              <View style={{ backgroundColor: communityInitialColor(idx) }} className={`w-14 h-14 rounded-full items-center justify-center ${selected === c.id ? "" : "opacity-70"}`}>
                <Text className="text-white font-bold text-lg">{c.name.slice(0, 1).toUpperCase()}</Text>
              </View>
              <Text className={`text-xs mt-1.5 ${selected === c.id ? "text-ink font-bold" : "text-muted"}`} numberOfLines={1} style={{ maxWidth: 70 }}>
                {c.name}
              </Text>
              {selected === c.id && <View className="h-0.5 bg-ink w-10 mt-1 rounded-full" />}
            </Pressable>
          ))}

          {/* Add contact */}
          <Pressable onPress={() => setAdding(!adding)} className="items-center">
            <View className="w-14 h-14 rounded-full items-center justify-center border-2 border-dashed border-slate-300">
              <Text className="text-ink text-2xl font-light">+</Text>
            </View>
            <Text className="text-xs mt-1.5 text-ink font-bold uppercase">Add</Text>
          </Pressable>
        </ScrollView>
      </View>

      {/* Add contact inline form */}
      {adding && (
        <View className="px-6 py-3 border-b border-border">
          <View className="flex-row gap-2">
            <TextInput
              value={newUsername}
              onChangeText={setNewUsername}
              placeholder="@username"
              placeholderTextColor="#94a3b8"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              className="flex-1 border border-border rounded-xl px-4 py-2.5 text-ink text-sm"
            />
            <Pressable onPress={submitAdd} disabled={!newUsername.trim()} className={`px-4 py-2.5 rounded-xl ${newUsername.trim() ? "bg-slate-900" : "bg-slate-300"}`}>
              <Text className="text-white text-sm font-semibold">Request</Text>
            </Pressable>
            <Pressable onPress={() => { setAdding(false); setNewUsername(""); }} className="py-2.5">
              <Text className="text-muted text-sm">✕</Text>
            </Pressable>
          </View>
          <Text className="text-slate-400 text-xs mt-2">
            Sends a connection request — they appear here after accepting.
          </Text>
        </View>
      )}

      {/* Contact list */}
      {allContacts.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-ink text-lg font-semibold mb-2">No contacts yet</Text>
          <Text className="text-muted text-center">
            Add someone by username, or connect through a community.
          </Text>
        </View>
      ) : (
        <FlatList
          data={[]}
          renderItem={null}
          ListHeaderComponent={
            <View>
              {selected === "all" ? (
                allContacts.map((c) => renderContact(c, "remove-connection"))
              ) : (
                <>
                  {members.map((c) => renderContact(c, "remove-member"))}
                  {nonMembers.length > 0 && members.length > 0 && (
                    <View className="px-6 py-2 bg-surface">
                      <Text className="text-muted text-xs uppercase font-semibold">
                        Not in {selectedCommunity?.name}
                      </Text>
                    </View>
                  )}
                  {nonMembers.map((c) => renderContact(c, "add-member"))}
                </>
              )}
            </View>
          }
        />
      )}
    </View>
  );
}
CTEOF

echo "✅ Contacts page rebuilt. Verifying..."
cd apps/mobile && npx tsc --noEmit && echo "✅ Typecheck passed. Restart Metro: npx expo start --clear"
