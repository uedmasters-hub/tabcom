import { useEffect, useState } from "react";
import { Text, View, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
/**
 * RTCView is resolved lazily. A top-level import crashed expo-router's
 * route validation when the native module was absent, which took down
 * the whole app instead of just this screen.
 */
function getRTCView(): any | null {
  try {
    return require("react-native-webrtc").RTCView;
  } catch {
    return null;
  }
}
import {
  subscribe, acceptCall, declineCall, endCall,
  toggleMute, switchCamera, isCallingAvailable, type CallState,
} from "@/lib/call-manager";

export default function CallScreen() {
  const { peer, peerName, peerColor } = useLocalSearchParams<{
    peer: string; peerName?: string; peerColor?: string;
  }>();
  const router = useRouter();
  const [state, setState] = useState<CallState | null>(null);
  const [, setTick] = useState(0);
  const RTCView = getRTCView();

  useEffect(() => subscribe(setState), []);

  useEffect(() => {
    if (!state?.startedAt) return;
    const i = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, [state?.startedAt]);

  // Auto-close only on TERMINAL states. "idle" is the pre-call value —
  // treating it as terminal is what made the screen close instantly.
  useEffect(() => {
    if (!state) return;
    if (["ended", "declined", "busy", "failed"].includes(state.phase)) {
      const t = setTimeout(() => router.back(), 1400);
      return () => clearTimeout(t);
    }
  }, [state?.phase]);

  if (!isCallingAvailable()) {
    return (
      <SafeAreaView className="flex-1 bg-slate-900 items-center justify-center px-10">
        <Ionicons name="call-outline" size={48} color="#64748b" />
        <Text className="text-white font-bold text-lg mt-4 text-center">
          Calling isn't available in this build
        </Text>
        <Text className="text-slate-400 text-center mt-2 leading-[21px]">
          Calls need the native WebRTC module. Rebuild the app with
          `npx expo run:android` — Expo Go can't support them.
        </Text>
        <Pressable
          onPress={() => router.back()}
          className="mt-7 bg-white/15 rounded-2xl px-6 py-3.5 active:opacity-70"
        >
          <Text className="text-white font-semibold">Go back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (!state || !peer) {
    return (
      <SafeAreaView className="flex-1 bg-slate-900 items-center justify-center">
        <Text className="text-slate-400">Connecting…</Text>
      </SafeAreaView>
    );
  }

  const name = peerName ?? state.peer.name ?? peer;
  const color = peerColor ?? state.peer.color ?? "#2563eb";
  const secs = state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0;
  const clock = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;

  const labels: Record<string, string> = {
    idle: "Starting…",
    ringing: state.role === "caller" ? "Calling…" : "Incoming call",
    connecting: "Connecting…",
    connected: clock,
    reconnecting: "Reconnecting…",
    ended: "Call ended",
    declined: "Declined",
    busy: "Busy",
    failed: "Couldn't connect",
    "mic-blocked": "Microphone permission needed",
  };

  const live = state.phase === "connected" || state.phase === "reconnecting";
  const incoming = state.role === "callee" && state.phase === "ringing";
  const showVideo = state.video && live;

  return (
    <SafeAreaView className="flex-1 bg-slate-900">
      {showVideo && state.remoteStream && RTCView ? (
        <RTCView
          streamURL={(state.remoteStream as any).toURL()}
          objectFit="cover"
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />
      ) : null}

      {showVideo && state.localStream && RTCView ? (
        <View className="absolute top-16 right-4 w-28 h-40 rounded-2xl overflow-hidden bg-black z-10">
          <RTCView
            streamURL={(state.localStream as any).toURL()}
            objectFit="cover"
            mirror
            style={{ flex: 1 }}
          />
        </View>
      ) : null}

      <View className="flex-1 items-center justify-center">
        {!showVideo && (
          <>
            <View style={{ backgroundColor: color }} className="w-28 h-28 rounded-full items-center justify-center mb-6">
              <Text className="text-white font-bold text-5xl">{name.slice(0, 1).toUpperCase()}</Text>
            </View>
            <Text className="text-white text-2xl font-bold">{name}</Text>
            <Text className="text-slate-400 mt-0.5">@{peer}</Text>
          </>
        )}
        <Text className={`mt-4 text-base ${state.phase === "failed" || state.phase === "mic-blocked" ? "text-red-400 px-10 text-center" : "text-slate-300"}`}>
          {labels[state.phase] ?? state.phase}
        </Text>
      </View>

      <View className="flex-row items-center justify-center gap-6 pb-14">
        {incoming ? (
          <>
            <Pressable onPress={declineCall} className="w-16 h-16 rounded-full bg-red-600 items-center justify-center active:opacity-80">
              <Ionicons name="close" size={30} color="#fff" />
            </Pressable>
            <Pressable onPress={acceptCall} className="w-16 h-16 rounded-full bg-green-600 items-center justify-center active:opacity-80">
              <Ionicons name="call" size={26} color="#fff" />
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              onPress={toggleMute}
              className={`w-14 h-14 rounded-full items-center justify-center ${state.muted ? "bg-white" : "bg-white/15"}`}
            >
              <Ionicons name={state.muted ? "mic-off" : "mic"} size={23} color={state.muted ? "#0f172a" : "#fff"} />
            </Pressable>
            {state.video && (
              <Pressable onPress={switchCamera} className="w-14 h-14 rounded-full bg-white/15 items-center justify-center">
                <Ionicons name="camera-reverse" size={24} color="#fff" />
              </Pressable>
            )}
            <Pressable onPress={endCall} className="w-16 h-16 rounded-full bg-red-600 items-center justify-center active:opacity-80">
              <Ionicons name="call" size={26} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
