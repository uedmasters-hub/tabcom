import { useState } from "react";
import { View, Text } from "react-native";
import type { Contact } from "@tabcom/shared";
import { Avatar } from "./Avatar";
import { Button } from "@/components/ui";
import { acceptConnection, ignoreConnection } from "@/hooks/useConnections";
import { sendConnectRequest } from "@/lib/realtime";

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
        <Button size="sm" variant="primary" fullWidth={false} onPress={accept}>
          Accept
        </Button>
        <Button size="sm" variant="ghost" fullWidth={false} onPress={ignore}>
          Ignore
        </Button>
      </View>
    );
  }

  return (
    <View className="items-center px-7">
      <View className="w-full bg-white border border-slate-200 rounded-3xl px-6 py-7 items-center">
        <Avatar name={contact.name} color={contact.color} size="xl" photo={contact.photo} />
        <Text className="text-ink font-bold text-[21px] mt-4">{contact.name}</Text>
        <Text className="text-muted text-[15px] mt-0.5">@{contact.username}</Text>

        <Text className="text-muted text-[15px] text-center leading-[22px] mt-5">
          <Text className="text-ink font-semibold">@{contact.username}</Text> wants to connect.
          Accepting shares your profile, presence and messages with them. You can
          block or report at any time — messages are never stored on Tabcom servers.
        </Text>

        <View className="flex-row gap-3 mt-6 w-full">
          <View className="flex-1">
            <Button variant="primary" icon="checkmark" onPress={accept}>
              Accept
            </Button>
          </View>
          <View className="flex-1">
            <Button variant="secondary" icon="close" onPress={ignore}>
              Ignore
            </Button>
          </View>
        </View>
      </View>
    </View>
  );
}

/** Shown to the requester while they wait. */
export function PendingOutgoingCard({ contact }: { contact: Contact }) {
  return (
    <View className="items-center px-10">
      <Avatar name={contact.name} color={contact.color} size="xl" photo={contact.photo} />
      <Text className="text-ink font-bold text-[19px] mt-4">Request sent</Text>
      <Text className="text-muted text-[15px] text-center leading-[22px] mt-2">
        You can chat with @{contact.username} once they accept.
      </Text>
    </View>
  );
}

/**
 * Shown when there is NO connection at all (status "none" or "declined").
 * You can't message someone you're not connected with — the composer is
 * replaced by this, and the only action is to send a request. The server
 * enforces this regardless; this is honest UX on top of that boundary.
 */
export function NotConnectedCard({
  contact,
  declined = false,
}: {
  contact: Contact;
  declined?: boolean;
}) {
  const [sent, setSent] = useState(false);

  const send = () => {
    if (sent) return;
    setSent(true);
    sendConnectRequest(contact.username);
  };

  if (sent) {
    return (
      <View className="items-center px-10">
        <Avatar name={contact.name} color={contact.color} size="xl" photo={contact.photo} />
        <Text className="text-ink font-bold text-[19px] mt-4">Request sent</Text>
        <Text className="text-muted text-[15px] text-center leading-[22px] mt-2">
          You can chat with @{contact.username} once they accept.
        </Text>
      </View>
    );
  }

  return (
    <View className="items-center px-10">
      <Avatar name={contact.name} color={contact.color} size="xl" photo={contact.photo} />
      <Text className="text-ink font-bold text-[19px] mt-4">
        {declined ? "Request declined" : `Connect with ${contact.name}`}
      </Text>
      <Text className="text-muted text-[15px] text-center leading-[22px] mt-2">
        {declined
          ? `Your previous request was declined. You can send a new one.`
          : `You need to connect before you can message @${contact.username}.`}
      </Text>
      <View className="mt-5">
        <Button
          variant="primary"
          icon="person-add"
          fullWidth={false}
          onPress={send}
        >
          Send connection request
        </Button>
      </View>
    </View>
  );
}
