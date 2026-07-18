#!/bin/bash
set -euo pipefail

# ─── Build 8: Voice calls ────────────────────────────────────────────
# Run from: tabcom root
# Creates/overwrites:
#   apps/mobile/package.json                        (adds react-native-webrtc)
#   apps/mobile/app/call/[peer].tsx                  (new — call screen)
#   apps/mobile/src/lib/call-manager.ts              (new — WebRTC + signaling)
#   apps/mobile/src/components/CallButton.tsx         (new — reusable call CTA)
#   apps/mobile/app/conversation/[id].tsx             (overwrite — adds call button)
# ──────────────────────────────────────────────────────────────────────

echo "🔧 Build 8: applying voice calls..."

if [ ! -f "package.json" ] || ! grep -q '"tabcom"' package.json; then
  echo "❌ Run this from the tabcom monorepo root."
  exit 1
fi

mkdir -p apps/mobile/app/call apps/mobile/src/lib apps/mobile/src/components

# ── 0. Add react-native-webrtc to package.json ──
cd apps/mobile
python3 -c "
import json
p = json.load(open('package.json'))
p['dependencies']['react-native-webrtc'] = '^124.0.7'
json.dump(p, open('package.json', 'w'), indent=2)
"
cd ../..

# ── 1. Call manager — WebRTC peer connection + signaling ──
cat > apps/mobile/src/lib/call-manager.ts << 'CMEOF'
/**
 * Voice call manager — owns the RTCPeerConnection and media lifecycle.
 *
 * Architecture mirrors the extension's call window (entrypoints/call),
 * with these mobile adaptations:
 *   - react-native-webrtc instead of browser WebRTC APIs
 *   - No separate window — the call screen is an expo-router page
 *   - No browser.runtime.connect port — signals go through the
 *     existing Socket.IO call_signal channel directly
 *
 * Media is peer-to-peer WebRTC with DTLS-SRTP end-to-end encryption.
 * No media ever touches the Tabcom server — only signaling messages
 * (offer/answer/ICE candidates) are relayed.
 */

import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
  MediaStream,
} from "react-native-webrtc";
import type { CallSignal, IncomingCallSignal } from "@tabcom/shared";
import { sendCallSignal } from "./realtime";

const RTC_CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export type CallPhase =
  | "ringing"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "ended"
  | "declined"
  | "busy"
  | "failed"
  | "mic-blocked";

export type CallRole = "caller" | "callee";

export interface CallState {
  phase: CallPhase;
  peer: { username: string; name: string; color: string };
  role: CallRole;
  muted: boolean;
  startedAt: number | null;
}

type Listener = (state: CallState) => void;

let pc: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;
let pendingOffer: IncomingCallSignal | null = null;
let listener: Listener | null = null;

let state: CallState = {
  phase: "ended",
  peer: { username: "", name: "", color: "#334155" },
  role: "caller",
  muted: false,
  startedAt: null,
};

function emit() {
  listener?.({ ...state });
}

function update(partial: Partial<CallState>) {
  state = { ...state, ...partial };
  emit();
}

function signal(to: string, payload: CallSignal) {
  sendCallSignal(to, payload);
}

function cleanup() {
  pc?.close();
  pc = null;
  localStream?.getTracks().forEach((t: any) => t.stop());
  localStream = null;
  pendingOffer = null;
}

async function acquireAudio(): Promise<MediaStream | null> {
  try {
    const stream = await mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
    localStream = stream as MediaStream;
    return localStream;
  } catch (err: any) {
    update({ phase: err?.name === "NotAllowedError" ? "mic-blocked" : "failed" });
    return null;
  }
}

function buildPC(stream: MediaStream): RTCPeerConnection {
  const conn = new RTCPeerConnection(RTC_CONFIG);
  pc = conn;

  stream.getTracks().forEach((track: any) => {
    conn.addTrack(track, stream);
  });

  conn.addEventListener("icecandidate", (event: any) => {
    if (event.candidate) {
      signal(state.peer.username, {
        kind: "ice",
        candidate: event.candidate.toJSON(),
      });
    }
  });

  conn.addEventListener("connectionstatechange", () => {
    switch ((conn as any).connectionState) {
      case "connected":
        update({ phase: "connected", startedAt: state.startedAt ?? Date.now() });
        break;
      case "disconnected":
        update({ phase: "reconnecting" });
        break;
      case "failed":
        update({ phase: "failed" });
        cleanup();
        break;
    }
  });

  // Handle remote audio via ontrack
  conn.addEventListener("track", (_event: any) => {
    // On React Native, audio plays automatically through the
    // earpiece/speaker when the remote track is added.
  });

  return conn;
}

// ── Public API ──────────────────────────────────────────────────────

export function subscribe(fn: Listener) {
  listener = fn;
  fn({ ...state });
  return () => { listener = null; };
}

export function getCallState(): CallState {
  return { ...state };
}

export async function startCall(
  peer: { username: string; name: string; color: string }
) {
  if (state.phase === "connected" || state.phase === "ringing" || state.phase === "connecting") {
    return; // already in a call
  }

  update({
    phase: "ringing",
    peer,
    role: "caller",
    muted: false,
    startedAt: null,
  });

  const stream = await acquireAudio();
  if (!stream) return;

  const conn = buildPC(stream);
  const offer = await conn.createOffer({});
  await conn.setLocalDescription(offer);

  signal(peer.username, {
    kind: "offer",
    video: false,
    sdp: (offer as any).sdp,
  });
}

export function receiveIncomingCall(payload: IncomingCallSignal) {
  if (state.phase === "connected" || state.phase === "connecting") {
    // Already in a call — send busy
    signal(payload.from.username, { kind: "busy" });
    return;
  }

  pendingOffer = payload;
  update({
    phase: "ringing",
    peer: payload.from,
    role: "callee",
    muted: false,
    startedAt: null,
  });
}

export async function acceptCall() {
  if (!pendingOffer?.signal.sdp) return;
  update({ phase: "connecting" });

  const stream = await acquireAudio();
  if (!stream) return;

  const conn = buildPC(stream);
  await conn.setRemoteDescription(
    new RTCSessionDescription({ type: "offer", sdp: pendingOffer.signal.sdp })
  );
  const answer = await conn.createAnswer();
  await conn.setLocalDescription(answer);

  signal(state.peer.username, {
    kind: "answer",
    sdp: (answer as any).sdp,
  });
}

export function declineCall() {
  signal(state.peer.username, { kind: "reject" });
  cleanup();
  update({ phase: "declined" });
}

export function endCall() {
  signal(state.peer.username, { kind: "end" });
  cleanup();
  update({ phase: "ended" });
}

export function toggleMute() {
  const next = !state.muted;
  localStream?.getAudioTracks().forEach((t: any) => { t.enabled = !next; });
  update({ muted: next });
}

export function handleCallSignal(payload: IncomingCallSignal) {
  const { signal: incoming, from } = payload;

  switch (incoming.kind) {
    case "offer":
      receiveIncomingCall(payload);
      break;

    case "answer":
      if (pc && incoming.sdp) {
        update({ phase: "connecting" });
        pc.setRemoteDescription(
          new RTCSessionDescription({ type: "answer", sdp: incoming.sdp })
        );
      }
      break;

    case "ice":
      if (pc && incoming.candidate) {
        try {
          pc.addIceCandidate(new RTCIceCandidate(incoming.candidate as any));
        } catch {
          // Candidates can race the remote description
        }
      }
      break;

    case "reject":
      cleanup();
      update({ phase: "declined" });
      break;

    case "busy":
      cleanup();
      update({ phase: "busy" });
      break;

    case "end":
      cleanup();
      update({ phase: "ended" });
      break;
  }
}
CMEOF

# ── 2. Call screen ──
cat > apps/mobile/app/call/\[peer\].tsx << 'CSEOF'
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
CSEOF

# ── 3. CallButton component ──
cat > apps/mobile/src/components/CallButton.tsx << 'CBEOF'
import { Pressable, Text } from "react-native";
import { useRouter } from "expo-router";
import { startCall } from "@/lib/call-manager";

interface Props {
  peer: { username: string; name: string; color: string };
}

export function CallButton({ peer }: Props) {
  const router = useRouter();

  const handlePress = () => {
    startCall(peer);
    router.push(
      `/call/${peer.username}?peerName=${encodeURIComponent(peer.name)}&peerColor=${encodeURIComponent(peer.color)}&role=caller` as any
    );
  };

  return (
    <Pressable
      onPress={handlePress}
      className="px-3 py-1.5 bg-green-600/20 border border-green-900/30 rounded-lg active:opacity-70"
    >
      <Text className="text-green-400 text-xs font-semibold">📞 Call</Text>
    </Pressable>
  );
}
CBEOF

# ── 4. Update conversation screen with call button ──
cat > apps/mobile/app/conversation/\[id\].tsx << 'CONVEOF'
import { useEffect, useRef, useState } from "react";
import {
  Text, View, TextInput, Pressable, FlatList,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useChatStore } from "@/stores/chat";
import { MessageBubble } from "@/components/MessageBubble";
import { CallButton } from "@/components/CallButton";

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [text, setText] = useState("");
  const listRef = useRef<FlatList>(null);

  const conversation = useChatStore((s) => s.conversations.find((c) => c.id === id));
  const messages = useChatStore((s) => s.messages[id ?? ""] ?? []);
  const contacts = useChatStore((s) => s.contacts);
  const communities = useChatStore((s) => s.communities);
  const typing = useChatStore((s) => s.typing);

  useEffect(() => {
    if (id) useChatStore.getState().openConversation(id);
    return () => useChatStore.getState().closeConversation();
  }, [id]);

  if (!conversation || !id) {
    return (
      <SafeAreaView className="flex-1 bg-ink items-center justify-center">
        <Text className="text-neutral-500">Conversation not found</Text>
      </SafeAreaView>
    );
  }

  const isDm = conversation.kind === "dm";
  const contact = isDm ? contacts.find((c) => c.id === conversation.contactId) : null;

  const title = isDm
    ? contact?.alias ?? contact?.name ?? "Unknown"
    : conversation.communityId
      ? communities[conversation.communityId]?.name ?? "Community"
      : "Unknown";

  const isTyping = contact ? typing.includes(contact.id) : false;

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    useChatStore.getState().sendText(id, trimmed);
    setText("");
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const visibleMessages = messages.filter((m) => m.kind !== "system" || m.text);

  return (
    <SafeAreaView className="flex-1 bg-ink" edges={["top"]}>
      <View className="flex-row items-center px-4 py-3 border-b border-line">
        <Pressable onPress={() => router.back()} className="mr-3">
          <Text className="text-neutral-400 text-lg">←</Text>
        </Pressable>
        <View className="flex-1">
          <Text className="text-white font-semibold text-base" numberOfLines={1}>
            {title}
          </Text>
          {isTyping && <Text className="text-accent text-xs">typing…</Text>}
          {contact && !isTyping && (
            <Text className="text-neutral-500 text-xs">{contact.presence}</Text>
          )}
        </View>
        {/* Call button for DMs only */}
        {isDm && contact && (
          <CallButton peer={{ username: contact.username, name: contact.name, color: contact.color }} />
        )}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={listRef}
          data={visibleMessages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              onRetry={() => useChatStore.getState().retryMessage(id, item.id)}
            />
          )}
          contentContainerStyle={{ paddingVertical: 8 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        />

        <View className="flex-row items-end px-3 py-2 border-t border-line bg-surface">
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Message…"
            placeholderTextColor="#5A5A68"
            multiline
            className="flex-1 bg-card border border-line rounded-2xl px-4 py-3 text-white text-sm max-h-24 mr-2"
          />
          <Pressable
            onPress={send}
            disabled={!text.trim()}
            className={`w-10 h-10 rounded-full items-center justify-center ${
              text.trim() ? "bg-accent" : "bg-accent/40"
            }`}
          >
            <Text className="text-white font-bold">↑</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
CONVEOF

# ── 5. Wire call signals into realtime store ──
cat > apps/mobile/src/stores/realtime.ts << 'RSEOF'
import { create } from "zustand";
import type {
  WireUser,
  WireMessage,
  WireCommunity,
  ConnectionStatus,
  IncomingCallSignal,
  RealtimeHandlers,
} from "@tabcom/shared";
import { useAuth } from "./auth";
import { useChatStore } from "./chat";
import { REALTIME_URL } from "@/lib/config";
import {
  initRealtime,
  disconnectRealtime,
  isRealtimeConnected,
} from "@/lib/realtime";
import { handleCallSignal } from "@/lib/call-manager";

type RealtimeState = {
  connected: boolean;
  connect: () => void;
  disconnect: () => void;
};

export const useRealtime = create<RealtimeState>((set, get) => ({
  connected: false,

  connect: () => {
    if (isRealtimeConnected()) return;

    const auth = useAuth.getState();
    if (!auth.sessionToken || !auth.user) return;

    const me: WireUser = {
      username: auth.user.username ?? "",
      name: auth.user.displayName ?? "",
      color: auth.user.avatarColor ?? "#7C6CF6",
      presence: "online",
      visibility: "public",
    };

    const handlers: RealtimeHandlers = {
      onConnectionChange: (connected) => {
        set({ connected });
        useChatStore.getState().setConnected(connected);
      },
      onRoster: (users) => useChatStore.getState().applyRoster(users),

      onDm: (from, msg) => useChatStore.getState().receiveDm(from, msg),
      onDmEdited: (from, id, text, at) => useChatStore.getState().receiveDmEdited(from, id, text, at),
      onDmDeleted: (from, id) => useChatStore.getState().receiveDmDeleted(from, id),
      onDmReaction: (from, id, emoji) => useChatStore.getState().receiveDmReaction(from, id, emoji),
      onDmReadReceipt: (from, id, at) => useChatStore.getState().receiveDmReadReceipt(from, id, at),
      onTyping: (from) => useChatStore.getState().receiveTyping(from),
      onDmError: (to, reason) => useChatStore.getState().receiveDmError(to, reason),

      onConnections: (snapshot) => useChatStore.getState().receiveConnections(snapshot),
      onConnectRequest: (from) => useChatStore.getState().receiveConnectRequest(from),
      onConnectUpdate: (username, status) => useChatStore.getState().receiveConnectUpdate(username, status),

      onCommunities: (list) => useChatStore.getState().receiveCommunities(list),
      onCommunityUpdate: (c) => useChatStore.getState().receiveCommunityUpdate(c),
      onCommunityInvite: (c, from, attempt) => useChatStore.getState().receiveCommunityInvite(c, from, attempt),
      onCommunityDeclined: () => {},
      onCommunityLeft: (id) => useChatStore.getState().receiveCommunityLeft(id),
      onCommunityDeleted: (id) => useChatStore.getState().receiveCommunityDeleted(id),
      onCommunityInviteCancelled: () => {},
      onCommunityMessage: (cid, from, msg) => useChatStore.getState().receiveCommunityMessage(cid, from, msg),
      onCommunityMessageEdited: (cid, from, id, text, at) => useChatStore.getState().receiveCommunityMessageEdited(cid, from, id, text, at),
      onCommunityMessageDeleted: (cid, from, id) => useChatStore.getState().receiveCommunityMessageDeleted(cid, from, id),
      onCommunityReaction: (cid, from, id, emoji) => useChatStore.getState().receiveCommunityReaction(cid, from, id, emoji),
      onCommunityError: () => {},

      // Calls — routed directly into the call manager
      onCallSignal: (payload) => handleCallSignal(payload),
    };

    initRealtime(me, handlers, REALTIME_URL, auth.sessionToken);
    setTimeout(() => useChatStore.getState().restoreConnections(), 2000);
  },

  disconnect: () => {
    disconnectRealtime();
    set({ connected: false });
  },
}));
RSEOF

echo ""
echo "✅ Build 8 files written."
echo ""
echo "⚠️  react-native-webrtc is a NATIVE module — Expo Go can't run it."
echo "   You need a development build. After running this script:"
echo ""
echo "   cd apps/mobile"
echo "   pnpm install          # from monorepo root"
echo "   npx expo prebuild --platform android"
echo "   npx expo run:android"
echo ""
echo "   This generates the android/ folder and builds a dev client APK."
echo "   Subsequent changes hot-reload as before."
echo ""

cd apps/mobile && npx tsc --noEmit && echo "✅ Build 8 typecheck passed."
