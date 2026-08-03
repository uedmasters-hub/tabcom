import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from "lucide-react";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";

import "../../src/styles/tailwind.css";
import "../../src/styles/globals.css";
import { Avatar } from "../../src/components/ui";
import { cn } from "../../src/lib/cn";
import type { CallSignal, IncomingCallSignal } from "../../src/lib/realtime";

/**
 * The call window: one per active call, opened by the background script
 * for both outgoing (role=caller) and incoming (role=callee) calls.
 *
 * This window owns the media: getUserMedia + RTCPeerConnection live
 * here, so a call survives the popup closing entirely. Signaling flows
 * over a long-lived Port to the background, which relays through the
 * server's zero-retention call_signal channel. Media itself is
 * peer-to-peer WebRTC — DTLS-SRTP end-to-end encryption is mandatory
 * in the browser's implementation, and no media ever touches the
 * Tabcom server.
 *
 * Closing this window IS hanging up: the background detects the port
 * disconnect and signals "end" to the peer, so a vanished window can
 * never leave the other side hanging. Prefer an explicit cancel/end
 * from this window first so mobile sees the right terminal kind.
 *
 * Signal kinds must stay aligned with packages/shared + mobile
 * call-manager (ringing / cancel / timeout / quick_reply / hold /
 * resume / renegotiate).
 */

const params = new URLSearchParams(location.search);
const PEER = params.get("peer") ?? "";
const PEER_NAME = params.get("peerName") ?? PEER;
const PEER_COLOR = params.get("peerColor") ?? "#334155";
const WANT_VIDEO = params.get("video") === "1";
const ROLE = params.get("role") === "callee" ? "callee" : "caller";

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

/** Match mobile call-manager RING_TIMEOUT_MS. */
const RING_TIMEOUT_MS = 45_000;
const RECONNECT_GIVE_UP_MS = 12_000;

const QUICK_REPLIES = [
  "I'm busy",
  "I'll call you later",
  "In a meeting",
  "Can't talk now",
] as const;

type CallPhase =
  | "ringing"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "on-hold"
  | "ended"
  | "declined"
  | "busy"
  | "cancelled"
  | "timed-out"
  | "failed"
  | "mic-blocked";

function CallApp() {
  const [phase, setPhase] = useState<CallPhase>("ringing");
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(!WANT_VIDEO);
  const [onHold, setOnHold] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [, tick] = useState(0);

  const portRef = useRef<ReturnType<typeof browser.runtime.connect> | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingOfferRef = useRef<IncomingCallSignal | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const phaseRef = useRef<CallPhase>("ringing");
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setPhaseTracked = (next: CallPhase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  useEffect(() => {
    if (startedAt == null) return;
    const interval = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  useEffect(() => {
    const port = browser.runtime.connect({ name: "tabcom-call" });
    portRef.current = port;

    port.onMessage.addListener((message: { type: string; payload?: IncomingCallSignal }) => {
      if (message.type !== "signal" || !message.payload) return;
      void handleSignal(message.payload);
    });

    if (ROLE === "caller") {
      void startAsCaller();
    } else {
      // Tell the caller our UI is up — mobile shows "Ringing…".
      signal({ kind: "ringing", video: WANT_VIDEO });
    }

    const ringTimer = setTimeout(() => {
      const current = phaseRef.current;
      if (current !== "ringing") return;
      if (ROLE === "caller") {
        hangupSignal({ kind: "timeout", video: WANT_VIDEO });
        cleanupMedia();
        setPhaseTracked("timed-out");
        setStatusDetail("No answer");
        setTimeout(() => window.close(), 1500);
      } else {
        hangupSignal({ kind: "timeout", video: WANT_VIDEO });
        cleanupMedia();
        setPhaseTracked("timed-out");
        setStatusDetail("Missed call");
        setTimeout(() => window.close(), 1500);
      }
    }, RING_TIMEOUT_MS);

    return () => {
      clearTimeout(ringTimer);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      cleanupMedia();
      port.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signal = (payload: CallSignal) => {
    portRef.current?.postMessage({ type: "signal", to: PEER, signal: payload });
  };

  /** Terminal hangups — background skips its disconnect "end" once
   *  these have been sent, so the peer doesn't get a double hangup. */
  const hangupSignal = (payload: CallSignal) => {
    signal(payload);
  };

  const cleanupMedia = () => {
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    pendingIceRef.current = [];
  };

  const endCall = (finalPhase: CallPhase = "ended") => {
    const current = phaseRef.current;
    if (ROLE === "caller" && (current === "ringing" || current === "connecting")) {
      hangupSignal({ kind: "cancel", video: WANT_VIDEO });
      setPhaseTracked("cancelled");
    } else {
      hangupSignal({ kind: "end" });
      setPhaseTracked(finalPhase);
    }
    cleanupMedia();
    setTimeout(() => window.close(), 900);
  };

  async function acquireMedia(): Promise<MediaStream | null> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: WANT_VIDEO ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
      });
      localStreamRef.current = stream;
      if (localVideoRef.current && WANT_VIDEO) {
        localVideoRef.current.srcObject = stream;
      }
      return stream;
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      setPhaseTracked(name === "NotAllowedError" ? "mic-blocked" : "failed");
      return null;
    }
  }

  const openMicPermissionHelper = () => {
    void browser.tabs.create({ url: browser.runtime.getURL("/permissions.html" as never) });
  };

  async function flushPendingIce(pc: RTCPeerConnection) {
    const queued = pendingIceRef.current.splice(0);
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        /* race with remote description — safe to drop */
      }
    }
  }

  async function attemptIceRestart() {
    const pc = pcRef.current;
    if (!pc || ROLE !== "caller") return;
    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      signal({ kind: "renegotiate", video: WANT_VIDEO, sdp: offer.sdp });
    } catch {
      setPhaseTracked("failed");
      setStatusDetail("Connection failed");
      cleanupMedia();
    }
  }

  function buildPeerConnection(stream: MediaStream): RTCPeerConnection {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pc;

    for (const track of stream.getTracks()) pc.addTrack(track, stream);

    pc.ontrack = (event) => {
      const [remote] = event.streams;
      if (!remote) return;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remote;
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = remote;
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) signal({ kind: "ice", candidate: event.candidate.toJSON() });
    };

    pc.onconnectionstatechange = () => {
      switch (pc.connectionState) {
        case "connected":
          if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
          }
          setOnHold(false);
          setPhaseTracked("connected");
          setStatusDetail(null);
          setStartedAt((current) => current ?? Date.now());
          break;
        case "disconnected":
          setPhaseTracked("reconnecting");
          setStatusDetail("Reconnecting…");
          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = setTimeout(() => {
            if (phaseRef.current !== "reconnecting") return;
            void attemptIceRestart();
          }, 3_000);
          break;
        case "failed":
          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = setTimeout(() => {
            if (pcRef.current?.connectionState === "connected") return;
            setPhaseTracked("failed");
            setStatusDetail("Connection timed out");
            cleanupMedia();
          }, RECONNECT_GIVE_UP_MS);
          void attemptIceRestart();
          setPhaseTracked("reconnecting");
          break;
        case "closed":
          break;
      }
    };

    return pc;
  }

  async function startAsCaller() {
    const stream = await acquireMedia();
    if (!stream) return;
    const pc = buildPeerConnection(stream);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    signal({ kind: "offer", video: WANT_VIDEO, sdp: offer.sdp });
  }

  async function acceptIncoming() {
    const pending = pendingOfferRef.current;
    if (!pending?.signal.sdp) return;
    setPhaseTracked("connecting");
    setShowQuickReplies(false);

    const stream = await acquireMedia();
    if (!stream) return;
    const pc = buildPeerConnection(stream);
    await pc.setRemoteDescription({ type: "offer", sdp: pending.signal.sdp });
    await flushPendingIce(pc);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    signal({ kind: "answer", sdp: answer.sdp });
  }

  const decline = (quickReply?: string) => {
    if (quickReply) {
      hangupSignal({ kind: "quick_reply", video: WANT_VIDEO, text: quickReply });
    } else {
      hangupSignal({ kind: "reject" });
    }
    cleanupMedia();
    setPhaseTracked("declined");
    if (quickReply) setStatusDetail(`“${quickReply}”`);
    setTimeout(() => window.close(), 400);
  };

  const toggleHold = () => {
    if (phaseRef.current !== "connected" && phaseRef.current !== "on-hold") return;
    const next = !onHold;
    setOnHold(next);
    if (next) {
      localStreamRef.current?.getTracks().forEach((track) => {
        track.enabled = false;
      });
    } else {
      localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !muted));
      localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = !cameraOff));
    }
    signal({ kind: next ? "hold" : "resume", video: WANT_VIDEO });
    setPhaseTracked(next ? "on-hold" : "connected");
    setStatusDetail(next ? "On hold" : null);
  };

  async function handleSignal({ signal: incoming }: IncomingCallSignal) {
    switch (incoming.kind) {
      case "offer":
        pendingOfferRef.current = {
          from: { username: PEER, name: PEER_NAME, color: PEER_COLOR },
          signal: incoming,
        };
        break;
      case "ringing":
        if (ROLE === "caller" && phaseRef.current === "ringing") {
          setStatusDetail("Ringing…");
        }
        break;
      case "answer":
        if (pcRef.current && incoming.sdp) {
          setPhaseTracked("connecting");
          await pcRef.current.setRemoteDescription({ type: "answer", sdp: incoming.sdp });
          await flushPendingIce(pcRef.current);
        }
        break;
      case "ice":
        if (incoming.candidate) {
          const candidate = incoming.candidate as RTCIceCandidateInit;
          if (pcRef.current?.remoteDescription) {
            try {
              await pcRef.current.addIceCandidate(candidate);
            } catch {
              /* safe to drop */
            }
          } else {
            pendingIceRef.current.push(candidate);
          }
        }
        break;
      case "renegotiate":
        if (pcRef.current && incoming.sdp) {
          try {
            await pcRef.current.setRemoteDescription({ type: "offer", sdp: incoming.sdp });
            const answer = await pcRef.current.createAnswer();
            await pcRef.current.setLocalDescription(answer);
            signal({ kind: "answer", sdp: answer.sdp });
          } catch {
            /* renegotiation failed — connection watcher will surface it */
          }
        }
        break;
      case "reject":
        cleanupMedia();
        setPhaseTracked("declined");
        setTimeout(() => window.close(), 1500);
        break;
      case "quick_reply":
        cleanupMedia();
        setPhaseTracked("declined");
        setStatusDetail(incoming.text ? `“${incoming.text}”` : null);
        setTimeout(() => window.close(), 1800);
        break;
      case "busy":
        cleanupMedia();
        setPhaseTracked("busy");
        setTimeout(() => window.close(), 1500);
        break;
      case "cancel":
        cleanupMedia();
        setPhaseTracked("cancelled");
        setStatusDetail("Call cancelled");
        setTimeout(() => window.close(), 1200);
        break;
      case "timeout":
        cleanupMedia();
        setPhaseTracked("timed-out");
        setStatusDetail(ROLE === "caller" ? "No answer" : "Missed call");
        setTimeout(() => window.close(), 1500);
        break;
      case "hold":
        setOnHold(true);
        setPhaseTracked("on-hold");
        setStatusDetail(`${PEER_NAME} put the call on hold`);
        break;
      case "resume":
        setOnHold(false);
        setPhaseTracked("connected");
        setStatusDetail(null);
        break;
      case "end":
        cleanupMedia();
        setPhaseTracked("ended");
        setTimeout(() => window.close(), 900);
        break;
    }
  }

  const toggleMute = () => {
    if (onHold) return;
    const next = !muted;
    setMuted(next);
    localStreamRef.current?.getAudioTracks().forEach((track) => (track.enabled = !next));
  };

  const toggleCamera = () => {
    if (onHold) return;
    const next = !cameraOff;
    setCameraOff(next);
    localStreamRef.current?.getVideoTracks().forEach((track) => (track.enabled = !next));
  };

  const duration = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;
  const mm = String(Math.floor(duration / 60)).padStart(2, "0");
  const ss = String(duration % 60).padStart(2, "0");

  const statusLabel: Record<CallPhase, string> = {
    ringing: ROLE === "caller" ? (statusDetail ?? "Calling…") : "Incoming call",
    connecting: "Connecting…",
    connected: `${mm}:${ss}`,
    reconnecting: statusDetail ?? "Reconnecting…",
    "on-hold": statusDetail ?? "On hold",
    ended: "Call ended",
    declined: statusDetail ? `Declined — ${statusDetail}` : "Declined",
    busy: "Busy",
    cancelled: statusDetail ?? "Call cancelled",
    "timed-out": statusDetail ?? (ROLE === "caller" ? "No answer" : "Missed call"),
    failed: statusDetail ?? "Couldn't connect — check mic/camera permissions",
    "mic-blocked": `Couldn't access your ${WANT_VIDEO ? "camera" : "microphone"}`,
  };

  const inCall = phase === "connected" || phase === "reconnecting" || phase === "on-hold";
  const incomingUndecided = ROLE === "callee" && phase === "ringing";

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-white">
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {WANT_VIDEO ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className={cn("h-full w-full object-cover", !inCall && "opacity-0")}
          />
        ) : (
          <audio ref={remoteAudioRef} autoPlay />
        )}

        {(!inCall || !WANT_VIDEO) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <Avatar name={PEER_NAME} color={PEER_COLOR} size="xl" />
            <p className="text-base font-semibold">{PEER_NAME}</p>
            <p
              className={cn(
                "text-sm",
                phase === "failed" || phase === "mic-blocked"
                  ? "px-6 text-center text-red-400"
                  : "text-slate-400"
              )}
            >
              {statusLabel[phase]}
            </p>
            {phase === "mic-blocked" && (
              <button
                type="button"
                onClick={openMicPermissionHelper}
                className="rounded-full bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
              >
                Open one-time setup tab
              </button>
            )}
          </div>
        )}

        {inCall && WANT_VIDEO && (
          <>
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="absolute bottom-3 right-3 h-24 w-32 rounded-lg border border-slate-700 object-cover"
            />
            <span className="absolute left-3 top-3 rounded-full bg-black/50 px-2.5 py-1 text-xs font-medium tabular-nums">
              {statusLabel[phase]}
            </span>
          </>
        )}
        {inCall && !WANT_VIDEO && (
          <span className="absolute top-3 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium tabular-nums">
            {statusLabel[phase]}
          </span>
        )}
      </div>

      {showQuickReplies && incomingUndecided && (
        <div className="space-y-2 border-t border-slate-800 px-4 py-3">
          {QUICK_REPLIES.map((msg) => (
            <button
              key={msg}
              type="button"
              onClick={() => decline(msg)}
              className="w-full rounded-xl bg-white/10 px-3 py-2 text-left text-xs font-medium transition hover:bg-white/20"
            >
              {msg}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowQuickReplies(false)}
            className="w-full py-1 text-center text-[11px] text-slate-400"
          >
            Cancel
          </button>
        </div>
      )}

      <div className="flex items-center justify-center gap-3 border-t border-slate-800 px-4 py-4">
        {incomingUndecided ? (
          <>
            <button
              type="button"
              onClick={() => setShowQuickReplies((v) => !v)}
              aria-label="Message and decline"
              className="rounded-full bg-white/10 px-3 py-2 text-[11px] font-semibold transition hover:bg-white/20"
            >
              Message
            </button>
            <button
              type="button"
              onClick={() => decline()}
              aria-label="Decline"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-red-600 transition hover:bg-red-500"
            >
              <PhoneOff size={20} />
            </button>
            <button
              type="button"
              onClick={() => void acceptIncoming()}
              aria-label="Accept"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 transition hover:bg-emerald-500"
            >
              <Phone size={20} />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={toggleMute}
              disabled={!inCall && phase !== "connecting"}
              aria-label={muted ? "Unmute" : "Mute"}
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-full transition disabled:opacity-40",
                muted ? "bg-white text-slate-900" : "bg-white/10 hover:bg-white/20"
              )}
            >
              {muted ? <MicOff size={18} /> : <Mic size={18} />}
            </button>

            {WANT_VIDEO && (
              <button
                type="button"
                onClick={toggleCamera}
                disabled={!inCall && phase !== "connecting"}
                aria-label={cameraOff ? "Turn camera on" : "Turn camera off"}
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-full transition disabled:opacity-40",
                  cameraOff ? "bg-white text-slate-900" : "bg-white/10 hover:bg-white/20"
                )}
              >
                {cameraOff ? <VideoOff size={18} /> : <Video size={18} />}
              </button>
            )}

            <button
              type="button"
              onClick={toggleHold}
              disabled={phase !== "connected" && phase !== "on-hold"}
              aria-label={onHold ? "Resume" : "Hold"}
              className={cn(
                "rounded-full px-3 py-2 text-[11px] font-semibold transition disabled:opacity-40",
                onHold ? "bg-amber-400 text-slate-900" : "bg-white/10 hover:bg-white/20"
              )}
            >
              {onHold ? "Resume" : "Hold"}
            </button>

            <button
              type="button"
              onClick={() => endCall()}
              aria-label="Hang up"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-red-600 transition hover:bg-red-500"
            >
              <PhoneOff size={20} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CallApp />
  </StrictMode>
);
