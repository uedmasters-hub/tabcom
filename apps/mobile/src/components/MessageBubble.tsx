import { Text, View, Pressable } from "react-native";
import type { Message } from "@tabcom/shared";
const ME = "me";

interface Props { message: Message; onRetry?: () => void; }

export function MessageBubble({ message, onRetry }: Props) {
  const isMe = message.authorId === ME;
  const isSystem = message.kind === "system";
  const isDeleted = !!message.deletedAt;

  if (isSystem) {
    return (
      <View className="px-10 py-2.5">
        <Text className="text-slate-400 text-[13px] text-center">{message.text}</Text>
      </View>
    );
  }

  return (
    <View className={`px-4 py-1 ${isMe ? "items-end" : "items-start"}`}>
      {!isMe && message.authorName && (
        <Text style={{ color: message.authorColor ?? "#2563eb" }} className="text-[13px] font-semibold mb-1 ml-4">
          {message.authorName}
        </Text>
      )}
      <View
        className={`max-w-[82%] px-4 py-3 ${
          isMe
            ? "bg-slate-900 rounded-t-3xl rounded-bl-3xl rounded-br-lg"
            : "bg-surface border border-slate-100 rounded-t-3xl rounded-br-3xl rounded-bl-lg"
        }`}
      >
        {isDeleted ? (
          <Text className="text-slate-400 italic text-[15px]">Message deleted</Text>
        ) : (
          <>
            <Text className={`text-[16px] leading-[22px] ${isMe ? "text-white" : "text-ink"}`}>{message.text}</Text>
            {message.url && <Text className="text-primary text-sm mt-1.5" numberOfLines={1}>{message.url}</Text>}
          </>
        )}
        <View className="flex-row items-center justify-end gap-2 mt-1.5">
          {message.editedAt && <Text className={`text-[11px] ${isMe ? "text-slate-400" : "text-slate-400"}`}>edited</Text>}
          <Text className={`text-[11px] ${isMe ? "text-slate-400" : "text-slate-400"}`}>
            {new Date(message.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </Text>
          {isMe && message.status === "failed" && (
            <Pressable onPress={onRetry}><Text className="text-red-400 text-[11px] font-semibold">Retry</Text></Pressable>
          )}
          {isMe && message.status === "delivered" && <Text className="text-sky-400 text-[11px]">✓✓</Text>}
          {isMe && message.readAt && <Text className="text-sky-400 text-[11px] font-semibold">read</Text>}
        </View>
      </View>
      {message.reactions && message.reactions.length > 0 && (
        <View className={`flex-row gap-1.5 mt-1 ${isMe ? "mr-3" : "ml-3"}`}>
          {message.reactions.map((r) => (
            <View key={r.emoji} className="bg-white border border-slate-200 rounded-full px-2.5 py-1 flex-row items-center shadow-sm">
              <Text className="text-sm">{r.emoji}</Text>
              <Text className="text-muted text-xs ml-1 font-semibold">{r.usernames.length}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
