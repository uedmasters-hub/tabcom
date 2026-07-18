import { Text, View, Pressable } from "react-native";
import type { Message } from "@tabcom/shared";

const ME = "me";

interface Props {
  message: Message;
  onRetry?: () => void;
}

export function MessageBubble({ message, onRetry }: Props) {
  const isMe = message.authorId === ME;
  const isSystem = message.kind === "system";
  const isDeleted = !!message.deletedAt;

  if (isSystem) {
    return (
      <View className="px-8 py-2">
        <Text className="text-neutral-600 text-xs text-center">{message.text}</Text>
      </View>
    );
  }

  return (
    <View className={`px-4 py-1 ${isMe ? "items-end" : "items-start"}`}>
      {!isMe && message.authorName && (
        <Text style={{ color: message.authorColor ?? "#7C6CF6" }} className="text-xs mb-0.5 ml-2">
          {message.authorName}
        </Text>
      )}
      <View
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
          isMe ? "bg-accent" : "bg-card border border-line"
        }`}
      >
        {isDeleted ? (
          <Text className="text-neutral-500 italic text-sm">Message deleted</Text>
        ) : (
          <>
            <Text className={`text-sm ${isMe ? "text-white" : "text-neutral-200"}`}>
              {message.text}
            </Text>
            {message.url && (
              <Text className="text-blue-400 text-xs mt-1" numberOfLines={1}>
                {message.url}
              </Text>
            )}
          </>
        )}
        <View className="flex-row items-center justify-end gap-2 mt-1">
          {message.editedAt && (
            <Text className="text-neutral-500 text-[10px]">edited</Text>
          )}
          <Text className="text-neutral-500 text-[10px]">
            {new Date(message.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </Text>
          {isMe && message.status === "failed" && (
            <Pressable onPress={onRetry}>
              <Text className="text-red-400 text-[10px]">Not sent · Retry</Text>
            </Pressable>
          )}
          {isMe && message.status === "delivered" && (
            <Text className="text-green-400 text-[10px]">✓✓</Text>
          )}
          {isMe && message.readAt && (
            <Text className="text-blue-400 text-[10px]">read</Text>
          )}
        </View>
      </View>
      {message.reactions && message.reactions.length > 0 && (
        <View className="flex-row gap-1 mt-0.5 ml-2">
          {message.reactions.map((r) => (
            <View key={r.emoji} className="bg-card border border-line rounded-full px-2 py-0.5 flex-row items-center">
              <Text className="text-xs">{r.emoji}</Text>
              <Text className="text-neutral-500 text-[10px] ml-1">{r.usernames.length}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
