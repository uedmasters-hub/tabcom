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
