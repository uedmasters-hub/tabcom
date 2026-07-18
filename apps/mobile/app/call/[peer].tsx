import { useEffect, useState } from "react";
import { Text, View, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  subscribe,
  acceptCall,
  declineCall,
  endCall,
  toggleMute,
  type CallState,
} from "@/lib/call-manager";

export default function CallScreen() {
  const { peer, peerName, peerColor, role } = useLocalSearchParams<{
    peer: string;
    peerName?: string;
    peerColor?: string;
    role?: string;
  }>();
  const router = useRouter();
  const [state, setState] = useState<CallState | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const unsub = subscribe(setState);
    return unsub;
  }, []);

  // Duration ticker
  useEffect(() => {
    if (!state?.startedAt) return;
    const interval = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [state?.startedAt]);

  // Auto-close on ended/declined/busy
  useEffect(() => {
    if (!state) return;
    if (["ended", "declined", "busy"].includes(state.phase)) {
      const timer = setTimeout(() => router.back(), 1200);
      return () => clearTimeout(timer);
    }
  }, [state?.phase]);

  if (!state || !peer) {
    return (
      <SafeAreaView className="flex-1 bg-ink items-center justify-center">
        <Text className="text-neutral-500">No active call</Text>
      </SafeAreaView>
    );
  }

  const name = peerName ?? state.peer.name ?? peer;
  const color = peerColor ?? state.peer.color ?? "#7C6CF6";

  const duration = state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0;
  const mm = String(Math.floor(duration / 60)).padStart(2, "0");
  const ss = String(duration % 60).padStart(2, "0");

  const statusLabels: Record<string, string> = {
    ringing: state.role === "caller" ? "Calling…" : "Incoming call",
    connecting: "Connecting…",
    connected: `${mm}:${ss}`,
    reconnecting: "Reconnecting…",
    ended: "Call ended",
    declined: "Declined",
    busy: "Busy",
    failed: "Couldn't connect — check mic permissions",
    "mic-blocked": "Microphone access needed",
  };

  const inCall = state.phase === "connected" || state.phase === "reconnecting";
  const incomingUndecided = state.role === "callee" && state.phase === "ringing";

  return (
    <SafeAreaView className="flex-1 bg-ink">
      {/* Peer info */}
      <View className="flex-1 items-center justify-center">
        <View
          style={{ backgroundColor: color }}
          className="w-24 h-24 rounded-full items-center justify-center mb-6"
        >
          <Text className="text-white font-bold text-4xl">
            {name.slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <Text className="text-white text-xl font-semibold mb-1">{name}</Text>
        <Text className="text-neutral-400">@{peer}</Text>
        <Text
          className={`mt-4 text-sm ${
            state.phase === "failed" || state.phase === "mic-blocked"
              ? "text-red-400 px-8 text-center"
              : "text-neutral-500"
          }`}
        >
          {statusLabels[state.phase] ?? state.phase}
        </Text>
      </View>

      {/* Controls */}
      <View className="flex-row items-center justify-center gap-5 pb-12">
        {incomingUndecided ? (
          <>
            <Pressable
              onPress={declineCall}
              className="w-16 h-16 rounded-full bg-red-600 items-center justify-center active:opacity-80"
            >
              <Text className="text-white text-2xl">✕</Text>
            </Pressable>
            <Pressable
              onPress={acceptCall}
              className="w-16 h-16 rounded-full bg-green-600 items-center justify-center active:opacity-80"
            >
              <Text className="text-white text-2xl">📞</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              onPress={toggleMute}
              disabled={!inCall && state.phase !== "connecting"}
              className={`w-14 h-14 rounded-full items-center justify-center ${
                state.muted ? "bg-white" : "bg-white/10"
              }`}
            >
              <Text className={`text-lg ${state.muted ? "text-black" : "text-white"}`}>
                {state.muted ? "🔇" : "🎤"}
              </Text>
            </Pressable>
            <Pressable
              onPress={endCall}
              className="w-16 h-16 rounded-full bg-red-600 items-center justify-center active:opacity-80"
            >
              <Text className="text-white text-2xl">📵</Text>
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
