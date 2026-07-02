import { io, type Socket } from "socket.io-client";

/**
 * Realtime transport (Socket.IO).
 *
 * Dependency direction: stores/components import this module; this module
 * never imports stores. Incoming events are delivered through handlers
 * wired up by WorkspaceScreen.
 *
 * Privacy note: visibility is enforced server-side. Client-side gating
 * here and in the UI is UX only — the server is the authority.
 */

export const REALTIME_URL =
  (import.meta.env.WXT_REALTIME_URL as string | undefined) ??
  "http://localhost:3001";

export type Visibility = "public" | "private";

export interface WireUser {
  username: string;
  name: string;
  color: string;
  visibility: Visibility;
}

export interface WireMessage {
  id: string;
  kind: "text" | "link";
  text: string;
  url?: string;
  sentAt: number;
}

export type DmErrorReason = "sender_private" | "recipient_unavailable";

export interface RealtimeHandlers {
  onConnectionChange: (live: boolean) => void;
  onRoster: (users: WireUser[]) => void;
  onDm: (from: WireUser, message: WireMessage) => void;
  onTyping: (fromUsername: string) => void;
  onDmError: (toUsername: string, reason: DmErrorReason) => void;
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

  socket.on(
    "dm_error",
    ({ to, reason }: { to: string; reason: DmErrorReason }) =>
      handlers.onDmError(to, reason)
  );
}

export function disconnectRealtime(): void {
  socket?.disconnect();
  socket = null;
}

/** Push a visibility change to the server (takes effect immediately). */
export function updateVisibility(visibility: Visibility): void {
  socket?.emit("visibility", visibility);
}

export function sendDm(toUsername: string, message: WireMessage): void {
  socket?.emit("dm", { to: toUsername, message });
}

export function sendTyping(toUsername: string): void {
  socket?.emit("typing", { to: toUsername });
}
