import { useEffect, useState } from "react";
import {
  Text,
  View,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  subscribe,
  acceptCall,
  declineCall,
  endCall,
  toggleMute,
  toggleSpeaker,
  toggleCamera,
  switchCamera,
  toggleHold,
  isCallingAvailable,
  isSpeakerAvailable,
  phaseLabel,
  QUICK_REPLIES,
  getCallState,
  type CallState,
} from "@/lib/call-manager";

function getRTCView(): any | null {
  try {
    return require("react-native-webrtc").RTCView;
  } catch {
    return null;
  }
}

const TERMINAL = new Set([
  "ended",
  "declined",
  "busy",
  "failed",
  "cancelled",
  "timed-out",
  "offline",
  "no-internet",
  "mic-blocked",
]);

function ControlBtn({
  onPress,
  active,
  danger,
  success,
  disabled,
  icon,
  label,
  size = 56,
}: {
  onPress: () => void;
  active?: boolean;
  danger?: boolean;
  success?: boolean;
  disabled?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label?: string;
  size?: number;
}) {
  const bg = danger
    ? "bg-red-600"
    : success
      ? "bg-green-600"
      : active
        ? "bg-white"
        : "bg-white/15";
  const fg = danger || success ? "#fff" : active ? "#0f172a" : "#fff";
  return (
    <View className="items-center">
      <Pressable
        onPress={onPress}
        disabled={disabled}
        className={`rounded-full items-center justify-center active:opacity-80 ${bg}`}
        style={{ width: size, height: size, opacity: disabled ? 0.4 : 1 }}
      >
        <Ionicons
          name={icon}
          size={size >= 64 ? 28 : 22}
          color={fg}
          style={danger && icon === "call" ? { transform: [{ rotate: "135deg" }] } : undefined}
        />
      </Pressable>
      {label ? (
        <Text className="text-slate-300 text-[11px] mt-1.5">{label}</Text>
      ) : null}
    </View>
  );
}

export default function CallScreen() {
  const { peer, peerName, peerColor, role, video: videoParam } = useLocalSearchParams<{
    peer: string;
    peerName?: string;
    peerColor?: string;
    role?: string;
    video?: string;
  }>();
  const router = useRouter();
  const [state, setState] = useState<CallState | null>(null);
  const [, setTick] = useState(0);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [staleMissed, setStaleMissed] = useState(false);
  const RTCView = getRTCView();

  useEffect(() => subscribe(setState), []);

  // Stale push deep-link: opened as callee with no live ring → missed call.
  useEffect(() => {
    if (role !== "callee" || !peer) return;
    const t = setTimeout(() => {
      const cur = getCallState();
      if (cur.phase !== "idle") return;
      try {
        const { useCallHistory } =
          require("@/stores/call-history") as typeof import("@/stores/call-history");
        useCallHistory.getState().record({
          peerUsername: peer,
          peerName: peerName ? decodeURIComponent(peerName) : peer,
          peerColor: peerColor ? decodeURIComponent(peerColor) : "#2563eb",
          direction: "incoming",
          video: videoParam === "true",
          outcome: "missed",
          startedAt: Date.now(),
          endedAt: Date.now(),
          seen: false,
        });
      } catch { /* best-effort */ }
      setStaleMissed(true);
    }, 400);
    return () => clearTimeout(t);
  }, [role, peer, peerName, peerColor, videoParam]);

  useEffect(() => {
    if (!state?.startedAt) return;
    const i = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, [state?.startedAt]);

  useEffect(() => {
    if (!state && !staleMissed) return;
    const phase = staleMissed ? "timed-out" : state?.phase;
    if (phase && TERMINAL.has(phase)) {
      const t = setTimeout(() => router.back(), 1600);
      return () => clearTimeout(t);
    }
  }, [state?.phase, staleMissed, router]);

  if (!isCallingAvailable()) {
    return (
      <SafeAreaView className="flex-1 bg-slate-900 items-center justify-center px-10">
        <Ionicons name="call-outline" size={48} color="#64748b" />
        <Text className="text-white font-bold text-lg mt-4 text-center">
          Calling isn't available in this build
        </Text>
        <Text className="text-slate-400 text-center mt-2 leading-[21px]">
          Calls need the native WebRTC module. Rebuild with{" "}
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

  if ((!state || !peer) && !staleMissed) {
    return (
      <SafeAreaView className="flex-1 bg-slate-900 items-center justify-center">
        <ActivityIndicator color="#fff" />
        <Text className="text-slate-400 mt-3">Starting…</Text>
      </SafeAreaView>
    );
  }

  const displayName =
    (peerName ? decodeURIComponent(peerName) : null) ||
    state?.peer.name ||
    peer ||
    "Unknown";
  const displayColor =
    (peerColor ? decodeURIComponent(peerColor) : null) ||
    state?.peer.color ||
    "#2563eb";
  const isVideo = state?.video ?? videoParam === "true";
  const phase = staleMissed ? "timed-out" : state!.phase;
  const roleNow = state?.role ?? (role === "callee" ? "callee" : "caller");

  const secs =
    state?.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0;
  const clock = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;

  const live =
    phase === "connected" ||
    phase === "reconnecting" ||
    phase === "on-hold" ||
    phase === "poor-network";
  const incoming = roleNow === "callee" && phase === "ringing";
  const outboundPrep =
    roleNow === "caller" && ["calling", "ringing", "connecting"].includes(phase);
  const hasRTC = !!RTCView;
  const showRemote =
    !!isVideo && live && !!state?.remoteStream && hasRTC && state.videoEnabled !== false;
  const showSelfPreview = !!isVideo && !live && !!state?.localStream && hasRTC;
  const videoMode = showRemote || showSelfPreview;
  const speakerAvailable = isSpeakerAvailable();

  let statusText = staleMissed
    ? "Missed call"
    : phaseLabel(state!);
  if (live && phase === "connected") statusText = clock;
  if (live && phase === "poor-network") statusText = `${clock} · Poor network`;
  if (live && phase === "reconnecting") statusText = "Reconnecting…";
  if (live && phase === "on-hold") statusText = state?.statusDetail ?? "On hold";
  if (state?.statusDetail && !live && !TERMINAL.has(phase) && !staleMissed) {
    statusText = state.statusDetail;
  }

  const statusColor =
    phase === "failed" ||
    phase === "mic-blocked" ||
    phase === "no-internet" ||
    phase === "offline" ||
    phase === "timed-out"
      ? "text-red-400"
      : phase === "reconnecting" || phase === "poor-network"
        ? "text-amber-300"
        : "text-slate-200";

  return (
    <SafeAreaView className="flex-1 bg-slate-900">
      {showRemote ? (
        <RTCView
          streamURL={(state!.remoteStream as any).toURL()}
          objectFit="cover"
          style={StyleSheet.absoluteFill}
        />
      ) : null}

      {showSelfPreview ? (
        <RTCView
          streamURL={(state!.localStream as any).toURL()}
          objectFit="cover"
          mirror
          style={StyleSheet.absoluteFill}
        />
      ) : null}

      {showRemote && state?.localStream && state.videoEnabled ? (
        <View className="absolute top-16 right-4 w-28 h-40 rounded-2xl overflow-hidden bg-black z-10 border border-white/20">
          <RTCView
            streamURL={(state.localStream as any).toURL()}
            objectFit="cover"
            mirror
            style={{ flex: 1 }}
          />
        </View>
      ) : null}

      {videoMode ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill} className="bg-black/30" />
      ) : null}

      {(phase === "reconnecting" || phase === "poor-network") && (
        <View className="absolute top-14 left-4 right-4 z-20 bg-amber-500/95 rounded-2xl px-4 py-3 flex-row items-center">
          <ActivityIndicator color="#0f172a" size="small" />
          <Text className="text-slate-900 font-semibold ml-3 flex-1">
            {phase === "reconnecting"
              ? "Reconnecting — hang tight"
              : state?.statusDetail ?? "Poor connection"}
          </Text>
        </View>
      )}

      <View
        className={
          videoMode
            ? "absolute top-0 left-0 right-0 items-center pt-16 px-6"
            : "flex-1 items-center justify-center px-6"
        }
      >
        {!videoMode && (
          <>
            <View
              style={{ backgroundColor: displayColor }}
              className="w-28 h-28 rounded-full items-center justify-center mb-6"
            >
              <Text className="text-white font-bold text-5xl">
                {displayName.slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <Text className="text-white text-2xl font-bold text-center">{displayName}</Text>
            {peer ? <Text className="text-slate-400 mt-0.5">@{peer}</Text> : null}
            <View className="flex-row items-center mt-2 gap-1.5">
              <Ionicons
                name={isVideo ? "videocam" : "call"}
                size={14}
                color="#94a3b8"
              />
              <Text className="text-slate-400 text-sm">
                {isVideo ? "Video call" : "Voice call"}
              </Text>
            </View>
          </>
        )}
        {videoMode && (
          <Text className="text-white text-2xl font-bold">{displayName}</Text>
        )}
        <Text className={`mt-2 text-base text-center px-4 ${statusColor}`}>
          {statusText}
        </Text>
        {outboundPrep && phase === "calling" ? (
          <ActivityIndicator color="#94a3b8" style={{ marginTop: 16 }} />
        ) : null}
      </View>

      {incoming ? (
        <View className="pb-12 px-4">
          {showQuickReplies ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                gap: 8,
                paddingHorizontal: 8,
                paddingBottom: 18,
              }}
            >
              {QUICK_REPLIES.map((msg) => (
                <Pressable
                  key={msg}
                  onPress={() => declineCall(msg)}
                  className="bg-white/15 rounded-full px-4 py-2.5 active:opacity-70"
                >
                  <Text className="text-white text-[13px] font-medium">{msg}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <Pressable
              onPress={() => setShowQuickReplies(true)}
              className="self-center mb-5 active:opacity-70"
            >
              <Text className="text-slate-300 text-[14px] font-medium">
                Reply with a message
              </Text>
            </Pressable>
          )}
          <View className="flex-row items-center justify-center gap-12">
            <ControlBtn
              onPress={() => declineCall()}
              danger
              icon="close"
              label="Decline"
              size={68}
            />
            <ControlBtn
              onPress={acceptCall}
              success
              icon="call"
              label="Accept"
              size={68}
            />
          </View>
        </View>
      ) : (
        <View
          className={`${videoMode ? "absolute bottom-0 left-0 right-0" : ""} pb-12 px-4`}
        >
          {live ? (
            <View className="flex-row items-end justify-center gap-3.5 flex-wrap">
              <ControlBtn
                onPress={toggleMute}
                active={!!state?.muted}
                icon={state?.muted ? "mic-off" : "mic"}
                label={state?.muted ? "Unmute" : "Mute"}
              />
              {speakerAvailable && (
                <ControlBtn
                  onPress={toggleSpeaker}
                  active={!!state?.speaker}
                  icon={state?.speaker ? "volume-high" : "volume-medium"}
                  label="Speaker"
                />
              )}
              {isVideo && (
                <>
                  <ControlBtn
                    onPress={toggleCamera}
                    active={!state?.videoEnabled}
                    icon={state?.videoEnabled ? "videocam" : "videocam-off"}
                    label="Camera"
                  />
                  <ControlBtn
                    onPress={switchCamera}
                    icon="camera-reverse"
                    label="Flip"
                    disabled={!state?.videoEnabled}
                  />
                </>
              )}
              <ControlBtn
                onPress={toggleHold}
                active={!!state?.onHold}
                icon={state?.onHold ? "play" : "pause"}
                label={state?.onHold ? "Resume" : "Hold"}
              />
              <ControlBtn
                onPress={endCall}
                danger
                icon="call"
                label="End"
                size={64}
              />
            </View>
          ) : TERMINAL.has(phase) ? (
            <View className="items-center">
              <Text className="text-slate-400 text-sm">Closing…</Text>
            </View>
          ) : (
            <View className="flex-row items-center justify-center">
              <ControlBtn
                onPress={endCall}
                danger
                icon="call"
                label="Cancel"
                size={68}
              />
            </View>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}
