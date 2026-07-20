import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Contact } from "@tabcom/shared";
import { Avatar } from "./Avatar";
import { acceptConnection, ignoreConnection } from "@/hooks/useConnections";

interface Props {
  contact: Contact;
  /** "card" fills a chat thread; "inline" sits in a list row. */
  variant?: "card" | "inline";
  onResolved?: () => void;
}

/**
 * The one place a pending request is rendered. Chat, Discover and
 * Notifications all mount this, so wherever a user sees a request they
 * can resolve it in place — no hop to another screen.
 */
export function ConnectionRequestCard({ contact, variant = "card", onResolved }: Props) {
  const accept = () => { acceptConnection(contact); onResolved?.(); };
  const ignore = () => { ignoreConnection(contact); onResolved?.(); };

  if (variant === "inline") {
    return (
      <View className="flex-row items-center gap-2">
        <Pressable
          onPress={accept}
          className="bg-primary rounded-full px-4 py-2 active:opacity-80"
        >
          <Text className="text-white text-[14px] font-bold">Accept</Text>
        </Pressable>
        <Pressable
          onPress={ignore}
          className="bg-surface rounded-full px-4 py-2 active:opacity-70"
        >
          <Text className="text-slate-500 text-[14px] font-semibold">Ignore</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="items-center px-7">
      <View className="w-full bg-white border border-slate-200 rounded-3xl px-6 py-7 items-center">
        <Avatar name={contact.name} color={contact.color} size="xl" />
        <Text className="text-ink font-bold text-[21px] mt-4">{contact.name}</Text>
        <Text className="text-muted text-[15px] mt-0.5">@{contact.username}</Text>

        <Text className="text-muted text-[15px] text-center leading-[22px] mt-5">
          <Text className="text-ink font-semibold">@{contact.username}</Text> wants to connect.
          Accepting shares your profile, presence and messages with them. You can
          block or report at any time — messages are never stored on Tabcom servers.
        </Text>

        <View className="flex-row gap-3 mt-6 w-full">
          <Pressable
            onPress={accept}
            className="flex-1 flex-row items-center justify-center gap-2 bg-primary rounded-2xl py-4 active:opacity-85"
          >
            <Ionicons name="checkmark" size={19} color="#fff" />
            <Text className="text-white font-bold text-[16px]">Accept</Text>
          </Pressable>
          <Pressable
            onPress={ignore}
            className="flex-1 flex-row items-center justify-center gap-2 bg-white border border-slate-200 rounded-2xl py-4 active:opacity-70"
          >
            <Ionicons name="close" size={19} color="#64748b" />
            <Text className="text-muted font-semibold text-[16px]">Ignore</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** Shown to the requester while they wait. */
export function PendingOutgoingCard({ contact }: { contact: Contact }) {
  return (
    <View className="items-center px-10">
      <Avatar name={contact.name} color={contact.color} size="xl" />
      <Text className="text-ink font-bold text-[19px] mt-4">Request sent</Text>
      <Text className="text-muted text-[15px] text-center leading-[22px] mt-2">
        You can chat with @{contact.username} once they accept.
      </Text>
    </View>
  );
}
