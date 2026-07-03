import { createServer } from "node:http";
import { Server } from "socket.io";

/**
 * Tabcom realtime server — privacy-first relay with consent-based contact.
 *
 * Privacy model (enforced HERE, never trusted to clients):
 *  - PUBLIC users appear in the community roster; PRIVATE users are a
 *    complete end (invisible, cannot send or receive anything).
 *  - CONSENT BEFORE CONTACT: messages only flow between users whose
 *    connection is ACCEPTED. Until then only a single connection
 *    request can be delivered.
 *  - BLOCK is invisible: a blocked requester sees exactly what any
 *    requester sees. Report auto-blocks.
 *  - ZERO message retention: messages are relayed and forgotten.
 *    The connection registry is in-memory and session-scoped; it moves
 *    to PostgreSQL (with user consent for retention) in the DB upgrade.
 */

export type Visibility = "public" | "private";

export type Presence = "online" | "away" | "busy" | "offline";

export interface WireUser {
  username: string;
  name: string;
  color: string;
  visibility: Visibility;
  presence: Presence;
  /** Optional small avatar photo (data URL, capped). */
  photo?: string;
}

function sanitizePresence(value: unknown): Presence {
  return value === "away" || value === "busy" || value === "offline"
    ? value
    : "online";
}

export interface WireMessage {
  id: string;
  kind: "text" | "link";
  text: string;
  url?: string;
  sentAt: number;
}

type PairStatus = "pending" | "accepted";
interface Pair {
  status: PairStatus;
  requester: string; // username that initiated
}

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, service: "tabcom-realtime" }));
});

const io = new Server(httpServer, { cors: { origin: "*" } });

const users = new Map<string, WireUser>(); // socket.id -> user

interface Community {
  id: string;
  name: string;
  admin: string; // username
  members: Set<string>;
  memberInfo: Map<string, { name: string; color: string }>;
  invites: Map<string, { attempts: number; pending: boolean }>;
}

const communities = new Map<string, Community>();
const MAX_INVITE_ATTEMPTS = 3;

function serializeCommunity(c: Community, forUsername?: string) {
  const invite = forUsername ? c.invites.get(forUsername) : undefined;
  return {
    id: c.id,
    name: c.name,
    admin: c.admin,
    members: [...c.members].map((username) => ({
      username,
      ...(c.memberInfo.get(username) ?? { name: username, color: "#334155" }),
    })),
    pendingForMe: invite?.pending ?? false,
  };
}
const pairs = new Map<string, Pair>(); // pairKey -> connection state
const blocks = new Set<string>(); // "blocker|blocked"
const presenceHidden = new Set<string>(); // "hider|viewer" — presence masked, messages still flow

function sanitizeVisibility(value: unknown): Visibility {
  return value === "private" ? "private" : "public";
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

function isBlockedEitherWay(a: string, b: string): boolean {
  return blocks.has(`${a}|${b}`) || blocks.has(`${b}|${a}`);
}

const PRESENCE_PRIORITY: Presence[] = ["online", "busy", "away", "offline"];

/** One entry per username (a user may hold several sockets, e.g. panel + float). */
function publicRoster(): WireUser[] {
  const byUsername = new Map<string, WireUser>();

  for (const user of users.values()) {
    if (user.visibility !== "public") continue;

    const existing = byUsername.get(user.username);
    if (
      !existing ||
      PRESENCE_PRIORITY.indexOf(user.presence) <
        PRESENCE_PRIORITY.indexOf(existing.presence)
    ) {
      byUsername.set(user.username, user);
    }
  }

  return [...byUsername.values()];
}

/** Roster personalized per viewer: hidden presence masks to offline. */
function rosterFor(viewer: string): WireUser[] {
  return publicRoster().map((user) =>
    presenceHidden.has(`${user.username}|${viewer}`)
      ? { ...user, presence: "offline" as Presence }
      : user
  );
}

function broadcastRoster(): void {
  for (const [socketId, user] of users) {
    io.to(socketId).emit("roster", rosterFor(user.username));
  }
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

function allSocketIdsFor(username: string): string[] {
  const ids: string[] = [];
  for (const [id, user] of users) {
    if (user.username === username) ids.push(id);
  }
  return ids;
}

/** Send this user their current connection snapshot. */
function sendConnections(socketId: string, username: string): void {
  const snapshot: Array<{ username: string; status: string }> = [];

  for (const [key, pair] of pairs) {
    const [a, b] = key.split("|") as [string, string];
    if (a !== username && b !== username) continue;

    const other = a === username ? b : a;
    if (isBlockedEitherWay(username, other)) continue;

    snapshot.push({
      username: other,
      status:
        pair.status === "accepted"
          ? "accepted"
          : pair.requester === username
            ? "pending_out"
            : "pending_in",
    });
  }

  for (const entry of blocks) {
    const [blocker, blocked] = entry.split("|") as [string, string];
    if (blocker === username) {
      snapshot.push({ username: blocked, status: "blocked" });
    }
  }

  io.to(socketId).emit("connections", snapshot);
}

function notify(username: string, event: string, payload: unknown): void {
  for (const id of allSocketIdsFor(username)) {
    io.to(id).emit(event, payload);
  }
}

io.on("connection", (socket) => {
  socket.on("hello", (raw: Partial<WireUser>) => {
    if (!raw?.username) return;

    const user: WireUser = {
      username: String(raw.username).slice(0, 20).toLowerCase(),
      name: String(raw.name ?? raw.username).slice(0, 40),
      color: String(raw.color ?? "#2563EB").slice(0, 9),
      visibility: sanitizeVisibility(raw.visibility),
      presence: sanitizePresence(raw.presence),
      photo:
        typeof raw.photo === "string" && raw.photo.startsWith("data:image/")
          ? raw.photo.slice(0, 60000)
          : undefined,
    };

    users.set(socket.id, user);
    broadcastRoster();
    sendConnections(socket.id, user.username);

    const mine = [...communities.values()]
      .filter(
        (c) =>
          c.members.has(user.username) ||
          c.invites.get(user.username)?.pending
      )
      .map((c) => serializeCommunity(c, user.username));
    socket.emit("communities", mine);
  });

  socket.on("visibility", (raw: unknown) => {
    const user = users.get(socket.id);
    if (!user) return;
    user.visibility = sanitizeVisibility(raw);
    broadcastRoster();
  });

  socket.on("presence", (raw: unknown) => {
    const user = users.get(socket.id);
    if (!user) return;
    user.presence = sanitizePresence(raw);
    broadcastRoster();
  });

  /** Mask presence (as offline) toward one viewer. Messages still flow. */
  socket.on(
    "presence_hide",
    ({ username, hidden }: { username: string; hidden: boolean }) => {
      const me = users.get(socket.id);
      if (!me || !username) return;

      const key = `${me.username}|${username}`;
      if (hidden) presenceHidden.add(key);
      else presenceHidden.delete(key);
      broadcastRoster();
    }
  );

  /** Silently remove an accepted/pending connection (no leak to the other side). */
  socket.on("connection_remove", ({ username }: { username: string }) => {
    const me = users.get(socket.id);
    if (!me || !username) return;

    pairs.delete(pairKey(me.username, username));
    notify(me.username, "connect_update", { username, status: "none" });
  });

  // ---- Consent-based contact -------------------------------------------

  socket.on("connect_request", ({ to }: { to: string }) => {
    const from = users.get(socket.id);
    if (!from || !to || to === from.username) return;
    if (from.visibility === "private") return; // complete end

    // Blocked pairs: acknowledge as pending to the requester (no leak),
    // deliver nothing.
    if (isBlockedEitherWay(from.username, to)) {
      socket.emit("connect_update", { username: to, status: "pending_out" });
      return;
    }

    const key = pairKey(from.username, to);
    const existing = pairs.get(key);

    if (existing?.status === "accepted") {
      socket.emit("connect_update", { username: to, status: "accepted" });
      return;
    }

    // Both requested each other -> auto-accept.
    if (existing?.status === "pending" && existing.requester !== from.username) {
      existing.status = "accepted";
      notify(from.username, "connect_update", { username: to, status: "accepted" });
      notify(to, "connect_update", { username: from.username, status: "accepted" });
      return;
    }

    const targets = publicSocketIdsFor(to);
    if (targets.length === 0) {
      socket.emit("connect_error", { to, reason: "unavailable" });
      return;
    }

    pairs.set(key, { status: "pending", requester: from.username });

    socket.emit("connect_update", { username: to, status: "pending_out" });
    for (const id of targets) {
      io.to(id).emit("connect_request", { from });
    }
  });

  socket.on(
    "connect_response",
    ({ to, action }: { to: string; action: "accept" | "deny" }) => {
      const me = users.get(socket.id);
      if (!me || !to) return;

      const key = pairKey(me.username, to);
      const pair = pairs.get(key);

      // Only the recipient of a pending request may respond.
      if (!pair || pair.status !== "pending" || pair.requester !== to) return;

      if (action === "accept") {
        pair.status = "accepted";
        notify(me.username, "connect_update", { username: to, status: "accepted" });
        notify(to, "connect_update", { username: me.username, status: "accepted" });
      } else {
        pairs.delete(key);
        notify(me.username, "connect_update", { username: to, status: "none" });
        notify(to, "connect_update", { username: me.username, status: "declined" });
      }
    }
  );

  socket.on("block", ({ username }: { username: string }) => {
    const me = users.get(socket.id);
    if (!me || !username) return;

    blocks.add(`${me.username}|${username}`);
    pairs.delete(pairKey(me.username, username));

    // Only the blocker learns anything.
    notify(me.username, "connect_update", { username, status: "blocked" });
  });

  socket.on("unblock", ({ username }: { username: string }) => {
    const me = users.get(socket.id);
    if (!me || !username) return;

    blocks.delete(`${me.username}|${username}`);
    notify(me.username, "connect_update", { username, status: "none" });
  });

  socket.on(
    "report",
    ({ username, reason }: { username: string; reason?: string }) => {
      const me = users.get(socket.id);
      if (!me || !username) return;

      // Minimal, privacy-conscious log: who/whom/why, no message content
      // (the server never has message content to attach).
      console.log(
        `[report] @${me.username} reported @${username}` +
          (reason ? ` — ${String(reason).slice(0, 200)}` : "")
      );

      blocks.add(`${me.username}|${username}`);
      pairs.delete(pairKey(me.username, username));
      notify(me.username, "connect_update", { username, status: "blocked" });
    }
  );

  // ---- Communities (consent-gated membership) ---------------------------

  socket.on("community_create", ({ name }: { name: string }) => {
    const me = users.get(socket.id);
    if (!me || !name?.trim()) return;
    if (me.visibility === "private") return;

    const community: Community = {
      id: crypto.randomUUID(),
      name: String(name).trim().slice(0, 40),
      admin: me.username,
      members: new Set([me.username]),
      memberInfo: new Map([[me.username, { name: me.name, color: me.color }]]),
      invites: new Map(),
    };
    communities.set(community.id, community);
    notify(me.username, "community_update", {
      community: serializeCommunity(community),
    });
  });

  socket.on(
    "community_invite",
    ({ communityId, username }: { communityId: string; username: string }) => {
      const me = users.get(socket.id);
      const community = communities.get(communityId);
      if (!me || !community || !username) return;

      // Only the admin invites; membership is never imposed.
      if (community.admin !== me.username) return;
      if (community.members.has(username)) return;

      // Invitees must be ACCEPTED connections of the admin.
      const pair = pairs.get(pairKey(me.username, username));
      if (pair?.status !== "accepted" || isBlockedEitherWay(me.username, username)) {
        socket.emit("community_error", {
          communityId,
          username,
          reason: "not_connected",
        });
        return;
      }

      const invite = community.invites.get(username) ?? {
        attempts: 0,
        pending: false,
      };

      // 3-strike rule: after three declined/withdrawn invites the user
      // can never be added to THIS community again.
      if (invite.attempts >= MAX_INVITE_ATTEMPTS) {
        socket.emit("community_error", {
          communityId,
          username,
          reason: "invite_limit",
        });
        return;
      }
      if (invite.pending) {
        socket.emit("community_error", {
          communityId,
          username,
          reason: "already_pending",
        });
        return;
      }

      invite.attempts += 1;
      invite.pending = true;
      community.invites.set(username, invite);

      notify(username, "community_invite", {
        community: serializeCommunity(community, username),
        from: me,
        attempt: invite.attempts,
      });
      socket.emit("community_update", {
        community: serializeCommunity(community),
      });
    }
  );

  socket.on(
    "community_invite_response",
    ({
      communityId,
      action,
    }: {
      communityId: string;
      action: "accept" | "decline";
    }) => {
      const me = users.get(socket.id);
      const community = communities.get(communityId);
      if (!me || !community) return;

      const invite = community.invites.get(me.username);
      if (!invite?.pending) return;
      invite.pending = false;

      if (action === "accept") {
        community.members.add(me.username);
        community.memberInfo.set(me.username, {
          name: me.name,
          color: me.color,
        });
        for (const member of community.members) {
          notify(member, "community_update", {
            community: serializeCommunity(community),
          });
        }
      } else {
        const attemptsLeft = Math.max(
          0,
          MAX_INVITE_ATTEMPTS - invite.attempts
        );
        notify(community.admin, "community_invite_declined", {
          communityId,
          communityName: community.name,
          username: me.username,
          attemptsLeft,
          barred: attemptsLeft === 0,
        });
        notify(me.username, "community_update", {
          community: serializeCommunity(community, me.username),
        });
      }
    }
  );

  socket.on("community_leave", ({ communityId }: { communityId: string }) => {
    const me = users.get(socket.id);
    const community = communities.get(communityId);
    if (!me || !community || !community.members.has(me.username)) return;

    community.members.delete(me.username);

    // Leaving counts toward the 3-strike limit (a revocation).
    const invite = community.invites.get(me.username) ?? {
      attempts: 0,
      pending: false,
    };
    community.invites.set(me.username, { ...invite, pending: false });

    notify(community.admin, "community_invite_declined", {
      communityId,
      communityName: community.name,
      username: me.username,
      attemptsLeft: Math.max(0, MAX_INVITE_ATTEMPTS - invite.attempts),
      barred: invite.attempts >= MAX_INVITE_ATTEMPTS,
    });

    for (const member of community.members) {
      notify(member, "community_update", {
        community: serializeCommunity(community),
      });
    }
    notify(me.username, "community_left", { communityId });
  });

  socket.on(
    "community_message",
    ({
      communityId,
      message,
    }: {
      communityId: string;
      message: WireMessage;
    }) => {
      const from = users.get(socket.id);
      const community = communities.get(communityId);
      if (!from || !community || !message) return;
      if (from.visibility === "private") {
        socket.emit("dm_error", { to: communityId, reason: "sender_private" });
        return;
      }
      if (!community.members.has(from.username)) return;

      // Relay to every ONLINE member except the sender. Zero retention.
      for (const member of community.members) {
        if (member === from.username) continue;
        for (const id of publicSocketIdsFor(member)) {
          io.to(id).emit("community_message", { communityId, from, message });
        }
      }
    }
  );

  // ---- Messaging (public + accepted only) ------------------------------

  socket.on(
    "dm",
    ({ to, message }: { to: string; message: WireMessage }) => {
      const from = users.get(socket.id);
      if (!from || !to || !message) return;

      if (from.visibility === "private") {
        socket.emit("dm_error", { to, reason: "sender_private" });
        return;
      }

      // Consent gate: connection must be accepted and unblocked.
      const pair = pairs.get(pairKey(from.username, to));
      if (
        pair?.status !== "accepted" ||
        isBlockedEitherWay(from.username, to)
      ) {
        socket.emit("dm_error", { to, reason: "not_connected" });
        return;
      }

      const targets = publicSocketIdsFor(to);
      if (targets.length === 0) {
        socket.emit("dm_error", { to, reason: "recipient_unavailable" });
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
    if (from.visibility === "private") return;

    const pair = pairs.get(pairKey(from.username, to));
    if (pair?.status !== "accepted" || isBlockedEitherWay(from.username, to)) {
      return;
    }

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
  console.log(
    "[tabcom] privacy: zero message retention, server-enforced visibility, consent before contact"
  );
});
