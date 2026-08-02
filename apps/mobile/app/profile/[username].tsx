import { View, Text, Pressable, ScrollView, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useChatStore } from "@/stores/chat";
import { useAuth } from "@/stores/auth";
import { Avatar } from "@/components/Avatar";
import {
  blockUser,
  unblockUser,
  removeConnection,
  sendConnectRequest,
} from "@/lib/realtime";
import { alert } from "@/lib/alert";

export default function ProfileScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const router = useRouter();
  const me = useAuth((s) => s.user);
  const contacts = useChatStore((s) => s.contacts);
  const connections = useChatStore((s) => s.connections);
  const conversations = useChatStore((s) => s.conversations);
  const messages = useChatStore((s) => s.messages);

  const contact = contacts.find(
    (c) => c.username === username || c.id === `u-${username}`
  );
  const status = username ? connections[username] ?? "none" : "none";

  if (!contact) {
    return (
      <SafeAreaView className="flex-1 bg-background items-center justify-center">
        <Text className="text-muted text-base">User not found</Text>
        <Pressable
          onPress={() => router.back()}
          className="mt-4 px-6 py-3 bg-surface rounded-full"
        >
          <Text className="text-ink font-semibold">Go back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const conv = conversations.find((c) => c.contactId === contact.id);
  const msgCount = conv ? (messages[conv.id] ?? []).length : 0;
  const isGuest = contact.username.startsWith("guest-");

  const handleBlock = () => {
    alert(
      status === "blocked" ? "Unblock" : "Block",
      status === "blocked"
        ? `Unblock @${contact.username}?`
        : `Block @${contact.username}? They won't be able to message you.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: status === "blocked" ? "Unblock" : "Block",
          style: "destructive",
          onPress: () => {
            if (status === "blocked") unblockUser(contact.username);
            else blockUser(contact.username);
          },
        },
      ]
    );
  };

  const handleRemove = () => {
    alert(
      "Remove connection",
      `Remove @${contact.username} from your connections? You'll need to reconnect to chat again.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => removeConnection(contact.username),
        },
      ]
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      {/* Header */}
      <View className="flex-row items-center px-4 py-3">
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          className="pr-3 active:opacity-50"
        >
          <Ionicons name="chevron-back" size={28} color="#2563eb" />
        </Pressable>
        <Text className="text-ink font-bold text-[18px]">Profile</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Avatar + name */}
        <View className="items-center pt-6 pb-8">
          <Avatar
            name={contact.name}
            color={contact.color}
            size="xl"
            presence={contact.presence}
            photo={contact.photo}
          />
          <Text className="text-ink font-bold text-[26px] mt-5">
            {contact.alias ?? contact.name}
          </Text>
          <Text className="text-muted text-[16px] mt-1">
            @{contact.username}
          </Text>
          {contact.alias && (
            <Text className="text-slate-400 text-[14px] mt-0.5">
              {contact.name}
            </Text>
          )}
          {isGuest && (
            <View className="bg-amber-50 border border-amber-200 rounded-full px-4 py-1.5 mt-3">
              <Text className="text-amber-700 text-[13px] font-medium">
                Guest user
              </Text>
            </View>
          )}
        </View>

        {/* Quick actions */}
        <View className="flex-row justify-center gap-4 px-8 mb-8">
          {status === "accepted" && (
            <Pressable
              onPress={() => {
                const convId = useChatStore
                  .getState()
                  .startConversation(contact.id);
                router.replace(`/conversation/${convId}` as any);
              }}
              className="items-center bg-surface rounded-2xl px-6 py-4 flex-1 active:opacity-70"
            >
              <Ionicons name="chatbubble" size={24} color="#2563eb" />
              <Text className="text-ink text-[13px] font-semibold mt-1.5">
                Message
              </Text>
            </Pressable>
          )}
          {status === "none" && (
            <Pressable
              onPress={() => sendConnectRequest(contact.username)}
              className="items-center bg-surface rounded-2xl px-6 py-4 flex-1 active:opacity-70"
            >
              <Ionicons name="person-add" size={24} color="#2563eb" />
              <Text className="text-ink text-[13px] font-semibold mt-1.5">
                Connect
              </Text>
            </Pressable>
          )}
          {status === "pending_out" && (
            <View className="items-center bg-surface rounded-2xl px-6 py-4 flex-1 opacity-60">
              <Ionicons name="time" size={24} color="#64748b" />
              <Text className="text-muted text-[13px] font-semibold mt-1.5">
                Requested
              </Text>
            </View>
          )}
        </View>

        {/* Info rows */}
        <View className="px-5">
          <View className="bg-surface rounded-2xl px-5 py-4 mb-3">
            <Text className="text-muted text-[13px] mb-1">Status</Text>
            <Text className="text-ink text-[16px] capitalize">
              {contact.presence ?? "offline"}
            </Text>
          </View>

          {conv && (
            <View className="bg-surface rounded-2xl px-5 py-4 mb-3">
              <Text className="text-muted text-[13px] mb-1">Messages</Text>
              <Text className="text-ink text-[16px]">
                {msgCount} message{msgCount !== 1 ? "s" : ""} in this
                conversation
              </Text>
            </View>
          )}

          <View className="bg-surface rounded-2xl px-5 py-4 mb-3">
            <Text className="text-muted text-[13px] mb-1">Connection</Text>
            <Text className="text-ink text-[16px] capitalize">
              {status === "accepted"
                ? "Connected"
                : status === "pending_out"
                ? "Request sent"
                : status === "pending_in"
                ? "Wants to connect"
                : status === "blocked"
                ? "Blocked"
                : "Not connected"}
            </Text>
          </View>
        </View>

        {/* Danger zone */}
        <View className="px-5 mt-6">
          {status === "accepted" && (
            <Pressable
              onPress={handleRemove}
              className="flex-row items-center bg-surface rounded-2xl px-5 py-4 mb-3 active:opacity-70"
            >
              <Ionicons
                name="person-remove-outline"
                size={22}
                color="#ef4444"
              />
              <Text className="text-red-500 text-[16px] ml-3">
                Remove connection
              </Text>
            </Pressable>
          )}
          <Pressable
            onPress={handleBlock}
            className="flex-row items-center bg-surface rounded-2xl px-5 py-4 active:opacity-70"
          >
            <Ionicons
              name={
                status === "blocked" ? "shield-checkmark-outline" : "ban"
              }
              size={22}
              color={status === "blocked" ? "#16a34a" : "#ef4444"}
            />
            <Text
              className={`text-[16px] ml-3 ${
                status === "blocked" ? "text-green-600" : "text-red-500"
              }`}
            >
              {status === "blocked"
                ? "Unblock"
                : `Block @${contact.username}`}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
