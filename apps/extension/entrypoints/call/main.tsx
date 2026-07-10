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
 * never leave the other side hanging.
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

type CallPhase =
  | "ringing" // callee: deciding; caller: waiting for answer
  | "connecting"
  | "connected"
  | "reconnecting"
  | "ended"
  | "declined"
  | "busy"
  | "failed"
  | "mic-blocked";

function CallApp() {
  const [phase, setPhase] = useState<CallPhase>("ringing");
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(!WANT_VIDEO);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [, tick] = useState(0);

  const portRef = useRef<ReturnType<typeof browser.runtime.connect> | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingOfferRef = useRef<IncomingCallSignal | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  // Call duration ticker.
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
    }
    // Callee: waits — the buffered offer arrives through the port the
    // moment it connects (background replays pendingCallSignals), and
    // we hold it in pendingOfferRef until the person taps Accept.

    return () => {
      cleanupMedia();
      port.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signal = (payload: CallSignal) => {
    portRef.current?.postMessage({ type: "signal", to: PEER, signal: payload });
  };

  const cleanupMedia = () => {
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
  };

  const endCall = (finalPhase: CallPhase = "ended") => {
    signal({ kind: "end" });
    cleanupMedia();
    setPhase(finalPhase);
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
      setPhase(name === "NotAllowedError" ? "mic-blocked" : "failed");
      return null;
    }
  }

  const openMicPermissionHelper = () => {
    // Same fix as ChatView's voice-note recorder: a full, stable tab
    // where getUserMedia's prompt can actually render, since this call
    // window (still a small popup-type window) hits the identical
    // limitation. Same extension origin, so granting access there
    // covers this window too.
    void browser.tabs.create({ url: browser.runtime.getURL("/permissions.html" as never) });
  };

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
          setPhase("connected");
          setStartedAt((current) => current ?? Date.now());
          break;
        case "disconnected":
          setPhase("reconnecting"); // ICE often self-heals; give it a beat
          break;
        case "failed":
          setPhase("failed");
          cleanupMedia();
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
    // stays "ringing" until an answer / reject / busy arrives
  }

  async function acceptIncoming() {
    const pending = pendingOfferRef.current;
    if (!pending?.signal.sdp) return;
    setPhase("connecting");

    const stream = await acquireMedia();
    if (!stream) return;
    const pc = buildPeerConnection(stream);
    await pc.setRemoteDescription({ type: "offer", sdp: pending.signal.sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    signal({ kind: "answer", sdp: answer.sdp });
  }

  async function handleSignal({ signal: incoming }: IncomingCallSignal) {
    switch (incoming.kind) {
      case "offer":
        pendingOfferRef.current = { from: { username: PEER, name: PEER_NAME, color: PEER_COLOR }, signal: incoming };
        break;
      case "answer":
        if (pcRef.current && incoming.sdp) {
          setPhase("connecting");
          await pcRef.current.setRemoteDescription({ type: "answer", sdp: incoming.sdp });
        }
        break;
      case "ice":
        if (pcRef.current && incoming.candidate) {
          try {
            await pcRef.current.addIceCandidate(incoming.candidate as RTCIceCandidateInit);
          } catch {
            // Candidates can race the remote description; safe to drop.
          }
        }
        break;
      case "reject":
        cleanupMedia();
        setPhase("declined");
        setTimeout(() => window.close(), 1500);
        break;
      case "busy":
        cleanupMedia();
        setPhase("busy");
        setTimeout(() => window.close(), 1500);
        break;
      case "end":
        cleanupMedia();
        setPhase("ended");
        setTimeout(() => window.close(), 900);
        break;
    }
  }

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    localStreamRef.current?.getAudioTracks().forEach((track) => (track.enabled = !next));
  };

  const toggleCamera = () => {
    const next = !cameraOff;
    setCameraOff(next);
    localStreamRef.current?.getVideoTracks().forEach((track) => (track.enabled = !next));
  };

  const duration = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;
  const mm = String(Math.floor(duration / 60)).padStart(2, "0");
  const ss = String(duration % 60).padStart(2, "0");

  const statusLabel: Record<CallPhase, string> = {
    ringing: ROLE === "caller" ? "Calling…" : "Incoming call",
    connecting: "Connecting…",
    connected: `${mm}:${ss}`,
    reconnecting: "Reconnecting…",
    ended: "Call ended",
    declined: "Declined",
    busy: "Busy",
    failed: "Couldn't connect — check mic/camera permissions",
    "mic-blocked": `Couldn't access your ${WANT_VIDEO ? "camera" : "microphone"}`,
  };

  const inCall = phase === "connected" || phase === "reconnecting";
  const incomingUndecided = ROLE === "callee" && phase === "ringing";

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-white">
      {/* Remote media */}
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

      {/* Controls */}
      <div className="flex items-center justify-center gap-3 border-t border-slate-800 px-4 py-4">
        {incomingUndecided ? (
          <>
            <button
              type="button"
              onClick={() => {
                signal({ kind: "reject" });
                setPhase("declined");
                setTimeout(() => window.close(), 400);
              }}
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
