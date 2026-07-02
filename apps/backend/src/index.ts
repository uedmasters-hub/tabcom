import { createServer } from "node:http";
import { Server } from "socket.io";

/**
 * Tabcom realtime relay — minimal Phase 2 foundation.
 *
 * Responsibilities:
 *  - presence roster (who is online, broadcast on every join/leave)
 *  - direct message routing by username
 *  - typing indicator relay
 *
 * In-memory only. Persistence, auth and history arrive with the full
 * NestJS + PostgreSQL backend; the socket protocol stays the same.
 */

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

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, service: "tabcom-realtime" }));
});

const io = new Server(httpServer, {
  cors: { origin: "*" },
});

const users = new Map<string, WireUser>(); // socket.id -> user

function roster(): WireUser[] {
  return [...users.values()];
}

function socketIdsFor(username: string): string[] {
  const ids: string[] = [];
  for (const [id, user] of users) {
    if (user.username === username) ids.push(id);
  }
  return ids;
}

io.on("connection", (socket) => {
  socket.on("hello", (user: WireUser) => {
    if (!user?.username) return;

    users.set(socket.id, {
      username: String(user.username).slice(0, 20),
      name: String(user.name ?? user.username).slice(0, 40),
      color: String(user.color ?? "#2563EB").slice(0, 9),
    });

    io.emit("roster", roster());
    console.log(`[join] @${user.username} (${users.size} online)`);
  });

  socket.on(
    "dm",
    ({ to, message }: { to: string; message: WireMessage }) => {
      const from = users.get(socket.id);
      if (!from || !to || !message) return;

      for (const id of socketIdsFor(to)) {
        io.to(id).emit("dm", { from, message });
      }
    }
  );

  socket.on("typing", ({ to }: { to: string }) => {
    const from = users.get(socket.id);
    if (!from || !to) return;

    for (const id of socketIdsFor(to)) {
      io.to(id).emit("typing", { from: from.username });
    }
  });

  socket.on("disconnect", () => {
    const user = users.get(socket.id);
    users.delete(socket.id);

    if (user) {
      io.emit("roster", roster());
      console.log(`[leave] @${user.username} (${users.size} online)`);
    }
  });
});

const PORT = Number(process.env.PORT ?? 3001);

httpServer.listen(PORT, () => {
  console.log(`[tabcom] realtime server listening on http://localhost:${PORT}`);
});
