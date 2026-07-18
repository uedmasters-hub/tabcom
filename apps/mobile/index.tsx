import { useEffect, useState } from "react";
import { Text, View, Pressable } from "react-native";
import type { WirePresence } from "@tabcom/shared";
import { REALTIME_URL } from "@/lib/config";

/**
 * Placeholder Chats screen for the Build 2 scaffold. Two jobs:
 *   1. Prove the @tabcom/shared workspace import resolves through
 *      Metro (the WirePresence type below comes from packages/shared).
 *   2. Prove the phone can reach the backend before we write any
 *      socket code — a plain HTTP GET to the server root.
 * Build 5 replaces this with the real conversation list.
 */
export default function ChatsScreen() {
  const [status, setStatus] = useState<"checking" | "reachable" | "unreachable">(
    "checking"
  );
  const presence: WirePresence = "online"; // shared-type smoke test

  const check = () => {
    setStatus("checking");
    fetch(REALTIME_URL, { method: "GET" })
      .then(() => setStatus("reachable"))
      .catch(() => setStatus("unreachable"));
  };

  useEffect(check, []);

  return (
    <View className="flex-1 bg-ink items-center justify-center px-8">
      <Text className="text-white text-2xl font-bold mb-2">Tabcom</Text>
      <Text className="text-neutral-400 text-center mb-8">
        Chats will live here. Scaffold is up and running.
      </Text>

      <View className="bg-card rounded-2xl p-5 w-full border border-line">
        <Text className="text-neutral-500 text-xs uppercase mb-2">
          Backend · {REALTIME_URL}
        </Text>
        <Text
          className={
            status === "reachable"
              ? "text-green-400"
              : status === "unreachable"
                ? "text-red-400"
                : "text-neutral-400"
          }
        >
          {status === "checking" && "Checking…"}
          {status === "reachable" && `Reachable — presence type: ${presence}`}
          {status === "unreachable" && "Unreachable — check EXPO_PUBLIC_REALTIME_URL"}
        </Text>
        <Pressable
          onPress={check}
          className="mt-4 bg-accent rounded-xl py-3 items-center active:opacity-80"
        >
          <Text className="text-white font-semibold">Re-check</Text>
        </Pressable>
      </View>
    </View>
  );
}
