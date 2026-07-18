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

  (conn as any).onicecandidate = (event: any) => {
    if (event.candidate) {
      signal(state.peer.username, {
        kind: "ice",
        candidate: event.candidate.toJSON(),
      });
    }
  };

  (conn as any).onconnectionstatechange = () => {
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
  };

  (conn as any).ontrack = (_event: any) => {
    // On React Native, audio plays automatically through the
    // earpiece/speaker when the remote track is added.
  };

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
    return;
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
  const { signal: incoming } = payload;

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
