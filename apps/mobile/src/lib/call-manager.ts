/**
 * Voice/video call manager — production-oriented RTCPeerConnection lifecycle.
 *
 * Responsibilities:
 *  - Clear call phases for caller & callee (calling → ringing → connecting → …)
 *  - Ring timeout, cancel-before-answer, busy, quick-reply declines
 *  - ICE reconnect / hold / mute / speaker / camera
 *  - Durable call-history + chat system notices on terminal outcomes
 *
 * Native modules (WebRTC, InCallManager) load lazily so Expo Go doesn't brick
 * the whole app — calling simply reports "unavailable".
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

export function isCallingAvailable(): boolean {
  return getWebRTC() !== null;
}

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

export function isSpeakerAvailable(): boolean {
  return getInCall() !== null;
}

type MediaStream = any;
import type { CallSignal, IncomingCallSignal } from "@tabcom/shared";
import { sendCallSignal, updatePresence, isRealtimeConnected } from "./realtime";
import type { CallOutcome } from "./local-storage";

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
  iceCandidatePoolSize: 4,
};

/** How long the caller waits for an answer before timing out. */
const RING_TIMEOUT_MS = 45_000;
/** How long we stay in "reconnecting" before declaring the call failed. */
const RECONNECT_GRACE_MS = 20_000;

export type CallPhase =
  | "idle"
  | "calling"       // acquiring media / building offer
  | "ringing"       // offer out / incoming ring
  | "connecting"    // answer exchanged, ICE in flight
  | "connected"
  | "reconnecting"
  | "on-hold"
  | "ended"
  | "declined"
  | "busy"
  | "cancelled"
  | "timed-out"
  | "offline"
  | "no-internet"
  | "failed"
  | "mic-blocked"
  | "poor-network";

export type CallRole = "caller" | "callee";

export type NetworkQuality = "good" | "fair" | "poor" | "unknown";

export interface CallState {
  phase: CallPhase;
  peer: { username: string; name: string; color: string };
  role: CallRole;
  muted: boolean;
  speaker: boolean;
  video: boolean;
  videoEnabled: boolean;
  onHold: boolean;
  startedAt: number | null;
  ringStartedAt: number | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  networkQuality: NetworkQuality;
  statusDetail: string | null;
  quickReply: string | null;
}

export const QUICK_REPLIES = [
  "I'm busy",
  "I'll call you later",
  "In a meeting",
  "Can't talk now",
] as const;

type Listener = (state: CallState) => void;

let pc: any = null;
let listeners = new Set<Listener>();
let pendingOffer: IncomingCallSignal | null = null;
let pendingCandidates: unknown[] = [];
let ringTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let statsTimer: ReturnType<typeof setInterval> | null = null;
let callSessionId: string | null = null;
let recorded = false;

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
  videoEnabled: true,
  onHold: false,
  startedAt: null,
  ringStartedAt: null,
  localStream: null,
  remoteStream: null,
  networkQuality: "unknown",
  statusDetail: null,
  quickReply: null,
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

function clearTimers() {
  if (ringTimer) { clearTimeout(ringTimer); ringTimer = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
}

function startAudioSession(video: boolean, role: CallRole) {
  const ic = getInCall();
  if (!ic) return;
  try {
    ic.stopRingtone?.();
    ic.start({
      media: video ? "video" : "audio",
      auto: true,
      ringback: role === "caller" ? "_DTMF_" : "",
    });
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

function outcomeFromPhase(phase: CallPhase): CallOutcome | null {
  switch (phase) {
    case "ended":
      return state.startedAt ? "answered" : "cancelled";
    case "declined":
      return "declined";
    case "busy":
      return "busy";
    case "cancelled":
      return "cancelled";
    case "timed-out":
      return state.role === "callee" ? "missed" : "timed_out";
    case "offline":
    case "no-internet":
      return "offline";
    case "failed":
    case "mic-blocked":
      return "failed";
    default:
      return null;
  }
}

function recordTerminal(phase: CallPhase) {
  if (recorded || !state.peer.username) return;
  const outcome = outcomeFromPhase(phase);
  if (!outcome) return;
  recorded = true;
  const endedAt = Date.now();
  const durationMs =
    state.startedAt && outcome === "answered"
      ? endedAt - state.startedAt
      : undefined;
  try {
    const { useCallHistory } = require("@/stores/call-history") as typeof import("@/stores/call-history");
    useCallHistory.getState().record({
      id: callSessionId ?? undefined,
      peerUsername: state.peer.username,
      peerName: state.peer.name,
      peerColor: state.peer.color,
      direction: state.role === "caller" ? "outgoing" : "incoming",
      video: state.video,
      outcome,
      startedAt: state.ringStartedAt ?? state.startedAt ?? endedAt,
      endedAt,
      durationMs,
      quickReply: state.quickReply ?? undefined,
      seen: outcome !== "missed",
    });
  } catch { /* history is best-effort */ }
}

function teardown() {
  clearTimers();
  restorePresence();
  stopAudioSession();
  try { pc?.close(); } catch { /* already closed */ }
  pc = null;
  state.localStream?.getTracks().forEach((t: any) => t.stop());
  pendingOffer = null;
  pendingCandidates = [];
  state = {
    ...state,
    localStream: null,
    remoteStream: null,
    startedAt: null,
    speaker: false,
    onHold: false,
    videoEnabled: true,
    networkQuality: "unknown",
    statusDetail: null,
  };
}

async function acquireMedia(video: boolean): Promise<MediaStream | null> {
  try {
    const rtc = getWebRTC();
    if (!rtc) {
      update({ phase: "failed", statusDetail: "Calling isn't available in this build" });
      return null;
    }
    const stream = (await rtc.mediaDevices.getUserMedia({
      audio: true,
      video: video
        ? { width: 1280, height: 720, frameRate: 30, facingMode: "user" }
        : false,
    })) as MediaStream;
    update({ localStream: stream, videoEnabled: video });
    return stream;
  } catch (err: any) {
    const blocked = err?.name === "NotAllowedError" || err?.name === "SecurityError";
    update({
      phase: blocked ? "mic-blocked" : "failed",
      statusDetail: blocked
        ? "Microphone or camera permission is required"
        : "Couldn't access microphone/camera",
    });
    return null;
  }
}

function startStatsMonitor(conn: any) {
  if (statsTimer) clearInterval(statsTimer);
  statsTimer = setInterval(async () => {
    if (!conn) return;
    if (state.phase !== "connected" && state.phase !== "poor-network") return;
    try {
      const report = await conn.getStats();
      let rtt = 0;
      let packetsLost = 0;
      let packetsReceived = 0;
      report.forEach((r: any) => {
        if (r.type === "candidate-pair" && r.state === "succeeded") {
          rtt = r.currentRoundTripTime ?? r.totalRoundTripTime ?? rtt;
        }
        if (r.type === "inbound-rtp" && !r.isRemote) {
          packetsLost += r.packetsLost ?? 0;
          packetsReceived += r.packetsReceived ?? 0;
        }
      });
      const loss =
        packetsReceived + packetsLost > 0
          ? packetsLost / (packetsReceived + packetsLost)
          : 0;
      let networkQuality: NetworkQuality = "good";
      if (rtt > 0.4 || loss > 0.08) networkQuality = "poor";
      else if (rtt > 0.2 || loss > 0.03) networkQuality = "fair";
      if (networkQuality !== state.networkQuality) {
        const nextPhase: CallPhase =
          networkQuality === "poor"
            ? "poor-network"
            : state.phase === "poor-network"
              ? "connected"
              : state.phase;
        update({
          networkQuality,
          statusDetail:
            networkQuality === "poor"
              ? "Poor connection — audio may be choppy"
              : networkQuality === "fair"
                ? "Unstable connection"
                : null,
          phase: nextPhase,
        });
      }
    } catch { /* stats optional */ }
  }, 3000);
}

function buildPeerConnection(stream: MediaStream): any {
  const rtc = getWebRTC();
  if (!rtc) throw new Error("WebRTC unavailable");
  const conn = new rtc.RTCPeerConnection(RTC_CONFIG) as any;
  pc = conn;

  stream.getTracks().forEach((track: any) => conn.addTrack(track, stream));

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
    const cs = (conn as any).connectionState;
    switch (cs) {
      case "connected":
        getInCall()?.stopRingback?.();
        getInCall()?.stopRingtone?.();
        clearTimers();
        update({
          phase: "connected",
          startedAt: state.startedAt ?? Date.now(),
          statusDetail: null,
          networkQuality: "good",
        });
        startStatsMonitor(conn);
        break;
      case "disconnected":
        update({ phase: "reconnecting", statusDetail: "Reconnecting…" });
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          if (state.phase === "reconnecting") {
            recordTerminal("failed");
            teardown();
            update({ phase: "failed", statusDetail: "Connection timed out" });
          }
        }, RECONNECT_GRACE_MS);
        // Attempt ICE restart
        void restartIce().catch(() => {});
        break;
      case "failed":
        recordTerminal("failed");
        teardown();
        update({ phase: "failed", statusDetail: "Connection failed" });
        break;
      case "closed":
        break;
    }
  };

  (conn as any).oniceconnectionstatechange = () => {
    const ice = (conn as any).iceConnectionState;
    if (ice === "checking" && state.phase === "ringing") {
      update({ phase: "connecting", statusDetail: "Connecting…" });
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

async function restartIce() {
  if (!pc || state.role !== "caller") return;
  try {
    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);
    signal(state.peer.username, {
      kind: "renegotiate",
      sdp: (offer as any).sdp,
      video: state.video,
    });
  } catch { /* best-effort */ }
}

function armRingTimeout() {
  if (ringTimer) clearTimeout(ringTimer);
  ringTimer = setTimeout(() => {
    if (!["ringing", "calling"].includes(state.phase)) return;
    if (state.role === "caller") {
      signal(state.peer.username, { kind: "timeout", video: state.video });
      recordTerminal("timed-out");
      teardown();
      update({ phase: "timed-out", statusDetail: "No answer" });
    } else {
      // Callee didn't pick up — missed call
      getInCall()?.stopRingtone?.();
      recordTerminal("timed-out");
      teardown();
      update({ phase: "timed-out", statusDetail: "Missed call" });
    }
  }, RING_TIMEOUT_MS);
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

/** Human label for the current phase — used by the call screen. */
export function phaseLabel(s: CallState): string {
  switch (s.phase) {
    case "idle": return "Starting…";
    case "calling": return "Calling…";
    case "ringing":
      return s.role === "caller" ? "Ringing…" : (s.video ? "Incoming video call" : "Incoming voice call");
    case "connecting": return "Connecting…";
    case "connected": return "";
    case "reconnecting": return "Reconnecting…";
    case "on-hold": return "On hold";
    case "ended": return "Call ended";
    case "declined":
      return s.quickReply ? `Declined — “${s.quickReply}”` : "Declined";
    case "busy": return "Busy";
    case "cancelled": return "Call cancelled";
    case "timed-out":
      return s.role === "caller" ? "No answer" : "Missed call";
    case "offline": return "User offline";
    case "no-internet": return "No internet";
    case "failed": return s.statusDetail ?? "Couldn't connect";
    case "mic-blocked": return "Permission needed";
    case "poor-network": return "Poor network";
    default: return s.phase;
  }
}

export async function startCall(
  peer: { username: string; name: string; color: string },
  video = false
) {
  if (["ringing", "calling", "connecting", "connected", "reconnecting", "on-hold"].includes(state.phase)) {
    return;
  }
  if (!isCallingAvailable()) {
    update({ phase: "failed", peer, role: "caller", statusDetail: "Calling isn't available in this build" });
    return;
  }
  if (!isRealtimeConnected()) {
    callSessionId = `call-${Date.now().toString(36)}`;
    recorded = false;
    update({
      phase: "no-internet",
      peer,
      role: "caller",
      statusDetail: "Connect to the internet to place a call",
      ringStartedAt: Date.now(),
    });
    recordTerminal("no-internet");
    return;
  }

  callSessionId = `call-${Date.now().toString(36)}`;
  recorded = false;
  markBusy();
  update({
    phase: "calling",
    peer,
    role: "caller",
    muted: false,
    video,
    videoEnabled: video,
    onHold: false,
    startedAt: null,
    ringStartedAt: Date.now(),
    statusDetail: "Calling…",
    quickReply: null,
    networkQuality: "unknown",
  });

  const stream = await acquireMedia(video);
  if (!stream) {
    recordTerminal(state.phase === "mic-blocked" ? "mic-blocked" : "failed");
    return;
  }

  startAudioSession(video, "caller");
  const conn = buildPeerConnection(stream);
  const offer = await conn.createOffer({});
  await conn.setLocalDescription(offer);
  signal(peer.username, { kind: "offer", video, sdp: (offer as any).sdp });
  update({ phase: "ringing", statusDetail: "Ringing…" });
  armRingTimeout();
}

export async function acceptCall() {
  if (!pendingOffer?.signal.sdp) return;
  const wantsVideo = !!pendingOffer.signal.video;
  clearTimers();
  update({ phase: "connecting", video: wantsVideo, statusDetail: "Connecting…" });

  const stream = await acquireMedia(wantsVideo);
  if (!stream) {
    recordTerminal(state.phase === "mic-blocked" ? "mic-blocked" : "failed");
    return;
  }

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

export function declineCall(quickReply?: string) {
  if (quickReply) {
    signal(state.peer.username, {
      kind: "quick_reply",
      text: quickReply,
      video: state.video,
    });
  } else {
    signal(state.peer.username, { kind: "reject" });
  }
  update({ quickReply: quickReply ?? null });
  recordTerminal("declined");
  const peer = { ...state.peer };
  teardown();
  update({ phase: "declined", quickReply: quickReply ?? null });

  // Mirror the quick reply into the conversation as an outgoing text.
  if (quickReply && peer.username) {
    try {
      const { useChatStore } = require("@/stores/chat");
      const contactId = `u-${peer.username}`;
      const convId = useChatStore.getState().startConversation(contactId);
      useChatStore.getState().sendText(convId, quickReply);
    } catch { /* best-effort */ }
  }
}

export function endCall() {
  if (state.role === "caller" && ["calling", "ringing"].includes(state.phase)) {
    signal(state.peer.username, { kind: "cancel", video: state.video });
    recordTerminal("cancelled");
    teardown();
    update({ phase: "cancelled", statusDetail: "Call cancelled" });
    return;
  }
  if (state.peer.username) signal(state.peer.username, { kind: "end" });
  recordTerminal(state.startedAt ? "ended" : "cancelled");
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
  if (tracks.length === 0) return;
  const next = !state.videoEnabled;
  tracks.forEach((t: any) => { t.enabled = next; });
  update({ videoEnabled: next });
}

export function switchCamera() {
  state.localStream?.getVideoTracks().forEach((t: any) => t._switchCamera?.());
}

export function toggleHold() {
  const next = !state.onHold;
  state.localStream?.getTracks().forEach((t: any) => { t.enabled = !next; });
  signal(state.peer.username, { kind: next ? "hold" : "resume", video: state.video });
  update({
    onHold: next,
    phase: next ? "on-hold" : "connected",
    statusDetail: next ? "On hold" : null,
  });
}

export function handleCallSignal(payload: IncomingCallSignal) {
  const { signal: incoming, from } = payload;

  switch (incoming.kind) {
    case "offer": {
      if (["connected", "connecting", "reconnecting", "on-hold", "calling", "ringing"].includes(state.phase)) {
        signal(from.username, { kind: "busy" });
        return;
      }
      callSessionId = `call-${Date.now().toString(36)}`;
      recorded = false;
      pendingOffer = payload;
      markBusy();
      getInCall()?.startRingtone?.("_DEFAULT_", "", "", Math.ceil(RING_TIMEOUT_MS / 1000));
      update({
        phase: "ringing",
        peer: from,
        role: "callee",
        muted: false,
        video: !!incoming.video,
        videoEnabled: !!incoming.video,
        startedAt: null,
        ringStartedAt: Date.now(),
        statusDetail: null,
        quickReply: null,
      });
      // Tell caller their phone is ringing
      signal(from.username, { kind: "ringing", video: !!incoming.video });
      armRingTimeout();
      break;
    }

    case "ringing":
      if (state.role === "caller" && state.phase === "ringing") {
        update({ statusDetail: "Ringing…" });
      }
      break;

    case "answer":
      if (pc && incoming.sdp) {
        clearTimers();
        update({ phase: "connecting", statusDetail: "Connecting…" });
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
      if (pc && (pc as any).remoteDescription) {
        const rtcC = getWebRTC();
        if (rtcC) {
          pc.addIceCandidate(new rtcC.RTCIceCandidate(incoming.candidate as any)).catch(() => {});
        }
      } else {
        pendingCandidates.push(incoming.candidate);
      }
      break;

    case "renegotiate":
      if (pc && incoming.sdp) {
        const rtc = getWebRTC();
        if (!rtc) break;
        pc.setRemoteDescription(
          new rtc.RTCSessionDescription({ type: "offer", sdp: incoming.sdp })
        )
          .then(async () => {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            signal(state.peer.username, { kind: "answer", sdp: (answer as any).sdp });
          })
          .catch(() => {});
      }
      break;

    case "reject":
      recordTerminal("declined");
      teardown();
      update({ phase: "declined" });
      break;

    case "quick_reply":
      update({ quickReply: incoming.text ?? null });
      recordTerminal("declined");
      teardown();
      update({ phase: "declined", quickReply: incoming.text ?? null });
      // The callee also sends a real DM with the same text — don't
      // duplicate it here. Call history already records the decline.
      break;

    case "busy":
      recordTerminal("busy");
      teardown();
      update({ phase: "busy", statusDetail: "Busy" });
      break;

    case "cancel":
    case "timeout":
      if (state.role === "callee" && state.phase === "ringing") {
        getInCall()?.stopRingtone?.();
        recordTerminal(incoming.kind === "timeout" ? "timed-out" : "cancelled");
        teardown();
        update({
          phase: incoming.kind === "timeout" ? "timed-out" : "cancelled",
          statusDetail: incoming.kind === "timeout" ? "Missed call" : "Caller cancelled",
        });
      } else if (state.role === "caller") {
        recordTerminal(incoming.kind === "timeout" ? "timed-out" : "cancelled");
        teardown();
        update({
          phase: incoming.kind === "timeout" ? "timed-out" : "cancelled",
        });
      }
      break;

    case "hold":
      update({ onHold: true, phase: "on-hold", statusDetail: `${from.name} put the call on hold` });
      break;

    case "resume":
      update({ onHold: false, phase: "connected", statusDetail: null });
      break;

    case "end":
      recordTerminal(state.startedAt ? "ended" : "cancelled");
      teardown();
      update({ phase: "ended" });
      break;
  }
}

/** Map socket call_error reasons onto visible phases. */
export function handleCallError(reason: string) {
  if (!["calling", "ringing", "connecting"].includes(state.phase) && state.phase !== "idle") {
    // Mid-call errors shouldn't nuke a live session; reconnect path handles those.
    if (state.phase === "connected" || state.phase === "reconnecting" || state.phase === "on-hold" || state.phase === "poor-network") {
      return;
    }
  }
  const map: Record<string, { phase: CallPhase; detail: string }> = {
    recipient_unavailable: { phase: "offline", detail: "User offline" },
    recipient_offline: { phase: "offline", detail: "User offline" },
    caller_offline: { phase: "offline", detail: "You're marked offline" },
    not_connected: { phase: "failed", detail: "You need to be connected to call" },
  };
  const hit = map[reason] ?? { phase: "failed" as CallPhase, detail: "Call failed" };
  recorded = false;
  // Apply peer/phase before recording so history captures the right outcome.
  update({ phase: hit.phase, statusDetail: hit.detail });
  recordTerminal(hit.phase);
  teardown();
  update({ phase: hit.phase, statusDetail: hit.detail });
}

/** Socket dropped mid-call — surface reconnect UI and arm grace timer. */
export function onNetworkLost() {
  if (!["connected", "poor-network", "on-hold", "connecting"].includes(state.phase)) return;
  update({ phase: "reconnecting", statusDetail: "No internet — reconnecting…" });
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    if (state.phase === "reconnecting") {
      recordTerminal("failed");
      teardown();
      update({ phase: "failed", statusDetail: "Connection timed out" });
    }
  }, RECONNECT_GRACE_MS);
}

/** Transport restored — try ICE restart and clear the reconnect banner. */
export function onNetworkRestored() {
  if (state.phase !== "reconnecting" && state.phase !== "poor-network") return;
  update({
    statusDetail: "Connection restored — reconnecting media…",
  });
  void restartIce().catch(() => {});
}
