#!/bin/bash
set -euo pipefail

# ─── Build 7: Inbox + Contacts + Settings ─────────────────────────────
# Run from: tabcom root
# Overwrites:
#   apps/mobile/app/(tabs)/inbox.tsx       (inbox — connection requests + notices)
#   apps/mobile/app/(tabs)/contacts.tsx    (contact management)
#   apps/mobile/app/(tabs)/settings.tsx    (profile, invites, visibility, sign-out, delete)
# ──────────────────────────────────────────────────────────────────────

echo "🔧 Build 7: applying inbox, contacts, settings..."

if [ ! -f "package.json" ] || ! grep -q '"tabcom"' package.json; then
  echo "❌ Run this from the tabcom monorepo root."
  exit 1
fi

# ── 1. Inbox ──
cat > "apps/mobile/app/(tabs)/inbox.tsx" << 'INEOF'
import { Text, View, Pressable, FlatList } from "react-native";
import { useRouter } from "expo-router";
import { useChatStore } from "@/stores/chat";
import { useAuth } from "@/stores/auth";
import type { Conversation } from "@tabcom/shared";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`;
  return `${Math.floor(diff / 86400_000)}d`;
}

/**
 * Inbox — all conversations with unread messages or recent activity,
 * plus pending connection requests surfaced as system notices. Mirrors
 * the extension's InboxView which shows the ConversationList. On
 * mobile, the Chats tab already shows DM conversations, so Inbox
 * focuses on showing ALL activity (DMs + community chats) with unread
 * badges, giving a unified notification-style view.
 */
export default function InboxScreen() {
  const router = useRouter();
  const conversations = useChatStore((s) => s.conversations);
  const contacts = useChatStore((s) => s.contacts);
  const communities = useChatStore((s) => s.communities);
  const connections = useChatStore((s) => s.connections);
  const messages = useChatStore((s) => s.messages);
  const user = useAuth((s) => s.user);

  // Pending incoming connection requests
  const pendingIn = contacts.filter(
    (c) => c.id.startsWith("u-") && connections[c.username] === "pending_in"
  );

  // Conversations with unread
  const unreadConvos = conversations.filter((c) => c.unread > 0);
  // Recent (last 20) with any activity
  const recent = conversations.slice(0, 20);

  const getTitle = (c: Conversation): string => {
    if (c.kind === "community" && c.communityId) {
      return communities[c.communityId]?.name ?? "Community";
    }
    const contact = contacts.find((x) => x.id === c.contactId);
    return contact?.alias ?? contact?.name ?? "Unknown";
  };

  const getLastText = (c: Conversation): string => {
    const thread = messages[c.id] ?? [];
    const last = thread[thread.length - 1];
    return last?.text || "No messages";
  };

  const openConversation = (c: Conversation) => {
    useChatStore.getState().openConversation(c.id);
    if (c.kind === "community" && c.communityId) {
      router.push(`/community/${c.communityId}` as any);
    } else {
      router.push(`/conversation/${c.id}` as any);
    }
  };

  const handleAccept = (username: string) => {
    const contact = contacts.find((c) => c.username === username);
    if (contact) useChatStore.getState().respondToRequest(contact, "accept");
  };
  const handleDeny = (username: string) => {
    const contact = contacts.find((c) => c.username === username);
    if (contact) useChatStore.getState().respondToRequest(contact, "deny");
  };

  const totalUnread = conversations.reduce((n, c) => n + c.unread, 0);

  return (
    <View className="flex-1 bg-ink">
      {/* Connection requests */}
      {pendingIn.length > 0 && (
        <View className="px-4 pt-4 pb-2">
          <Text className="text-neutral-500 text-xs uppercase mb-2">
            Connection requests ({pendingIn.length})
          </Text>
          {pendingIn.map((c) => (
            <View key={c.id} className="bg-card border border-line rounded-2xl p-4 mb-2">
              <View className="flex-row items-center gap-3 mb-3">
                <View
                  style={{ backgroundColor: c.color }}
                  className="w-9 h-9 rounded-full items-center justify-center"
                >
                  <Text className="text-white font-bold text-sm">
                    {c.name.slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-white font-medium">{c.name}</Text>
                  <Text className="text-neutral-500 text-xs">@{c.username}</Text>
                </View>
              </View>
              <View className="flex-row gap-2">
                <Pressable
                  onPress={() => handleAccept(c.username)}
                  className="flex-1 bg-accent rounded-xl py-2.5 items-center active:opacity-80"
                >
                  <Text className="text-white font-semibold text-sm">Accept</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleDeny(c.username)}
                  className="flex-1 bg-card border border-line rounded-xl py-2.5 items-center active:opacity-70"
                >
                  <Text className="text-neutral-400 text-sm">Deny</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Unread summary */}
      {totalUnread > 0 && (
        <View className="px-4 py-2">
          <Text className="text-accent text-sm font-semibold">
            {totalUnread} unread {totalUnread === 1 ? "message" : "messages"}
          </Text>
        </View>
      )}

      {/* All recent conversations */}
      {recent.length === 0 && pendingIn.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-white text-lg font-semibold mb-2">Inbox is empty</Text>
          <Text className="text-neutral-500 text-center">
            Messages and requests will show up here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={recent}
          keyExtractor={(item) => item.id}
          renderItem={({ item: c }) => (
            <Pressable
              onPress={() => openConversation(c)}
              className="flex-row items-center px-4 py-3 active:bg-card"
            >
              <View className="w-10 h-10 rounded-full bg-card items-center justify-center mr-3">
                <Text className="text-white font-bold text-sm">
                  {getTitle(c).slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View className="flex-1 mr-2">
                <Text
                  className={`font-medium ${c.unread > 0 ? "text-white" : "text-neutral-400"}`}
                  numberOfLines={1}
                >
                  {getTitle(c)}
                  {c.kind === "community" ? " 🏘️" : ""}
                </Text>
                <Text className="text-neutral-500 text-sm" numberOfLines={1}>
                  {getLastText(c)}
                </Text>
              </View>
              <View className="items-end">
                <Text className="text-neutral-600 text-xs">{timeAgo(c.lastMessageAt)}</Text>
                {c.unread > 0 && (
                  <View className="bg-accent rounded-full px-1.5 py-0.5 mt-1 min-w-[20px] items-center">
                    <Text className="text-white text-[10px] font-bold">{c.unread}</Text>
                  </View>
                )}
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
INEOF

# ── 2. Contacts ──
cat > "apps/mobile/app/(tabs)/contacts.tsx" << 'CTEOF'
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
    <View className="flex-1 bg-ink">
      {/* Add contact */}
      <View className="px-4 py-3 border-b border-line">
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
                className="flex-1 bg-card border border-line rounded-xl px-4 py-2.5 text-white text-sm"
              />
              <Pressable
                onPress={submitAdd}
                disabled={!newUsername.trim()}
                className={`px-4 py-2.5 rounded-xl ${newUsername.trim() ? "bg-accent" : "bg-accent/40"}`}
              >
                <Text className="text-white text-sm font-semibold">Request</Text>
              </Pressable>
              <Pressable onPress={() => { setAdding(false); setNewUsername(""); }}>
                <Text className="text-neutral-500 text-sm py-2.5">✕</Text>
              </Pressable>
            </View>
            <Text className="text-neutral-600 text-xs mt-2">
              Sends a connection request — they appear here after accepting.
            </Text>
          </View>
        ) : (
          <Pressable
            onPress={() => setAdding(true)}
            className="bg-card border border-line rounded-xl py-3 items-center active:opacity-70"
          >
            <Text className="text-accent font-semibold">+ Add contact by username</Text>
          </Pressable>
        )}
      </View>

      {list.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-white text-lg font-semibold mb-2">No contacts yet</Text>
          <Text className="text-neutral-500 text-center">
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
                    className="flex-1 bg-card border border-line rounded-xl px-4 py-2 text-white text-sm"
                  />
                  <Pressable onPress={() => submitRename(contact.id)} className="bg-accent rounded-xl px-3 py-2">
                    <Text className="text-white text-sm">Save</Text>
                  </Pressable>
                  <Pressable onPress={() => setRenaming(null)}>
                    <Text className="text-neutral-500 text-sm py-2">✕</Text>
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
                      <Text className="text-white font-bold">
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
                    <Text className="text-white font-medium">
                      {contact.alias ?? contact.name}
                      {contact.alias ? (
                        <Text className="text-neutral-500 text-xs font-normal"> ({contact.name})</Text>
                      ) : null}
                    </Text>
                    <Text className="text-neutral-500 text-xs">
                      @{contact.username} · {contact.presence}
                    </Text>
                  </View>
                </Pressable>

                <View className="flex-row gap-1">
                  <Pressable
                    onPress={() => { setAliasDraft(contact.alias ?? ""); setRenaming(contact.id); }}
                    className="px-2 py-1.5 bg-card border border-line rounded-lg"
                  >
                    <Text className="text-neutral-400 text-[10px]">Rename</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => confirmRemove(contact)}
                    className="px-2 py-1.5 bg-card border border-red-900/30 rounded-lg"
                  >
                    <Text className="text-red-400 text-[10px]">Remove</Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
      )}

      <View className="px-4 py-4">
        <Text className="text-neutral-600 text-xs">
          Renames are local nicknames — only you see them. Removing silently ends the connection.
        </Text>
      </View>
    </View>
  );
}
CTEOF

# ── 3. Settings ──
cat > "apps/mobile/app/(tabs)/settings.tsx" << 'STEOF'
import { useEffect, useState } from "react";
import {
  Text, View, Pressable, ScrollView, Alert, Share,
} from "react-native";
import { useAuth } from "@/stores/auth";
import { useChatStore } from "@/stores/chat";
import { useRealtime } from "@/stores/realtime";
import { auth } from "@/lib/auth-client";
import { updatePresence, updateVisibility, clearMyHistory } from "@/lib/realtime";
import type { WirePresence } from "@tabcom/shared";

const PRESENCE_OPTIONS: Array<{ value: WirePresence; label: string; color: string }> = [
  { value: "online", label: "Online", color: "#4ade80" },
  { value: "away", label: "Away", color: "#facc15" },
  { value: "busy", label: "Busy", color: "#ef4444" },
  { value: "offline", label: "Appear offline", color: "#6b7280" },
];

interface InviteSummary {
  code: string;
  used: boolean;
  usedAt: string | null;
}

export default function SettingsScreen() {
  const { user, sessionToken, signOut } = useAuth();
  const connected = useRealtime((s) => s.connected);
  const [presence, setPresenceState] = useState<WirePresence>("online");
  const [invites, setInvites] = useState<InviteSummary[] | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  // Load invite codes
  useEffect(() => {
    if (!sessionToken) return;
    auth.fetchInvites(sessionToken).then((r) => {
      if (r.ok) setInvites(r.invites);
    });
  }, [sessionToken]);

  const handlePresence = (p: WirePresence) => {
    setPresenceState(p);
    updatePresence(p);
  };

  const shareInvite = (code: string) => {
    Share.share({
      message: `Join me on Tabcom! Use this invite code: ${code}`,
    });
  };

  const handleClearHistory = () => {
    Alert.alert(
      "Clear history",
      "This clears all messages and conversations on this device and the server. Contacts, communities, and your account stay intact.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear", style: "destructive",
          onPress: async () => {
            await clearMyHistory();
            useChatStore.getState().resetChat();
          },
        },
      ]
    );
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    useChatStore.getState().resetChat();
    await signOut();
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "Delete account",
      "This permanently deletes your Tabcom account, all your data, and ends all sessions. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete forever",
          style: "destructive",
          onPress: async () => {
            if (!sessionToken) return;
            const result = await auth.deleteAccount(sessionToken);
            if (result.ok) {
              useChatStore.getState().resetChat();
              await signOut();
            } else {
              Alert.alert("Error", "Couldn't delete account. Try again.");
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView className="flex-1 bg-ink" contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Profile card */}
      <View className="bg-card border border-line rounded-2xl p-5 mx-4 mt-4 mb-4">
        <View className="flex-row items-center gap-4">
          <View
            style={{ backgroundColor: user?.avatarColor ?? "#7C6CF6" }}
            className="w-14 h-14 rounded-full items-center justify-center"
          >
            <Text className="text-white font-bold text-xl">
              {(user?.displayName ?? "?").slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <View className="flex-1">
            <Text className="text-white font-semibold text-lg">{user?.displayName}</Text>
            <Text className="text-neutral-500">@{user?.username}</Text>
            <Text className="text-neutral-600 text-xs mt-0.5">{user?.email}</Text>
          </View>
        </View>
      </View>

      {/* Connection status */}
      <View className="flex-row items-center gap-2 px-4 mb-4">
        <View className={`w-2 h-2 rounded-full ${connected ? "bg-green-400" : "bg-red-400"}`} />
        <Text className="text-neutral-500 text-xs">
          {connected ? "Connected to Tabcom" : "Reconnecting…"}
        </Text>
      </View>

      {/* Presence */}
      <View className="px-4 mb-6">
        <Text className="text-neutral-500 text-xs uppercase mb-2">Status</Text>
        <View className="flex-row gap-2">
          {PRESENCE_OPTIONS.map((opt) => (
            <Pressable
              key={opt.value}
              onPress={() => handlePresence(opt.value)}
              className={`flex-1 flex-row items-center justify-center gap-1.5 py-2.5 rounded-xl border ${
                presence === opt.value ? "border-accent bg-accent/10" : "border-line bg-card"
              }`}
            >
              <View style={{ backgroundColor: opt.color }} className="w-2 h-2 rounded-full" />
              <Text className={`text-xs ${presence === opt.value ? "text-white font-semibold" : "text-neutral-400"}`}>
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Invite codes */}
      {invites && invites.length > 0 && (
        <View className="px-4 mb-6">
          <Text className="text-neutral-500 text-xs uppercase mb-2">
            Your invite codes ({invites.filter((i) => !i.used).length} available)
          </Text>
          {invites.map((inv) => (
            <View
              key={inv.code}
              className="flex-row items-center bg-card border border-line rounded-xl px-4 py-3 mb-1.5"
            >
              <Text className={`flex-1 text-sm font-mono ${inv.used ? "text-neutral-600" : "text-white"}`}>
                {inv.code}
              </Text>
              {inv.used ? (
                <Text className="text-neutral-600 text-xs">Used</Text>
              ) : (
                <Pressable onPress={() => shareInvite(inv.code)} className="active:opacity-70">
                  <Text className="text-accent text-xs font-semibold">Share</Text>
                </Pressable>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Actions */}
      <View className="px-4 gap-2">
        <Pressable
          onPress={handleClearHistory}
          className="bg-card border border-line rounded-xl py-3 items-center active:opacity-70"
        >
          <Text className="text-neutral-300 font-semibold text-sm">Clear history</Text>
        </Pressable>

        <Pressable
          onPress={handleSignOut}
          disabled={signingOut}
          className="bg-card border border-line rounded-xl py-3 items-center active:opacity-70"
        >
          <Text className="text-red-400 font-semibold text-sm">
            {signingOut ? "Signing out…" : "Sign out"}
          </Text>
        </Pressable>

        <Pressable
          onPress={handleDeleteAccount}
          className="bg-card border border-red-900/30 rounded-xl py-3 items-center active:opacity-70"
        >
          <Text className="text-red-500 font-semibold text-sm">Delete account</Text>
        </Pressable>
      </View>

      <Text className="text-neutral-700 text-xs text-center mt-6 px-4">
        Settings changes sync with the extension automatically via the shared backend.
      </Text>
    </ScrollView>
  );
}
STEOF

echo ""
echo "✅ Build 7 files written. Running typecheck..."
echo ""

cd apps/mobile && npx tsc --noEmit && echo "" && echo "✅ Build 7 applied. Run: npx expo start --android --clear"
