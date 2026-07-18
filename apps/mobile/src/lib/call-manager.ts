import type { IncomingCallSignal } from "@tabcom/shared";

export type CallPhase = "ringing" | "connecting" | "connected" | "reconnecting" | "ended" | "declined" | "busy" | "failed" | "mic-blocked";
export type CallRole = "caller" | "callee";
export interface CallState {
  phase: CallPhase;
  peer: { username: string; name: string; color: string };
  role: CallRole;
  muted: boolean;
  startedAt: number | null;
}

const STUB: CallState = { phase: "ended", peer: { username: "", name: "", color: "#334155" }, role: "caller", muted: false, startedAt: null };

export function subscribe(fn: (s: CallState) => void) { fn(STUB); return () => {}; }
export function getCallState(): CallState { return STUB; }
export function startCall(_p: any) { console.warn("[tabcom] Calls need a dev build"); }
export function receiveIncomingCall(_p: IncomingCallSignal) {}
export function acceptCall() {}
export function declineCall() {}
export function endCall() {}
export function toggleMute() {}
export function handleCallSignal(_p: IncomingCallSignal) {}
