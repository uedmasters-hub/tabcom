/**
 * Thin transport over expo-nearby-connections. Dynamically imported so
 * Expo Go / missing native builds degrade to `unsupported` instead of
 * crashing the JS bundle.
 */

export type TransportPeer = { peerId: string; name: string };

export type TransportHandlers = {
  onPeerFound: (peer: TransportPeer) => void;
  onPeerLost: (peerId: string) => void;
  onInvitation: (peer: TransportPeer) => void;
  onConnected: (peer: TransportPeer) => void;
  onDisconnected: (peerId: string) => void;
  onText: (peerId: string, text: string) => void;
};

export type Transport = {
  available: boolean;
  start: (advertiseName: string) => Promise<void>;
  stop: () => Promise<void>;
  rotateAdvertiseName: (advertiseName: string) => Promise<void>;
  requestConnection: (peerId: string) => Promise<void>;
  acceptConnection: (peerId: string) => Promise<void>;
  rejectConnection: (peerId: string) => Promise<void>;
  disconnect: (peerId?: string) => Promise<void>;
  sendText: (peerId: string, text: string) => Promise<void>;
};

type NativeModule = {
  Strategy: { P2P_CLUSTER: number; P2P_STAR: number; P2P_POINT_TO_POINT: number };
  startAdvertise: (name: string, strategy?: number) => Promise<string>;
  stopAdvertise: () => Promise<void>;
  startDiscovery: (name: string, strategy?: number) => Promise<string>;
  stopDiscovery: () => Promise<void>;
  requestConnection: (peerId: string) => Promise<void>;
  acceptConnection: (peerId: string) => Promise<void>;
  rejectConnection: (peerId: string) => Promise<void>;
  disconnect: (peerId?: string) => Promise<void>;
  sendText: (peerId: string, text: string) => Promise<void>;
  onPeerFound: (cb: (p: TransportPeer) => void) => () => void;
  onPeerLost: (cb: (p: { peerId: string }) => void) => () => void;
  onInvitationReceived: (cb: (p: TransportPeer) => void) => () => void;
  onConnected: (cb: (p: TransportPeer) => void) => () => void;
  onDisconnected: (cb: (p: { peerId: string }) => void) => () => void;
  onTextReceived: (cb: (p: { peerId: string; text: string }) => void) => () => void;
  isPlayServicesAvailable?: () => Promise<boolean>;
};

async function loadNative(): Promise<NativeModule | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-nearby-connections") as NativeModule;
    if (!mod?.startAdvertise || !mod?.startDiscovery) return null;
    if (mod.isPlayServicesAvailable) {
      const ok = await mod.isPlayServicesAvailable();
      if (!ok) return null;
    }
    return mod;
  } catch {
    return null;
  }
}

export async function createTransport(
  handlers: TransportHandlers
): Promise<Transport> {
  const native = await loadNative();
  if (!native) {
    return {
      available: false,
      async start() {
        throw new Error("unsupported");
      },
      async stop() {},
      async rotateAdvertiseName() {},
      async requestConnection() {
        throw new Error("unsupported");
      },
      async acceptConnection() {},
      async rejectConnection() {},
      async disconnect() {},
      async sendText() {},
    };
  }

  const unsubs: Array<() => void> = [];
  let running = false;
  let currentName = "";

  const strategy = native.Strategy?.P2P_CLUSTER ?? 1;

  const stop = async () => {
    running = false;
    while (unsubs.length) {
      try {
        unsubs.pop()?.();
      } catch {
        /* already gone */
      }
    }
    try {
      await native.stopDiscovery();
    } catch {
      /* */
    }
    try {
      await native.stopAdvertise();
    } catch {
      /* */
    }
    try {
      await native.disconnect();
    } catch {
      /* */
    }
  };

  return {
    available: true,

    async start(advertiseName: string) {
      currentName = advertiseName;
      if (running) await stop();
      unsubs.push(native.onPeerFound((p) => handlers.onPeerFound(p)));
      unsubs.push(native.onPeerLost((p) => handlers.onPeerLost(p.peerId)));
      unsubs.push(native.onInvitationReceived((p) => handlers.onInvitation(p)));
      unsubs.push(native.onConnected((p) => handlers.onConnected(p)));
      unsubs.push(native.onDisconnected((p) => handlers.onDisconnected(p.peerId)));
      unsubs.push(
        native.onTextReceived((p) => handlers.onText(p.peerId, p.text))
      );
      await native.startAdvertise(advertiseName, strategy);
      await native.startDiscovery(advertiseName, strategy);
      running = true;
    },

    stop,

    async rotateAdvertiseName(advertiseName: string) {
      if (!running) return;
      currentName = advertiseName;
      try {
        await native.stopAdvertise();
        await native.startAdvertise(currentName, strategy);
      } catch {
        /* rotation best-effort */
      }
    },

    requestConnection: (peerId) => native.requestConnection(peerId),
    acceptConnection: (peerId) => native.acceptConnection(peerId),
    rejectConnection: (peerId) => native.rejectConnection(peerId),
    disconnect: (peerId) => native.disconnect(peerId),
    sendText: (peerId, text) => native.sendText(peerId, text),
  };
}
