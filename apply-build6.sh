#!/bin/bash
set -euo pipefail

# ─── Build 6: Communities ─────────────────────────────────────────────
# Run from: tabcom root
# Creates/overwrites:
#   apps/mobile/app/(tabs)/communities.tsx          (overwrite — community list)
#   apps/mobile/app/community/[id].tsx              (new — community detail tabs)
#   apps/mobile/app/community/manage/[id].tsx       (new — community management)
#   apps/mobile/src/components/BoardItemCard.tsx     (new — board tab item)
# ──────────────────────────────────────────────────────────────────────

echo "🔧 Build 6: applying communities..."

if [ ! -f "package.json" ] || ! grep -q '"tabcom"' package.json; then
  echo "❌ Run this from the tabcom monorepo root."
  exit 1
fi

mkdir -p apps/mobile/app/community/manage apps/mobile/src/components

# ── 1. Communities tab — list + invites + create ──
cat > "apps/mobile/app/(tabs)/communities.tsx" << 'COMEOF'
import { useState } from "react";
import {
  Text, View, Pressable, FlatList, TextInput, Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useChatStore } from "@/stores/chat";
import { useAuth } from "@/stores/auth";
import {
  createCommunity,
  respondToCommunityInvite,
} from "@/lib/realtime";

export default function CommunitiesScreen() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const communities = useChatStore((s) => s.communities);
  const communityInvites = useChatStore((s) => s.communityInvites);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const list = Object.values(communities);
  const invites = Object.values(communityInvites);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    await createCommunity(trimmed);
    setBusy(false);
    setName("");
    setCreating(false);
  };

  const handleInviteResponse = (communityId: string, action: "accept" | "decline") => {
    respondToCommunityInvite(communityId, action);
    useChatStore.getState().receiveCommunityLeft(communityId);
  };

  return (
    <View className="flex-1 bg-ink">
      {/* Create button */}
      <View className="px-4 py-3 border-b border-line">
        {creating ? (
          <View className="flex-row items-center gap-2">
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Community name"
              placeholderTextColor="#5A5A68"
              autoFocus
              className="flex-1 bg-card border border-line rounded-xl px-4 py-2.5 text-white text-sm"
            />
            <Pressable
              onPress={handleCreate}
              disabled={!name.trim() || busy}
              className={`px-4 py-2.5 rounded-xl ${name.trim() && !busy ? "bg-accent" : "bg-accent/40"}`}
            >
              <Text className="text-white text-sm font-semibold">Create</Text>
            </Pressable>
            <Pressable onPress={() => { setCreating(false); setName(""); }}>
              <Text className="text-neutral-500 text-sm">✕</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => setCreating(true)}
            className="bg-card border border-line rounded-xl py-3 items-center active:opacity-70"
          >
            <Text className="text-accent font-semibold">+ New community</Text>
          </Pressable>
        )}
      </View>

      {/* Pending invites */}
      {invites.length > 0 && (
        <View className="px-4 pt-4">
          <Text className="text-neutral-500 text-xs uppercase mb-2">Pending invites</Text>
          {invites.map((inv) => (
            <View key={inv.community.id} className="bg-card border border-line rounded-2xl p-4 mb-2">
              <Text className="text-white font-semibold mb-1">{inv.community.name}</Text>
              <Text className="text-neutral-500 text-sm mb-3">
                Invited by @{inv.from.username}
              </Text>
              <View className="flex-row gap-2">
                <Pressable
                  onPress={() => handleInviteResponse(inv.community.id, "accept")}
                  className="flex-1 bg-accent rounded-xl py-2.5 items-center active:opacity-80"
                >
                  <Text className="text-white font-semibold text-sm">Accept</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleInviteResponse(inv.community.id, "decline")}
                  className="flex-1 bg-card border border-line rounded-xl py-2.5 items-center active:opacity-70"
                >
                  <Text className="text-neutral-400 text-sm">Decline</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Community list */}
      {list.length === 0 && invites.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-white text-lg font-semibold mb-2">No communities yet</Text>
          <Text className="text-neutral-500 text-center">
            Create one or wait for an invite from a connection.
          </Text>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingVertical: 4 }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/community/${item.id}` as any)}
              className="flex-row items-center px-4 py-3 active:bg-card"
            >
              <View className="w-11 h-11 rounded-full bg-accent/20 items-center justify-center mr-3">
                <Text className="text-accent font-bold text-lg">
                  {item.name.slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View className="flex-1">
                <Text className="text-white font-medium">{item.name}</Text>
                <Text className="text-neutral-500 text-sm">
                  {item.members.length} {item.members.length === 1 ? "member" : "members"}
                  {item.admin === user?.username ? " · Admin" : ""}
                </Text>
              </View>
              <Text className="text-neutral-600 text-lg">›</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
COMEOF

# ── 2. Community detail — chat + board + manage ──
cat > apps/mobile/app/community/\[id\].tsx << 'CDEOF'
import { useEffect, useRef, useState } from "react";
import {
  Text, View, Pressable, FlatList, TextInput,
  KeyboardAvoidingView, Platform, Linking,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useChatStore } from "@/stores/chat";
import { useAuth } from "@/stores/auth";
import { MessageBubble } from "@/components/MessageBubble";
import { BoardItemCard } from "@/components/BoardItemCard";

type Tab = "chat" | "board";

export default function CommunityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const [tab, setTab] = useState<Tab>("chat");
  const [text, setText] = useState("");
  const listRef = useRef<FlatList>(null);

  const community = useChatStore((s) => (id ? s.communities[id] : undefined));
  const conversations = useChatStore((s) => s.conversations);
  const messages = useChatStore((s) => s.messages);

  // Find or create conversation for this community
  useEffect(() => {
    if (id) useChatStore.getState().openCommunityConversation(id);
    return () => useChatStore.getState().closeConversation();
  }, [id]);

  if (!community || !id) {
    return (
      <SafeAreaView className="flex-1 bg-ink items-center justify-center">
        <Text className="text-neutral-500">Community not found</Text>
      </SafeAreaView>
    );
  }

  const conversation = conversations.find((c) => c.communityId === id);
  const thread = conversation ? messages[conversation.id] ?? [] : [];
  const isAdmin = community.admin === user?.username;

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed || !conversation) return;
    useChatStore.getState().sendText(conversation.id, trimmed);
    setText("");
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  };

  return (
    <SafeAreaView className="flex-1 bg-ink" edges={["top"]}>
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 border-b border-line">
        <Pressable onPress={() => router.back()} className="mr-3">
          <Text className="text-neutral-400 text-lg">←</Text>
        </Pressable>
        <View className="flex-1">
          <Text className="text-white font-semibold text-base" numberOfLines={1}>
            {community.name}
          </Text>
          <Text className="text-neutral-500 text-xs">
            {community.members.length} members
          </Text>
        </View>
        <Pressable
          onPress={() => router.push(`/community/manage/${id}` as any)}
          className="px-3 py-1.5 bg-card border border-line rounded-lg active:opacity-70"
        >
          <Text className="text-neutral-300 text-xs">Manage</Text>
        </Pressable>
      </View>

      {/* Tab switcher */}
      <View className="flex-row border-b border-line">
        {(["chat", "board"] as Tab[]).map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            className={`flex-1 py-3 items-center ${tab === t ? "border-b-2 border-accent" : ""}`}
          >
            <Text className={tab === t ? "text-accent font-semibold text-sm" : "text-neutral-500 text-sm"}>
              {t === "chat" ? "Chat" : `Board (${community.board.length})`}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === "chat" ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="flex-1"
        >
          <FlatList
            ref={listRef}
            data={thread.filter((m) => m.kind !== "system" || m.text)}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => (
              <MessageBubble
                message={item}
                onRetry={() =>
                  conversation && useChatStore.getState().retryMessage(conversation.id, item.id)
                }
              />
            )}
            contentContainerStyle={{ paddingVertical: 8 }}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          />
          <View className="flex-row items-end px-3 py-2 border-t border-line bg-surface">
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Message…"
              placeholderTextColor="#5A5A68"
              multiline
              className="flex-1 bg-card border border-line rounded-2xl px-4 py-3 text-white text-sm max-h-24 mr-2"
            />
            <Pressable
              onPress={send}
              disabled={!text.trim()}
              className={`w-10 h-10 rounded-full items-center justify-center ${
                text.trim() ? "bg-accent" : "bg-accent/40"
              }`}
            >
              <Text className="text-white font-bold">↑</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      ) : (
        /* Board tab — read-only tabs + comments + open in browser */
        <FlatList
          data={community.board}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          ListEmptyComponent={
            <View className="items-center py-12">
              <Text className="text-neutral-500">No tabs shared yet.</Text>
              <Text className="text-neutral-600 text-xs mt-1">
                Tabs are added from the extension.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <BoardItemCard
              item={item}
              communityId={id}
              isAdmin={isAdmin}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}
CDEOF

# ── 3. Community management screen ──
cat > apps/mobile/app/community/manage/\[id\].tsx << 'MGEOF'
import { useState } from "react";
import {
  Text, View, Pressable, ScrollView, TextInput, Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useChatStore } from "@/stores/chat";
import { useAuth } from "@/stores/auth";
import {
  renameCommunity,
  inviteToCommunity,
  removeCommunityMember,
  transferCommunityAdmin,
  cancelCommunityInvite,
  leaveCommunity,
  deleteCommunity,
} from "@/lib/realtime";

export default function CommunityManageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const community = useChatStore((s) => (id ? s.communities[id] : undefined));
  const contacts = useChatStore((s) => s.contacts);
  const connections = useChatStore((s) => s.connections);

  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [inviteUsername, setInviteUsername] = useState("");

  if (!community || !id) {
    return (
      <SafeAreaView className="flex-1 bg-ink items-center justify-center">
        <Text className="text-neutral-500">Community not found</Text>
      </SafeAreaView>
    );
  }

  const isAdmin = community.admin === user?.username;

  const submitRename = () => {
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== community.name) {
      renameCommunity(id, trimmed);
    }
    setRenaming(false);
  };

  const handleInvite = () => {
    const username = inviteUsername.trim().replace(/^@/, "").toLowerCase();
    if (!username) return;
    inviteToCommunity(id, username);
    setInviteUsername("");
  };

  const confirmRemove = (username: string) => {
    Alert.alert(
      "Remove member",
      `Remove @${username} from ${community.name}?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => removeCommunityMember(id, username) },
      ]
    );
  };

  const confirmTransfer = (username: string) => {
    Alert.alert(
      "Transfer admin",
      `Make @${username} the admin? You'll become a regular member.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Transfer", onPress: () => transferCommunityAdmin(id, username) },
      ]
    );
  };

  const confirmLeave = () => {
    Alert.alert("Leave community", `Leave ${community.name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Leave", style: "destructive",
        onPress: () => { leaveCommunity(id); router.back(); router.back(); },
      },
    ]);
  };

  const confirmDelete = () => {
    Alert.alert("Delete community", `Permanently delete ${community.name}? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: () => { deleteCommunity(id); router.back(); router.back(); },
      },
    ]);
  };

  const eligibleContacts = contacts.filter(
    (c) =>
      c.id.startsWith("u-") &&
      connections[c.username] === "accepted" &&
      !community.members.some((m) => m.username === c.username) &&
      !community.pendingInvites.some((p) => p.username === c.username)
  );

  return (
    <SafeAreaView className="flex-1 bg-ink" edges={["top"]}>
      <View className="flex-row items-center px-4 py-3 border-b border-line">
        <Pressable onPress={() => router.back()} className="mr-3">
          <Text className="text-neutral-400 text-lg">←</Text>
        </Pressable>
        <Text className="text-white font-semibold text-base flex-1">Manage community</Text>
      </View>

      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Name */}
        <View className="mt-4 mb-6">
          <Text className="text-neutral-500 text-xs uppercase mb-2">Name</Text>
          {renaming ? (
            <View className="flex-row gap-2">
              <TextInput
                value={nameDraft}
                onChangeText={setNameDraft}
                autoFocus
                maxLength={60}
                className="flex-1 bg-card border border-line rounded-xl px-4 py-2.5 text-white text-sm"
              />
              <Pressable onPress={submitRename} className="bg-accent rounded-xl px-4 py-2.5">
                <Text className="text-white text-sm font-semibold">Save</Text>
              </Pressable>
              <Pressable onPress={() => setRenaming(false)}>
                <Text className="text-neutral-500 text-sm py-2.5">✕</Text>
              </Pressable>
            </View>
          ) : (
            <View className="flex-row items-center justify-between">
              <Text className="text-white text-base">{community.name}</Text>
              {isAdmin && (
                <Pressable
                  onPress={() => { setNameDraft(community.name); setRenaming(true); }}
                  className="px-3 py-1.5 bg-card border border-line rounded-lg"
                >
                  <Text className="text-neutral-300 text-xs">Rename</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>

        {/* Members */}
        <Text className="text-neutral-500 text-xs uppercase mb-2">
          Members ({community.members.length})
        </Text>
        {community.members.map((m) => {
          const isMeAdmin = isAdmin;
          const isMemberAdmin = m.username === community.admin;
          const isMe = m.username === user?.username;

          return (
            <View key={m.username} className="flex-row items-center py-3 border-b border-line/50">
              <View
                style={{ backgroundColor: m.color }}
                className="w-9 h-9 rounded-full items-center justify-center mr-3"
              >
                <Text className="text-white font-bold text-sm">
                  {m.name.slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View className="flex-1">
                <Text className="text-white text-sm">
                  {m.name} {isMe ? "(you)" : ""}
                </Text>
                <Text className="text-neutral-500 text-xs">
                  @{m.username} {isMemberAdmin ? "· Admin" : ""}
                </Text>
              </View>
              {isMeAdmin && !isMe && (
                <View className="flex-row gap-2">
                  <Pressable
                    onPress={() => confirmTransfer(m.username)}
                    className="px-2 py-1.5 bg-card border border-line rounded-lg"
                  >
                    <Text className="text-neutral-400 text-[10px]">Make admin</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => confirmRemove(m.username)}
                    className="px-2 py-1.5 bg-card border border-red-900/30 rounded-lg"
                  >
                    <Text className="text-red-400 text-[10px]">Remove</Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        })}

        {/* Pending invites */}
        {community.pendingInvites.length > 0 && (
          <>
            <Text className="text-neutral-500 text-xs uppercase mb-2 mt-6">
              Pending invites ({community.pendingInvites.length})
            </Text>
            {community.pendingInvites.map((p) => (
              <View key={p.username} className="flex-row items-center py-3 border-b border-line/50">
                <Text className="text-neutral-300 text-sm flex-1">@{p.username}</Text>
                <Text className="text-neutral-600 text-xs mr-2">{p.attemptsLeft} left</Text>
                {isAdmin && (
                  <Pressable
                    onPress={() => cancelCommunityInvite(id, p.username)}
                    className="px-2 py-1 bg-card border border-line rounded-lg"
                  >
                    <Text className="text-neutral-400 text-xs">Cancel</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </>
        )}

        {/* Invite people */}
        {isAdmin && (
          <>
            <Text className="text-neutral-500 text-xs uppercase mb-2 mt-6">Add people</Text>
            <View className="flex-row gap-2 mb-2">
              <TextInput
                value={inviteUsername}
                onChangeText={setInviteUsername}
                placeholder="@username"
                placeholderTextColor="#5A5A68"
                autoCapitalize="none"
                autoCorrect={false}
                className="flex-1 bg-card border border-line rounded-xl px-4 py-2.5 text-white text-sm"
              />
              <Pressable
                onPress={handleInvite}
                disabled={!inviteUsername.trim()}
                className={`px-4 py-2.5 rounded-xl ${inviteUsername.trim() ? "bg-accent" : "bg-accent/40"}`}
              >
                <Text className="text-white text-sm font-semibold">Invite</Text>
              </Pressable>
            </View>
            {eligibleContacts.length > 0 && (
              <View className="flex-row flex-wrap gap-2 mb-4">
                {eligibleContacts.slice(0, 8).map((c) => (
                  <Pressable
                    key={c.id}
                    onPress={() => { inviteToCommunity(id, c.username); }}
                    className="bg-card border border-line rounded-full px-3 py-1.5 active:opacity-70"
                  >
                    <Text className="text-neutral-300 text-xs">@{c.username}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </>
        )}

        {/* Danger zone */}
        <View className="mt-8 mb-4">
          {isAdmin ? (
            <Pressable
              onPress={confirmDelete}
              className="bg-card border border-red-900/30 rounded-xl py-3 items-center active:opacity-70"
            >
              <Text className="text-red-400 font-semibold">Delete community</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={confirmLeave}
              className="bg-card border border-line rounded-xl py-3 items-center active:opacity-70"
            >
              <Text className="text-red-400 font-semibold">Leave community</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
MGEOF

# ── 4. BoardItemCard component ──
cat > apps/mobile/src/components/BoardItemCard.tsx << 'BIEOF'
import { useState } from "react";
import { Text, View, Pressable, TextInput, Linking } from "react-native";
import type { BoardItem } from "@tabcom/shared";
import { commentOnBoardItem, voteOnBoardItem } from "@/lib/realtime";

interface Props {
  item: BoardItem;
  communityId: string;
  isAdmin: boolean;
}

export function BoardItemCard({ item, communityId, isAdmin }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [comment, setComment] = useState("");

  const sendComment = () => {
    const trimmed = comment.trim();
    if (!trimmed) return;
    commentOnBoardItem(communityId, item.id, trimmed);
    setComment("");
  };

  const domain = (() => {
    try { return new URL(item.url).hostname.replace("www.", ""); }
    catch { return item.url; }
  })();

  return (
    <View className="bg-card border border-line rounded-2xl mb-3 overflow-hidden">
      {/* Header */}
      <Pressable onPress={() => setExpanded(!expanded)} className="p-4">
        <Text className="text-white font-medium text-sm" numberOfLines={2}>
          {item.title}
        </Text>
        <Text className="text-neutral-500 text-xs mt-1" numberOfLines={1}>
          {domain} · {item.siteName ?? ""} · by @{item.addedBy}
        </Text>
        <View className="flex-row items-center gap-3 mt-2">
          <Text className="text-neutral-600 text-xs">
            {item.comments.length} {item.comments.length === 1 ? "comment" : "comments"}
          </Text>
          <Text className="text-neutral-600 text-xs">
            {item.pins.length} {item.pins.length === 1 ? "pin" : "pins"}
          </Text>
          <Text className="text-neutral-600 text-xs">
            👍 {item.votes.length}
          </Text>
        </View>
      </Pressable>

      {/* Actions bar */}
      <View className="flex-row border-t border-line">
        <Pressable
          onPress={() => Linking.openURL(item.url)}
          className="flex-1 py-2.5 items-center border-r border-line active:bg-ink"
        >
          <Text className="text-accent text-xs">Open</Text>
        </Pressable>
        <Pressable
          onPress={() => voteOnBoardItem(communityId, item.id)}
          className="flex-1 py-2.5 items-center border-r border-line active:bg-ink"
        >
          <Text className="text-neutral-400 text-xs">👍 Vote</Text>
        </Pressable>
        <Pressable
          onPress={() => setExpanded(!expanded)}
          className="flex-1 py-2.5 items-center active:bg-ink"
        >
          <Text className="text-neutral-400 text-xs">
            {expanded ? "Hide" : "Comments"}
          </Text>
        </Pressable>
      </View>

      {/* Expanded comments */}
      {expanded && (
        <View className="border-t border-line px-4 py-3">
          {item.comments.length === 0 ? (
            <Text className="text-neutral-600 text-xs mb-2">No comments yet.</Text>
          ) : (
            item.comments.map((c) => (
              <View key={c.id} className="mb-2">
                <Text className="text-neutral-400 text-xs">
                  <Text className="text-neutral-300 font-medium">@{c.author}</Text>
                  {"  "}
                  {new Date(c.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </Text>
                <Text className="text-white text-sm">{c.text}</Text>
              </View>
            ))
          )}
          <View className="flex-row items-center gap-2 mt-2">
            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder="Add a comment…"
              placeholderTextColor="#5A5A68"
              className="flex-1 bg-ink border border-line rounded-xl px-3 py-2 text-white text-sm"
            />
            <Pressable
              onPress={sendComment}
              disabled={!comment.trim()}
              className={`px-3 py-2 rounded-xl ${comment.trim() ? "bg-accent" : "bg-accent/40"}`}
            >
              <Text className="text-white text-xs font-semibold">Send</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}
BIEOF

echo ""
echo "✅ Build 6 files written. Running typecheck..."
echo ""

cd apps/mobile && npx tsc --noEmit && echo "" && echo "✅ Build 6 applied. Run: npx expo start --android --clear"
