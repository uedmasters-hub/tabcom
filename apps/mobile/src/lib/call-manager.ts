/**
 * Voice/video call manager — owns the RTCPeerConnection lifecycle.
 *
 * Mirrors the extension's call window, adapted for React Native:
 *   - react-native-webrtc instead of browser WebRTC
 *   - signalling rides the existing call_signal socket event
 *   - media is peer-to-peer (DTLS-SRTP); nothing touches the server
 *
 * NOTE: react-native-webrtc is a native module — this file only works
 * in a development/release build, never in Expo Go. The type defs are
 * incomplete, hence the `as any` casts on the event-handler props.
 */
/**
 * react-native-webrtc is loaded LAZILY and GUARDED.
 *
 * A top-level import here meant that if the native module was missing
 * (Expo Go, or a build made before the dependency was added), the throw
 * propagated through expo-router's route validation and took down every
 * screen in the app — not just calls. A missing native module should
 * degrade one feature, not brick the product.
 */
type WebRTC = typeof import("react-native-webrtc");

let webrtc: WebRTC | null = null;
let webrtcChecked = false;

function getWebRTC(): WebRTC | null {
  if (!webrtcChecked) {
    webrtcChecked = true;
    try {
      webrtc = require("react-native-webrtc");
    } catch {
      webrtc = null;
    }
  }
  return webrtc;
}

/** True when calling is actually available on this build. */
export function isCallingAvailable(): boolean {
  return getWebRTC() !== null;
}

/**
 * react-native-incall-manager owns the audio *session* — earpiece vs
 * speaker routing, the proximity sensor, and ring/ringback tones. It's
 * loaded lazily and guarded exactly like WebRTC: if the native module
 * isn't in the build, speaker control simply isn't offered and calls
 * fall back to the platform default route. Nothing crashes.
 */
let incall: any = null;
let incallChecked = false;
function getInCall(): any {
  if (!incallChecked) {
    incallChecked = true;
    try {
      incall = require("react-native-incall-manager").default;
    } catch {
      incall = null;
    }
  }
  return incall;
}

/** True when speaker/earpiece routing can be controlled on this build. */
export function isSpeakerAvailable(): boolean {
  return getInCall() !== null;
}

type MediaStream = any;
import type { CallSignal, IncomingCallSignal } from "@tabcom/shared";
import { sendCallSignal, updatePresence } from "./realtime";

const RTC_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

export type CallPhase =
  | "idle" | "ringing" | "connecting" | "connected"
  | "reconnecting" | "ended" | "declined" | "busy"
  | "failed" | "mic-blocked";

export type CallRole = "caller" | "callee";

export interface CallState {
  phase: CallPhase;
  peer: { username: string; name: string; color: string };
  role: CallRole;
  muted: boolean;
  speaker: boolean;
  video: boolean;
  startedAt: number | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
}

type Listener = (state: CallState) => void;

let pc: any = null;
let listeners = new Set<Listener>();
let pendingOffer: IncomingCallSignal | null = null;
let pendingCandidates: unknown[] = [];

// Presence is flipped to "busy" for the duration of a call and restored
// afterwards. Without the restore, the peer sees you as busy forever —
// which is exactly what the first device test hit.
let presenceBeforeCall: "online" | "away" | "busy" | "offline" | null = null;

function markBusy() {
  if (presenceBeforeCall === null) {
    presenceBeforeCall = "online";
    updatePresence("busy");
  }
}

function restorePresence() {
  if (presenceBeforeCall !== null) {
    updatePresence(presenceBeforeCall);
    presenceBeforeCall = null;
  }
}

let state: CallState = {
  phase: "idle",
  peer: { username: "", name: "", color: "#2563eb" },
  role: "caller",
  muted: false,
  speaker: false,
  video: false,
  startedAt: null,
  localStream: null,
  remoteStream: null,
};

function emit() {
  const snapshot = { ...state };
  listeners.forEach((fn) => fn(snapshot));
}

function update(partial: Partial<CallState>) {
  state = { ...state, ...partial };
  emit();
}

function signal(to: string, payload: CallSignal) {
  sendCallSignal(to, payload);
}

// Bring up the audio session for a live call. Video calls default to
// the loudspeaker (you're holding the phone away from your ear); voice
// calls stay on the earpiece. `ringback` gives the caller the ringing
// tone until the callee answers. All best-effort — a missing module or
// a routing hiccup must never break the call itself.
function startAudioSession(video: boolean, role: CallRole) {
  const ic = getInCall();
  if (!ic) return;
  try {
    ic.stopRingtone?.();
    ic.start({ media: video ? "video" : "audio", auto: true, ringback: role === "caller" ? "_DTMF_" : "" });
    ic.setForceSpeakerphoneOn(video);
    update({ speaker: video });
  } catch { /* best-effort */ }
}

function stopAudioSession() {
  const ic = getInCall();
  if (!ic) return;
  try {
    ic.stopRingtone?.();
    ic.stopRingback?.();
    ic.stop();
  } catch { /* best-effort */ }
}

function teardown() {
  restorePresence();
  stopAudioSession();
  try { pc?.close(); } catch { /* already closed */ }
  pc = null;
  state.localStream?.getTracks().forEach((t: any) => t.stop());
  pendingOffer = null;
  pendingCandidates = [];
  state = { ...state, localStream: null, remoteStream: null, startedAt: null, speaker: false };
}

async function acquireMedia(video: boolean): Promise<MediaStream | null> {
  try {
    const rtc = getWebRTC();
    if (!rtc) {
      update({ phase: "failed" });
      return null;
    }
    const stream = (await rtc.mediaDevices.getUserMedia({
      audio: true,
      video: video ? { width: 1280, height: 720, frameRate: 30 } : false,
    })) as MediaStream;
    update({ localStream: stream });
    return stream;
  } catch (err: any) {
    update({ phase: err?.name === "NotAllowedError" ? "mic-blocked" : "failed" });
    return null;
  }
}

function buildPeerConnection(stream: MediaStream): any {
  const rtc = getWebRTC();
  if (!rtc) throw new Error("WebRTC unavailable");
  const conn = new rtc.RTCPeerConnection(RTC_CONFIG) as any;
  pc = conn;

  stream.getTracks().forEach((track: any) => conn.addTrack(track, stream));

  // react-native-webrtc uses callback props, not addEventListener, and
  // its typings omit them — hence the casts.
  (conn as any).onicecandidate = (event: any) => {
    if (event?.candidate) {
      signal(state.peer.username, { kind: "ice", candidate: event.candidate.toJSON() });
    }
  };

  (conn as any).ontrack = (event: any) => {
    const [remote] = event?.streams ?? [];
    if (remote) update({ remoteStream: remote });
  };

  (conn as any).onconnectionstatechange = () => {
    switch ((conn as any).connectionState) {
      case "connected":
        getInCall()?.stopRingback?.();
        getInCall()?.stopRingtone?.();
        update({ phase: "connected", startedAt: state.startedAt ?? Date.now() });
        break;
      case "disconnected":
        update({ phase: "reconnecting" });
        break;
      case "failed":
        teardown();
        update({ phase: "failed" });
        break;
    }
  };

  return conn;
}

async function drainCandidates() {
  if (!pc) return;
  for (const c of pendingCandidates) {
    try {
      const rtc = getWebRTC();
      if (rtc) await pc.addIceCandidate(new rtc.RTCIceCandidate(c as any));
    } catch { /* ignore */ }
  }
  pendingCandidates = [];
}

// ── Public API ──────────────────────────────────────────────────────

export function subscribe(fn: Listener) {
  listeners.add(fn);
  fn({ ...state });
  return () => { listeners.delete(fn); };
}

export function getCallState(): CallState {
  return { ...state };
}

export async function startCall(
  peer: { username: string; name: string; color: string },
  video = false
) {
  if (["ringing", "connecting", "connected"].includes(state.phase)) return;
  if (!isCallingAvailable()) {
    update({ phase: "failed", peer, role: "caller" });
    return;
  }

  markBusy();
  update({
    phase: "ringing", peer, role: "caller",
    muted: false, video, startedAt: null,
  });

  const stream = await acquireMedia(video);
  if (!stream) return;

  startAudioSession(video, "caller");
  const conn = buildPeerConnection(stream);
  const offer = await conn.createOffer({});
  await conn.setLocalDescription(offer);
  signal(peer.username, { kind: "offer", video, sdp: (offer as any).sdp });
}

export async function acceptCall() {
  if (!pendingOffer?.signal.sdp) return;
  const wantsVideo = !!pendingOffer.signal.video;
  update({ phase: "connecting", video: wantsVideo });

  const stream = await acquireMedia(wantsVideo);
  if (!stream) return;

  startAudioSession(wantsVideo, "callee");
  const conn = buildPeerConnection(stream);
  const rtcA = getWebRTC()!;
  await conn.setRemoteDescription(
    new rtcA.RTCSessionDescription({ type: "offer", sdp: pendingOffer.signal.sdp })
  );
  await drainCandidates();

  const answer = await conn.createAnswer();
  await conn.setLocalDescription(answer);
  signal(state.peer.username, { kind: "answer", sdp: (answer as any).sdp });
}

export function declineCall() {
  signal(state.peer.username, { kind: "reject" });
  teardown();
  update({ phase: "declined" });
}

export function endCall() {
  if (state.peer.username) signal(state.peer.username, { kind: "end" });
  teardown();
  update({ phase: "ended" });
}

export function toggleMute() {
  const next = !state.muted;
  state.localStream?.getAudioTracks().forEach((t: any) => { t.enabled = !next; });
  update({ muted: next });
}

export function toggleSpeaker() {
  const ic = getInCall();
  if (!ic) return;
  const next = !state.speaker;
  try { ic.setForceSpeakerphoneOn(next); } catch { /* best-effort */ }
  update({ speaker: next });
}

export function toggleCamera() {
  const tracks = state.localStream?.getVideoTracks() ?? [];
  tracks.forEach((t: any) => { t.enabled = !t.enabled; });
  emit();
}

export function switchCamera() {
  state.localStream?.getVideoTracks().forEach((t: any) => t._switchCamera?.());
}

export function handleCallSignal(payload: IncomingCallSignal) {
  const { signal: incoming, from } = payload;

  switch (incoming.kind) {
    case "offer":
      if (["connected", "connecting"].includes(state.phase)) {
        signal(from.username, { kind: "busy" });
        return;
      }
      pendingOffer = payload;
      markBusy();
      getInCall()?.startRingtone?.("_DEFAULT_", "", "", 30);
      update({
        phase: "ringing", peer: from, role: "callee",
        muted: false, video: !!incoming.video, startedAt: null,
      });
      break;

    case "answer":
      if (pc && incoming.sdp) {
        update({ phase: "connecting" });
        const rtcB = getWebRTC();
        if (rtcB) {
          pc.setRemoteDescription(
            new rtcB.RTCSessionDescription({ type: "answer", sdp: incoming.sdp })
          ).then(drainCandidates).catch(() => {});
        }
      }
      break;

    case "ice":
      if (!incoming.candidate) return;
      // Candidates can arrive before setRemoteDescription — queue them.
      if (pc && (pc as any).remoteDescription) {
        const rtcC = getWebRTC();
        if (rtcC) {
          pc.addIceCandidate(new rtcC.RTCIceCandidate(incoming.candidate as any)).catch(() => {});
        }
      } else {
        pendingCandidates.push(incoming.candidate);
      }
      break;

    case "reject":
      teardown();
      update({ phase: "declined" });
      break;

    case "busy":
      teardown();
      update({ phase: "busy" });
      break;

    case "end":
      teardown();
      update({ phase: "ended" });
      break;
  }
}
