import { io, type Socket } from "socket.io-client";

/**
 * Realtime transport (Socket.IO).
 *
 * Dependency direction: stores/components import this module; this module
 * never imports stores. Incoming events are delivered through handlers
 * wired up by WorkspaceScreen.
 */

export const REALTIME_URL = "http://localhost:3001";

export interface WireUser {
  username: string;
  name: string;
  color: string;
}

export interface WireMessage {
  id: string;
  kind: "text" | "link";
  text: string;
  url?: string;
  sentAt: number;
}

export interface RealtimeHandlers {
  onConnectionChange: (live: boolean) => void;
  onRoster: (users: WireUser[]) => void;
  onDm: (from: WireUser, message: WireMessage) => void;
  onTyping: (fromUsername: string) => void;
}

let socket: Socket | null = null;

export function initRealtime(me: WireUser, handlers: RealtimeHandlers): void {
  if (socket) return;

  socket = io(REALTIME_URL, {
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
    timeout: 4000,
  });

  socket.on("connect", () => {
    socket?.emit("hello", me);
    handlers.onConnectionChange(true);
  });

  socket.on("disconnect", () => handlers.onConnectionChange(false));
  socket.on("connect_error", () => handlers.onConnectionChange(false));

  socket.on("roster", (users: WireUser[]) => handlers.onRoster(users));

  socket.on(
    "dm",
    ({ from, message }: { from: WireUser; message: WireMessage }) =>
      handlers.onDm(from, message)
  );

  socket.on("typing", ({ from }: { from: string }) =>
    handlers.onTyping(from)
  );
}

export function disconnectRealtime(): void {
  socket?.disconnect();
  socket = null;
}

export function sendDm(toUsername: string, message: WireMessage): void {
  socket?.emit("dm", { to: toUsername, message });
}

export function sendTyping(toUsername: string): void {
  socket?.emit("typing", { to: toUsername });
}
