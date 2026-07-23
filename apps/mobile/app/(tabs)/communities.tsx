import { useMemo, useState } from "react";
import { Text, View, Pressable, FlatList, TextInput, ScrollView, Linking, Alert } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useChatStore } from "@/stores/chat";
import { useAuth } from "@/stores/auth";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Avatar } from "@/components/Avatar";
import { ConnectionRequestCard } from "@/components/ConnectionRequestCard";
import { formatListTime } from "@/lib/format-time";
import {
  respondToCommunityInvite, sendConnectRequest,
  voteOnBoardItem, commentOnBoardItem, leaveCommunity, deleteCommunity,
} from "@/lib/realtime";
import type { BoardItem } from "@tabcom/shared";

type Segment = "groups" | "activities" | "discover";

interface ActivityRow extends BoardItem {
  communityId: string;
  communityName: string;
  isAdmin: boolean;
}

/** Communities — three segments per design:
 *  GROUPS (your communities) · ACTIVITIES (board feed across all
 *  communities) · DISCOVER (online people with Connect pills). */
export default function CommunitiesScreen() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const communities = useChatStore((s) => s.communities);
  const communityInvites = useChatStore((s) => s.communityInvites);
  const contacts = useChatStore((s) => s.contacts);
  const connections = useChatStore((s) => s.connections);
  const connected = useChatStore((s) => s.connected);

  const [segment, setSegment] = useState<Segment>("groups");
  const [query, setQuery] = useState("");
  const [expandedComments, setExpandedComments] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");

  const list = Object.values(communities);
  const invites = Object.values(communityInvites);

  const q = query.trim().toLowerCase();

  const filteredGroups = q ? list.filter((c) => c.name.toLowerCase().includes(q)) : list;

  const activities: ActivityRow[] = useMemo(() => {
    const rows: ActivityRow[] = [];
    for (const c of list) {
      for (const item of c.board) {
        rows.push({ ...item, communityId: c.id, communityName: c.name, isAdmin: c.admin === user?.username });
      }
    }
    rows.sort((a, b) => b.addedAt - a.addedAt);
    return q ? rows.filter((r) => r.title.toLowerCase().includes(q) || r.communityName.toLowerCase().includes(q)) : rows;
  }, [list, q, user?.username]);

  const people = useMemo(() => {
    const online = contacts.filter(
      (c) => c.id.startsWith("u-") && c.presence === "online" && c.username !== user?.username
    );
    return q ? online.filter((p) => p.name.toLowerCase().includes(q) || p.username.includes(q)) : online;
  }, [contacts, q, user?.username]);

  const confirmLeaveOrDelete = (communityId: string, name: string, isAdmin: boolean) => {
    if (isAdmin) {
      Alert.alert(
        "Delete community",
        `Delete "${name}" for everyone? Members lose access to its chat and board. This cannot be undone.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              deleteCommunity(communityId);
              useChatStore.getState().receiveCommunityDeleted(communityId);
            },
          },
        ]
      );
    } else {
      Alert.alert(
        "Leave community",
        `Leave "${name}"? You'll need a new invite to rejoin.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Leave",
            style: "destructive",
            onPress: () => {
              leaveCommunity(communityId);
              useChatStore.getState().receiveCommunityLeft(communityId);
            },
          },
        ]
      );
    }
  };

  const submitComment = (row: ActivityRow) => {
    const text = commentDraft.trim();
    if (!text) return;
    commentOnBoardItem(row.communityId, row.id, text);
    setCommentDraft("");
  };

  const SegmentTabs = () => (
    <View className="flex-row px-5 pb-3 gap-2">
      {(["groups", "activities", "discover"] as Segment[]).map((s) => (
        <Pressable
          key={s}
          onPress={() => setSegment(s)}
          className={`px-5 py-2.5 rounded-full ${segment === s ? "bg-surface" : ""}`}
        >
          <Text className={`text-[14px] font-bold tracking-wider ${segment === s ? "text-ink" : "text-slate-400"}`}>
            {s.toUpperCase()}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Communities" onAdd={() => router.push("/community/create" as any)} search={query} onSearch={setQuery} />
      <SegmentTabs />

      {segment === "groups" && (
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          {invites.map((inv) => (
            <View key={inv.community.id} className="bg-surface rounded-3xl p-5 mx-5 mb-3">
              <Text className="text-ink font-bold text-[17px] mb-1">{inv.community.name}</Text>
              <Text className="text-muted text-[15px] mb-4">Invited by @{inv.from.username}</Text>
              <View className="flex-row gap-2.5">
                <Pressable
                  onPress={() => { respondToCommunityInvite(inv.community.id, "accept"); useChatStore.getState().receiveCommunityLeft(inv.community.id); }}
                  className="flex-1 bg-primary rounded-2xl py-3.5 items-center active:opacity-85"
                >
                  <Text className="text-white font-bold text-[15px]">Accept</Text>
                </Pressable>
                <Pressable
                  onPress={() => { respondToCommunityInvite(inv.community.id, "decline"); useChatStore.getState().receiveCommunityLeft(inv.community.id); }}
                  className="flex-1 bg-white border border-slate-200 rounded-2xl py-3.5 items-center active:opacity-70"
                >
                  <Text className="text-muted text-[15px] font-semibold">Decline</Text>
                </Pressable>
              </View>
            </View>
          ))}

          {filteredGroups.map((item) => {
            const latestBoard = item.board.length > 0 ? Math.max(...item.board.map((b) => b.addedAt)) : 0;
            return (
              <Pressable
                key={item.id}
                onPress={() => router.push(`/community/${item.id}` as any)}
                onLongPress={() => confirmLeaveOrDelete(item.id, item.name, item.admin === user?.username)}
                delayLongPress={400}
                className="flex-row items-center px-5 py-3 active:bg-surface"
              >
                <View className="mr-4">
                  <Avatar name={item.name} color="#2563eb" size="lg" />
                </View>
                <View className="flex-1 border-b border-slate-100 py-2 flex-row items-center">
                  <View className="flex-1">
                    <Text className="text-ink font-bold text-[19px]">{item.name}</Text>
                    <Text className="text-[#5b7a9d] text-[15px] mt-0.5">
                      {item.members.length} members{item.admin === user?.username ? "  •  Admin" : ""}
                    </Text>
                  </View>
                  {latestBoard > 0 && (
                    <Text className="text-slate-400 text-[14px] mr-2">{formatListTime(latestBoard)}</Text>
                  )}
                  <Pressable
                    onPress={() => confirmLeaveOrDelete(item.id, item.name, item.admin === user?.username)}
                    hitSlop={10}
                    className="p-1.5 active:opacity-50"
                  >
                    <Ionicons name="ellipsis-horizontal" size={20} color="#94a3b8" />
                  </Pressable>
                </View>
              </Pressable>
            );
          })}

          {filteredGroups.length === 0 && invites.length === 0 && (
            <Pressable
              onPress={q ? undefined : () => router.push("/community/create" as any)}
              className="items-center pt-16 px-10 active:opacity-70"
            >
              <Ionicons name="people-outline" size={56} color="#cbd5e1" />
              <Text className="text-ink text-xl font-bold mt-4 mb-2">
                {q ? "No matches" : "No communities yet"}
              </Text>
              <Text className="text-muted text-base text-center leading-6">
                {q ? "Try a different search." : "Tap here to create your first community."}
              </Text>
            </Pressable>
          )}
        </ScrollView>
      )}

      {segment === "activities" && (
        <FlatList
          data={activities}
          keyExtractor={(i) => `${i.communityId}-${i.id}`}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
          ListEmptyComponent={
            <View className="items-center pt-16 px-10">
              <Ionicons name="albums-outline" size={56} color="#cbd5e1" />
              <Text className="text-ink text-xl font-bold mt-4 mb-2">No activity yet</Text>
              <Text className="text-muted text-base text-center leading-6">
                Tabs shared to any of your community boards will appear here.
              </Text>
            </View>
          }
          renderItem={({ item: row }) => {
            const iVoted = user?.username ? row.votes.includes(user.username) : false;
            const expanded = expandedComments === `${row.communityId}-${row.id}`;
            const canDelete = row.isAdmin || row.addedBy === user?.username;
            return (
              <View className="border border-slate-100 rounded-3xl mb-4 overflow-hidden">
                <Pressable onPress={() => Linking.openURL(row.url)} className="flex-row p-4 active:bg-surface">
                  <View className="w-20 h-20 rounded-2xl bg-surface items-center justify-center mr-4">
                    <Ionicons name="open-outline" size={28} color="#94a3b8" />
                  </View>
                  <View className="flex-1 justify-center">
                    <Text className="text-ink font-bold text-[18px]" numberOfLines={2}>{row.title}</Text>
                    <Text className="text-slate-400 text-[14px] mt-1">
                      added by @{row.addedBy} · {formatListTime(row.addedAt)}
                    </Text>
                    <Text className="text-slate-400 text-[13px] mt-0.5">{row.communityName}</Text>
                  </View>
                </Pressable>

                <View className="flex-row items-center px-4 pb-4 gap-2.5">
                  <Pressable
                    onPress={() => voteOnBoardItem(row.communityId, row.id)}
                    className={`flex-row items-center gap-1.5 border rounded-full px-4 py-2 ${iVoted ? "border-blue-200 bg-blue-50" : "border-slate-200"}`}
                  >
                    <Ionicons name={iVoted ? "thumbs-up" : "thumbs-up-outline"} size={17} color={iVoted ? "#2563eb" : "#64748b"} />
                    <Text className={`text-[15px] font-semibold ${iVoted ? "text-primary" : "text-slate-500"}`}>{row.votes.length}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setExpandedComments(expanded ? null : `${row.communityId}-${row.id}`)}
                    className="flex-row items-center gap-1.5 border border-slate-200 rounded-full px-4 py-2"
                  >
                    <Ionicons name="chatbubbles-outline" size={17} color="#64748b" />
                    <Text className="text-slate-500 text-[15px] font-semibold">{row.comments.length}</Text>
                    <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={14} color="#94a3b8" />
                  </Pressable>
                  <View className="flex-row items-center gap-1.5 border border-slate-200 rounded-full px-4 py-2">
                    <Ionicons name="pin-outline" size={17} color="#64748b" />
                    <Text className="text-slate-500 text-[15px] font-semibold">{row.pins.length}</Text>
                  </View>
                  <View className="flex-1" />
                  {canDelete && (
                    <Pressable
                      onPress={() =>
                        Alert.alert("Remove tab", `Remove "${row.title}" from ${row.communityName}'s board?`, [
                          { text: "Cancel", style: "cancel" },
                          { text: "Remove", style: "destructive", onPress: () => router.push(`/community/${row.communityId}` as any) },
                        ])
                      }
                      className="p-2"
                    >
                      <Ionicons name="trash-outline" size={19} color="#94a3b8" />
                    </Pressable>
                  )}
                </View>

                {expanded && (
                  <View className="border-t border-slate-100 px-5 py-4">
                    {row.comments.length === 0 ? (
                      <Text className="text-slate-400 text-[14px] mb-3">No comments yet.</Text>
                    ) : (
                      row.comments.map((c) => (
                        <View key={c.id} className="mb-3">
                          <Text className="text-slate-500 text-[13px]">
                            <Text className="text-ink font-semibold">@{c.author}</Text>
                            {"  "}{formatListTime(c.sentAt)}
                          </Text>
                          <Text className="text-ink text-[16px] mt-0.5">{c.text}</Text>
                        </View>
                      ))
                    )}
                    <View className="flex-row items-center gap-2 mt-1">
                      <TextInput
                        value={commentDraft}
                        onChangeText={setCommentDraft}
                        placeholder="Add a comment…"
                        placeholderTextColor="#94a3b8"
                        className="flex-1 bg-surface rounded-2xl px-4 py-3 text-ink text-[15px]"
                      />
                      <Pressable
                        onPress={() => submitComment(row)}
                        disabled={!commentDraft.trim()}
                        className={`w-11 h-11 rounded-full items-center justify-center ${commentDraft.trim() ? "bg-primary" : "bg-slate-200"}`}
                      >
                        <Ionicons name="arrow-up" size={19} color={commentDraft.trim() ? "#fff" : "#94a3b8"} />
                      </Pressable>
                    </View>
                  </View>
                )}
              </View>
            );
          }}
        />
      )}

      {segment === "discover" && (
        people.length === 0 ? (
          <View className="flex-1 items-center justify-center px-10">
            <Ionicons name="planet-outline" size={56} color="#cbd5e1" />
            <Text className="text-ink text-xl font-bold mt-4 mb-2">
              {connected ? (q ? "No matches" : "No one else is online") : "Connecting…"}
            </Text>
            <Text className="text-muted text-base text-center leading-6">
              People who sign in on public will appear here instantly.
            </Text>
          </View>
        ) : (
          <FlatList
            data={people}
            keyExtractor={(i) => i.id}
            contentContainerStyle={{ paddingBottom: 24 }}
            renderItem={({ item: person }) => {
              const status = connections[person.username] ?? "none";
              return (
                <View className="flex-row items-center px-5 py-3">
                  <View className="relative mr-4">
                    <View style={{ backgroundColor: person.color }} className="w-[60px] h-[60px] rounded-full items-center justify-center">
                      <Text className="text-white font-bold text-2xl">{person.name.slice(0, 1).toUpperCase()}</Text>
                    </View>
                    <View className="absolute bottom-0 right-0 w-[18px] h-[18px] rounded-full border-[3px] border-white bg-amber-400" />
                  </View>
                  <View className="flex-1 border-b border-slate-100 py-4 flex-row items-center">
                    <Text className="flex-1 text-ink font-semibold text-[19px]">{person.name}</Text>
                    {status === "accepted" ? (
                      <Pressable
                        onPress={() => {
                          const convId = useChatStore.getState().startConversation(person.id);
                          router.push(`/conversation/${convId}` as any);
                        }}
                        className="bg-surface rounded-full px-5 py-2.5 active:opacity-70"
                      >
                        <Ionicons name="chatbubble-outline" size={18} color="#2563eb" />
                      </Pressable>
                    ) : status === "pending_in" ? (
                      <ConnectionRequestCard contact={person} variant="inline" />
                    ) : (
                      <Pressable
                        onPress={() => status === "none" && sendConnectRequest(person.username)}
                        className="bg-surface rounded-full px-5 py-2.5 active:opacity-70"
                      >
                        <Text className="text-slate-500 text-[15px] font-semibold">
                          {status === "pending_out" ? "Requested" : status === "blocked" ? "Blocked" : "Connect"}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            }}
          />
        )
      )}
    </View>
  );
}
