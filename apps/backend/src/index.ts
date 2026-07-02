import { createServer } from "node:http";
import { Server } from "socket.io";

/**
 * Tabcom realtime server — privacy-first relay.
 *
 * Privacy model (enforced HERE, never trusted to clients):
 *  - PUBLIC users appear in the community roster and can send/receive DMs.
 *  - PRIVATE users are a complete end: excluded from every roster
 *    broadcast, cannot receive DMs, cannot send DMs. The server rejects
 *    both directions, so a modified client cannot bypass it.
 *  - ZERO message retention: this server relays and forgets. No message
 *    is ever written to memory beyond the relay call, disk, or logs.
 *
 * In-memory presence only. Auth + history (opt-in) arrive with the
 * NestJS + PostgreSQL upgrade; this socket protocol is stable.
 */

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

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, service: "tabcom-realtime" }));
});

const io = new Server(httpServer, { cors: { origin: "*" } });

const users = new Map<string, WireUser>(); // socket.id -> user

function sanitizeVisibility(value: unknown): Visibility {
  return value === "private" ? "private" : "public";
}

/** Only public users are ever broadcast. Private users do not exist here. */
function publicRoster(): WireUser[] {
  return [...users.values()].filter((user) => user.visibility === "public");
}

function broadcastRoster(): void {
  io.emit("roster", publicRoster());
}

function publicSocketIdsFor(username: string): string[] {
  const ids: string[] = [];
  for (const [id, user] of users) {
    if (user.username === username && user.visibility === "public") {
      ids.push(id);
    }
  }
  return ids;
}

io.on("connection", (socket) => {
  socket.on("hello", (raw: Partial<WireUser>) => {
    if (!raw?.username) return;

    users.set(socket.id, {
      username: String(raw.username).slice(0, 20).toLowerCase(),
      name: String(raw.name ?? raw.username).slice(0, 40),
      color: String(raw.color ?? "#2563EB").slice(0, 9),
      visibility: sanitizeVisibility(raw.visibility),
    });

    broadcastRoster();
  });

  socket.on("visibility", (raw: unknown) => {
    const user = users.get(socket.id);
    if (!user) return;

    user.visibility = sanitizeVisibility(raw);
    broadcastRoster();
  });

  socket.on(
    "dm",
    ({ to, message }: { to: string; message: WireMessage }) => {
      const from = users.get(socket.id);
      if (!from || !to || !message) return;

      // Complete end while private: senders in private mode cannot message.
      if (from.visibility === "private") {
        socket.emit("dm_error", {
          to,
          reason: "sender_private" satisfies DmErrorReason,
        });
        return;
      }

      // Private or offline recipients are indistinguishable — no presence leak.
      const targets = publicSocketIdsFor(to);
      if (targets.length === 0) {
        socket.emit("dm_error", {
          to,
          reason: "recipient_unavailable" satisfies DmErrorReason,
        });
        return;
      }

      for (const id of targets) {
        io.to(id).emit("dm", { from, message });
      }
    }
  );

  socket.on("typing", ({ to }: { to: string }) => {
    const from = users.get(socket.id);
    if (!from || !to) return;
    if (from.visibility === "private") return; // silently dropped

    for (const id of publicSocketIdsFor(to)) {
      io.to(id).emit("typing", { from: from.username });
    }
  });

  socket.on("disconnect", () => {
    const user = users.get(socket.id);
    users.delete(socket.id);
    if (user) broadcastRoster();
  });
});

const PORT = Number(process.env.PORT ?? 3001);

httpServer.listen(PORT, () => {
  console.log(`[tabcom] realtime server listening on http://localhost:${PORT}`);
  console.log("[tabcom] privacy: zero message retention, server-enforced visibility");
});
