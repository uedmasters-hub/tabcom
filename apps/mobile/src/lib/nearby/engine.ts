import { AppState, type AppStateStatus, Linking, Platform } from "react-native";
import * as Battery from "expo-battery";

import {
  createAdvertisement,
  isCompatibleVersion,
  parseAdvertisement,
} from "./advertisement";
import {
  ADVERTISEMENT_ROTATION_MS,
  CONNECT_TIMEOUT_MS,
  PEER_STALE_MS,
  PROTOCOL_VERSION,
  getInstallUrl,
} from "./config";
import {
  deriveSessionKey,
  generateEphemeralKeyPair,
  type EphemeralKeyPair,
} from "./crypto";
import { requestNearbyPermissions } from "./permissions";
import { decodeMessage, encodeMessage, type NearbyMessage } from "./protocol";
import { bandFromRssi, type ProximityBand } from "./proximity";
import { createTransport, type Transport } from "./transport";

export type NearbyStatus =
  | "idle"
  | "permissions_required"
  | "bluetooth_disabled"
  | "wifi_disabled"
  | "unsupported"
  | "battery_saver"
  | "searching"
  | "advertising"
  | "peers_found"
  | "connecting"
  | "connected"
  | "connection_failed"
  | "incompatible_version";

export type RecoveryAction =
  | { kind: "open_settings"; label: string }
  | { kind: "retry"; label: string }
  | { kind: "disable"; label: string }
  | { kind: "install"; label: string; url: string }
  | { kind: "none"; label: string };

export interface NearbyPeer {
  peerId: string;
  /** Opaque advertise name / session nonce until handshake. */
  sessionNonce: string;
  protocolVersion: number;
  compatible: boolean;
  proximity: ProximityBand;
  lastSeenAt: number;
  /** Filled only after post-accept hello. */
  username?: string;
  displayName?: string;
  avatarColor?: string;
  presence?: "online" | "away" | "busy" | "offline";
  handshaken: boolean;
  connected: boolean;
}

export interface NearbyIncomingRequest {
  peerId: string;
  sessionNonce: string;
  /** Opaque label until hello — never PII before accept. */
  label: string;
}

export interface NearbyProfile {
  username: string;
  displayName: string;
  avatarColor: string;
  presence: "online" | "away" | "busy" | "offline";
}

export type NearbyEngineListener = (snapshot: NearbyEngineSnapshot) => void;

export interface NearbyEngineSnapshot {
  enabled: boolean;
  status: NearbyStatus;
  statusDetail: string | null;
  recovery: RecoveryAction;
  peers: NearbyPeer[];
  incoming: NearbyIncomingRequest | null;
  outgoingPeerId: string | null;
}

function recoveryFor(status: NearbyStatus): RecoveryAction {
  switch (status) {
    case "permissions_required":
      return { kind: "open_settings", label: "Open Settings" };
    case "bluetooth_disabled":
      return { kind: "open_settings", label: "Enable Bluetooth" };
    case "wifi_disabled":
      return { kind: "open_settings", label: "Check Wi‑Fi" };
    case "battery_saver":
      return { kind: "retry", label: "Retry when Battery Saver is off" };
    case "unsupported":
      return {
        kind: "install",
        label: "Get Tabcom build",
        url: getInstallUrl(),
      };
    case "connection_failed":
    case "incompatible_version":
      return { kind: "retry", label: "Try again" };
    default:
      return { kind: "none", label: "" };
  }
}

function statusDetail(status: NearbyStatus): string | null {
  switch (status) {
    case "idle":
      return null;
    case "permissions_required":
      return "Bluetooth and Nearby permissions are required to discover people around you.";
    case "bluetooth_disabled":
      return "Bluetooth is off. Turn it on to advertise and scan.";
    case "wifi_disabled":
      return "Wi‑Fi helps Nearby Connections upgrade to a faster link. Discovery can still use Bluetooth.";
    case "unsupported":
      return "Nearby Discovery needs a native Tabcom build with Nearby Connections support.";
    case "battery_saver":
      return "Battery Saver is on — Nearby Discovery is paused to save power.";
    case "searching":
    case "advertising":
      return "Searching for Tabcom devices nearby…";
    case "peers_found":
      return "Nearby Tabcom devices found.";
    case "connecting":
      return "Waiting for the other person to respond…";
    case "connected":
      return "Connected securely.";
    case "connection_failed":
      return "Couldn't complete the connection. The other device may have declined or gone out of range.";
    case "incompatible_version":
      return "This device is running an incompatible Tabcom Nearby version.";
    default:
      return null;
  }
}

export class NearbyEngine {
  private enabled = false;
  private status: NearbyStatus = "idle";
  private peers = new Map<string, NearbyPeer>();
  private incoming: NearbyIncomingRequest | null = null;
  private outgoingPeerId: string | null = null;
  private ignoredNonces = new Set<string>();
  private transport: Transport | null = null;
  private listeners = new Set<NearbyEngineListener>();
  private rotationTimer: ReturnType<typeof setInterval> | null = null;
  private staleTimer: ReturnType<typeof setInterval> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private appStateSub: { remove: () => void } | null = null;
  private batterySub: { remove: () => void } | null = null;
  private paused = false;
  private keys: EphemeralKeyPair | null = null;
  private sessionKeys = new Map<string, string>();
  private profile: NearbyProfile | null = null;
  private onPaired:
    | ((peer: NearbyPeer, direction: "incoming" | "outgoing") => void)
    | null = null;

  subscribe(fn: NearbyEngineListener) {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }

  setProfile(profile: NearbyProfile) {
    this.profile = profile;
  }

  setOnPaired(
    fn: ((peer: NearbyPeer, direction: "incoming" | "outgoing") => void) | null
  ) {
    this.onPaired = fn;
  }

  snapshot(): NearbyEngineSnapshot {
    const peers = [...this.peers.values()].sort(
      (a, b) => b.lastSeenAt - a.lastSeenAt
    );
    let status = this.status;
    if (
      this.enabled &&
      !this.paused &&
      (status === "searching" || status === "advertising") &&
      peers.length > 0
    ) {
      status = "peers_found";
    }
    return {
      enabled: this.enabled,
      status,
      statusDetail: statusDetail(status),
      recovery: recoveryFor(status),
      peers,
      incoming: this.incoming,
      outgoingPeerId: this.outgoingPeerId,
    };
  }

  private emit() {
    const snap = this.snapshot();
    for (const fn of this.listeners) fn(snap);
  }

  private setStatus(status: NearbyStatus) {
    this.status = status;
    this.emit();
  }

  async enable(profile: NearbyProfile): Promise<void> {
    this.profile = profile;
    if (this.enabled) return;

    const perms = await requestNearbyPermissions();
    if (!perms.ok) {
      this.enabled = true;
      this.setStatus("permissions_required");
      return;
    }

    if (await this.isBatterySaver()) {
      this.enabled = true;
      this.wireLifecycle();
      this.setStatus("battery_saver");
      return;
    }

    this.transport = await createTransport({
      onPeerFound: (p) => this.handlePeerFound(p.peerId, p.name),
      onPeerLost: (id) => this.handlePeerLost(id),
      onInvitation: (p) => this.handleInvitation(p.peerId, p.name),
      onConnected: (p) => void this.handleConnected(p.peerId, p.name),
      onDisconnected: (id) => this.handleDisconnected(id),
      onText: (id, text) => void this.handleText(id, text),
    });

    if (!this.transport.available) {
      this.enabled = true;
      this.setStatus("unsupported");
      return;
    }

    this.enabled = true;
    this.paused = false;
    this.keys = await generateEphemeralKeyPair();
    this.wireLifecycle();
    await this.startRadios();
  }

  async disable(): Promise<void> {
    this.enabled = false;
    this.paused = false;
    this.incoming = null;
    this.outgoingPeerId = null;
    this.clearTimers();
    this.unwireLifecycle();
    try {
      await this.transport?.stop();
    } catch {
      /* */
    }
    this.transport = null;
    this.peers.clear();
    this.sessionKeys.clear();
    this.keys = null;
    this.setStatus("idle");
  }

  async connect(peerId: string): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer || !this.transport || !this.enabled) return;
    if (!peer.compatible) {
      this.setStatus("incompatible_version");
      return;
    }
    this.outgoingPeerId = peerId;
    this.setStatus("connecting");
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = setTimeout(() => {
      if (this.outgoingPeerId === peerId && this.status === "connecting") {
        this.outgoingPeerId = null;
        this.setStatus("connection_failed");
      }
    }, CONNECT_TIMEOUT_MS);
    try {
      await this.transport.requestConnection(peerId);
    } catch {
      this.outgoingPeerId = null;
      this.setStatus("connection_failed");
    }
  }

  async acceptIncoming(): Promise<void> {
    if (!this.incoming || !this.transport) return;
    const peerId = this.incoming.peerId;
    try {
      await this.transport.acceptConnection(peerId);
      this.incoming = null;
      this.setStatus("connecting");
    } catch {
      this.incoming = null;
      this.setStatus("connection_failed");
    }
  }

  async declineIncoming(): Promise<void> {
    if (!this.incoming || !this.transport) return;
    const peerId = this.incoming.peerId;
    try {
      await this.transport.rejectConnection(peerId);
    } catch {
      /* */
    }
    this.incoming = null;
    this.emit();
  }

  async ignoreIncoming(): Promise<void> {
    if (!this.incoming || !this.transport) return;
    const { peerId, sessionNonce } = this.incoming;
    this.ignoredNonces.add(sessionNonce);
    try {
      await this.transport.rejectConnection(peerId);
    } catch {
      /* */
    }
    this.incoming = null;
    this.emit();
  }

  openInstallLink(): void {
    void Linking.openURL(getInstallUrl());
  }

  openSystemSettings(): void {
    if (Platform.OS === "ios") {
      void Linking.openURL("app-settings:");
    } else {
      void Linking.openSettings();
    }
  }

  async retry(): Promise<void> {
    if (!this.enabled || !this.profile) return;
    if (await this.isBatterySaver()) {
      this.setStatus("battery_saver");
      return;
    }
    if (this.status === "permissions_required") {
      const perms = await requestNearbyPermissions();
      if (!perms.ok) {
        this.setStatus("permissions_required");
        return;
      }
    }
    if (!this.transport?.available) {
      this.transport = await createTransport({
        onPeerFound: (p) => this.handlePeerFound(p.peerId, p.name),
        onPeerLost: (id) => this.handlePeerLost(id),
        onInvitation: (p) => this.handleInvitation(p.peerId, p.name),
        onConnected: (p) => void this.handleConnected(p.peerId, p.name),
        onDisconnected: (id) => this.handleDisconnected(id),
        onText: (id, text) => void this.handleText(id, text),
      });
      if (!this.transport.available) {
        this.setStatus("unsupported");
        return;
      }
    }
    this.paused = false;
    await this.startRadios();
  }

  // ── internals ────────────────────────────────────────────────────

  private async startRadios() {
    if (!this.transport || !this.enabled || this.paused) return;
    const ad = await createAdvertisement();
    try {
      await this.transport.start(ad.rawName);
      this.setStatus("searching");
      this.startRotation();
      this.startStaleSweep();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/bluetooth/i.test(msg)) this.setStatus("bluetooth_disabled");
      else if (/wifi|wi-fi/i.test(msg)) this.setStatus("wifi_disabled");
      else this.setStatus("connection_failed");
    }
  }

  private startRotation() {
    if (this.rotationTimer) clearInterval(this.rotationTimer);
    this.rotationTimer = setInterval(() => {
      void (async () => {
        if (!this.transport || !this.enabled || this.paused) return;
        const ad = await createAdvertisement();
        await this.transport.rotateAdvertiseName(ad.rawName);
      })();
    }, ADVERTISEMENT_ROTATION_MS);
  }

  private startStaleSweep() {
    if (this.staleTimer) clearInterval(this.staleTimer);
    this.staleTimer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [id, peer] of this.peers) {
        if (!peer.connected && now - peer.lastSeenAt > PEER_STALE_MS) {
          this.peers.delete(id);
          changed = true;
        }
      }
      if (changed) this.emit();
    }, 5_000);
  }

  private clearTimers() {
    if (this.rotationTimer) clearInterval(this.rotationTimer);
    if (this.staleTimer) clearInterval(this.staleTimer);
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.rotationTimer = null;
    this.staleTimer = null;
    this.connectTimer = null;
  }

  private wireLifecycle() {
    this.unwireLifecycle();
    this.appStateSub = AppState.addEventListener(
      "change",
      (next: AppStateStatus) => {
        void this.onAppState(next);
      }
    );
    try {
      this.batterySub = Battery.addLowPowerModeListener(({ lowPowerMode }) => {
        void this.onBatterySaver(lowPowerMode);
      });
    } catch {
      /* expo-battery optional at runtime */
    }
  }

  private unwireLifecycle() {
    this.appStateSub?.remove();
    this.appStateSub = null;
    this.batterySub?.remove();
    this.batterySub = null;
  }

  private async onAppState(next: AppStateStatus) {
    if (!this.enabled) return;
    if (next === "background" || next === "inactive") {
      this.paused = true;
      try {
        await this.transport?.stop();
      } catch {
        /* */
      }
      // Keep enabled=true; status stays until resume
    } else if (next === "active") {
      if (await this.isBatterySaver()) {
        this.setStatus("battery_saver");
        return;
      }
      this.paused = false;
      if (
        this.status !== "permissions_required" &&
        this.status !== "unsupported"
      ) {
        await this.startRadios();
      }
    }
  }

  private async onBatterySaver(on: boolean) {
    if (!this.enabled) return;
    if (on) {
      this.paused = true;
      try {
        await this.transport?.stop();
      } catch {
        /* */
      }
      this.setStatus("battery_saver");
    } else if (AppState.currentState === "active") {
      this.paused = false;
      await this.startRadios();
    }
  }

  private async isBatterySaver(): Promise<boolean> {
    try {
      return await Battery.isLowPowerModeEnabledAsync();
    } catch {
      return false;
    }
  }

  private handlePeerFound(peerId: string, name: string) {
    const ad = parseAdvertisement(name);
    if (!ad) {
      // Non-Tabcom advertiser on same stack — ignore for list; Install CTA is separate
      return;
    }
    if (this.ignoredNonces.has(ad.nonce)) return;

    const existing = this.peers.get(peerId);
    const peer: NearbyPeer = {
      peerId,
      sessionNonce: ad.nonce,
      protocolVersion: ad.version,
      compatible: isCompatibleVersion(ad.version),
      proximity: existing?.proximity ?? bandFromRssi(null),
      lastSeenAt: Date.now(),
      username: existing?.username,
      displayName: existing?.displayName,
      avatarColor: existing?.avatarColor,
      presence: existing?.presence,
      handshaken: existing?.handshaken ?? false,
      connected: existing?.connected ?? false,
    };
    // Coalesce duplicates by session nonce (rotated ads can get new peerIds)
    for (const [id, p] of this.peers) {
      if (id !== peerId && p.sessionNonce === ad.nonce && !p.connected) {
        this.peers.delete(id);
      }
    }
    this.peers.set(peerId, peer);
    if (!peer.compatible) {
      // still show, but Connect will fail with incompatible
    }
    this.emit();
  }

  private handlePeerLost(peerId: string) {
    const peer = this.peers.get(peerId);
    if (peer?.connected) return;
    this.peers.delete(peerId);
    this.emit();
  }

  private handleInvitation(peerId: string, name: string) {
    const ad = parseAdvertisement(name);
    const nonce = ad?.nonce ?? peerId;
    if (this.ignoredNonces.has(nonce)) {
      void this.transport?.rejectConnection(peerId);
      return;
    }
    // Ensure peer exists in list
    this.handlePeerFound(peerId, name);
    this.incoming = {
      peerId,
      sessionNonce: nonce,
      label: "Nearby Tabcom device",
    };
    this.emit();
  }

  private async handleConnected(peerId: string, _name: string) {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    const peer = this.peers.get(peerId) ?? {
      peerId,
      sessionNonce: peerId,
      protocolVersion: PROTOCOL_VERSION,
      compatible: true,
      proximity: bandFromRssi(null),
      lastSeenAt: Date.now(),
      handshaken: false,
      connected: true,
    };
    peer.connected = true;
    peer.lastSeenAt = Date.now();
    this.peers.set(peerId, peer);
    this.incoming = null;
    this.setStatus("connected");

    // Post-accept hello — first time profile is shared
    if (this.profile && this.keys) {
      const hello: NearbyMessage = {
        type: "hello",
        v: PROTOCOL_VERSION,
        publicKey: this.keys.publicKey,
        username: this.profile.username,
        displayName: this.profile.displayName,
        avatarColor: this.profile.avatarColor,
        presence: this.profile.presence,
      };
      try {
        await this.transport?.sendText(peerId, encodeMessage(hello));
      } catch {
        /* */
      }
    }
  }

  private handleDisconnected(peerId: string) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.connected = false;
      this.peers.set(peerId, peer);
    }
    this.sessionKeys.delete(peerId);
    if (this.outgoingPeerId === peerId) this.outgoingPeerId = null;
    if (this.enabled && !this.paused) {
      this.setStatus(
        this.peers.size > 0 ? "peers_found" : "searching"
      );
    } else {
      this.emit();
    }
  }

  private async handleText(peerId: string, text: string) {
    const msg = decodeMessage(text);
    if (!msg) {
      // Might be sealed — ignore unknown
      return;
    }

    if (msg.type === "hello") {
      if (msg.v !== PROTOCOL_VERSION) {
        this.setStatus("incompatible_version");
        return;
      }
      const peer = this.peers.get(peerId);
      if (peer) {
        peer.username = msg.username;
        peer.displayName = msg.displayName;
        peer.avatarColor = msg.avatarColor;
        peer.presence = msg.presence;
        peer.handshaken = true;
        this.peers.set(peerId, peer);
      }
      if (this.keys) {
        const sessionKey = await deriveSessionKey(
          this.keys.publicKey,
          msg.publicKey
        );
        this.sessionKeys.set(peerId, sessionKey);
        try {
          await this.transport?.sendText(
            peerId,
            encodeMessage({
              type: "hello_ack",
              v: PROTOCOL_VERSION,
              publicKey: this.keys.publicKey,
            })
          );
          if (this.profile) {
            await this.transport?.sendText(
              peerId,
              encodeMessage({
                type: "profile_offer",
                username: this.profile.username,
                displayName: this.profile.displayName,
                avatarColor: this.profile.avatarColor,
                presence: this.profile.presence,
              })
            );
            await this.transport?.sendText(
              peerId,
              encodeMessage({
                type: "connect_req",
                username: this.profile.username,
              })
            );
          }
        } catch {
          /* */
        }
      }
      const direction =
        this.outgoingPeerId === peerId ? "outgoing" : "incoming";
      if (peer?.handshaken) {
        this.onPaired?.(peer, direction);
      }
      this.outgoingPeerId = null;
      this.emit();
      return;
    }

    if (msg.type === "hello_ack" && this.keys) {
      const sessionKey = await deriveSessionKey(
        this.keys.publicKey,
        msg.publicKey
      );
      this.sessionKeys.set(peerId, sessionKey);
      return;
    }

    if (msg.type === "profile_offer") {
      const peer = this.peers.get(peerId);
      if (peer) {
        peer.username = msg.username;
        peer.displayName = msg.displayName;
        peer.avatarColor = msg.avatarColor;
        peer.presence = msg.presence;
        peer.handshaken = true;
        this.peers.set(peerId, peer);
        this.emit();
      }
      return;
    }

    if (msg.type === "connect_req") {
      const peer = this.peers.get(peerId);
      if (peer?.username) {
        this.onPaired?.(peer, "incoming");
      }
      if (this.profile) {
        try {
          await this.transport?.sendText(
            peerId,
            encodeMessage({
              type: "connect_accept",
              username: this.profile.username,
            })
          );
        } catch {
          /* */
        }
      }
      return;
    }

    if (msg.type === "connect_accept") {
      const peer = this.peers.get(peerId);
      if (peer) this.onPaired?.(peer, "outgoing");
      return;
    }

    if (msg.type === "goodbye") {
      this.handleDisconnected(peerId);
    }
  }
}

/** Singleton engine used by the zustand store. */
export const nearbyEngine = new NearbyEngine();
