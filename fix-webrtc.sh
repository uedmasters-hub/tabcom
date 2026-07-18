#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

# Remove react-native-webrtc from package.json
cd apps/mobile
python3 -c "
import json
p = json.load(open('package.json'))
if 'react-native-webrtc' in p['dependencies']:
    del p['dependencies']['react-native-webrtc']
    json.dump(p, open('package.json', 'w'), indent=2)
    print('Removed react-native-webrtc')
else:
    print('Already removed')
"

# Stub out call-manager
cat > src/lib/call-manager.ts << 'STUBEOF'
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
STUBEOF

echo "Stub written. Running install..."
cd ../..
pnpm install
echo "Done. Run: cd apps/mobile && npx expo start --clear"
