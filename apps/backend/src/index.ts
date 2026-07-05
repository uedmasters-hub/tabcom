import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createServer } from "node:http";
import { Server } from "socket.io";

import {
  claimUsername,
  checkUsernameAvailable,
  pollLoginRequest,
  registerAccount,
  requestMagicLink,
  sendVerificationEmail,
  validateSession,
  verifyMagicLink,
} from "./auth/service";

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
  /** True once the account's email is confirmed. False for lean-
   *  onboarding accounts that haven't verified yet — surfaced to
   *  people they contact, not just to the account itself. */
  verified?: boolean;
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

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3001}`;

// Serverless Postgres providers (Neon, etc.) auto-suspend their
// compute after a period of inactivity to save cost — the free tier's
// whole value proposition. That's correct behavior, not a bug, but it
// means the FIRST query after suspension pays a cold-start delay. This
// doesn't eliminate that (nothing running client-side can), it just
// makes it far less frequent DURING an active session by keeping the
// compute from ever going idle long enough to suspend in the first
// place. Only runs when DATABASE_URL is actually configured — auth is
// additive, plenty of setups run this server without it at all.
if (process.env.DATABASE_URL) {
  const KEEP_ALIVE_MS = 4 * 60 * 1000; // well under typical 5min auto-suspend thresholds
  setInterval(() => {
    import("./db/client")
      .then(({ db, schema }) => db.select().from(schema.users).limit(1))
      .catch(() => {}); // best-effort — a failed ping just means the next real query pays the cold start
  }, KEEP_ALIVE_MS);
}

function readJsonBody(req: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const httpServer = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", PUBLIC_BASE_URL);

  if (req.method === "POST" && url.pathname === "/auth/request-link") {
    void readJsonBody(req)
      .then(async (body) => {
        const result = await requestMagicLink(String(body.email ?? ""), PUBLIC_BASE_URL);
        res.writeHead(result.ok ? 200 : 400, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      })
      .catch((error) => {
        console.error("[tabcom:auth] request-link failed:", error);
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, reason: "server_error" }));
      });
    return;
  }

  if (req.method === "GET" && url.pathname === "/auth/verify") {
    const token = url.searchParams.get("token") ?? "";
    const errorPage = `<!doctype html><html><body style="font-family:-apple-system,sans-serif;text-align:center;padding:64px 24px;">
              <h2>Something went wrong</h2>
              <p style="color:#64748B;">Go back to Tabcom and request a new link.</p>
            </body></html>`;
    void verifyMagicLink(token)
      .then((result) => {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          result.ok
            ? `<!doctype html><html><body style="font-family:-apple-system,sans-serif;text-align:center;padding:64px 24px;">
                <h2>You're signed in ✓</h2>
                <p style="color:#64748B;">You can close this tab and return to Tabcom.</p>
              </body></html>`
            : `<!doctype html><html><body style="font-family:-apple-system,sans-serif;text-align:center;padding:64px 24px;">
                <h2>This link has expired or was already used</h2>
                <p style="color:#64748B;">Go back to Tabcom and request a new one.</p>
              </body></html>`
        );
      })
      .catch((error) => {
        console.error("[tabcom:auth] verify failed:", error);
        res.writeHead(503, { "Content-Type": "text/html" });
        res.end(errorPage);
      });
    return;
  }

  if (req.method === "GET" && url.pathname === "/auth/poll") {
    const pollId = url.searchParams.get("pollId") ?? "";
    void pollLoginRequest(pollId)
      .then((result) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      })
      .catch((error) => {
        console.error("[tabcom:auth] poll failed:", error);
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "expired" }));
      });
    return;
  }

  if (req.method === "POST" && url.pathname === "/auth/claim-username") {
    void readJsonBody(req).then(async (body) => {
      try {
      const sessionToken = String(body.sessionToken ?? "");
      const user = await validateSession(sessionToken);
      if (!user) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, reason: "invalid_session" }));
        return;
      }
      const result = await claimUsername(
        user.id,
        String(body.username ?? ""),
        String(body.displayName ?? ""),
        String(body.avatarColor ?? "#2563EB")
      );
      res.writeHead(result.ok ? 200 : 409, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      } catch (error) {
        console.error("[tabcom:auth] claim-username failed:", error);
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, reason: "server_error" }));
      }
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/auth/check-username") {
    const username = url.searchParams.get("username") ?? "";
    checkUsernameAvailable(username)
      .then((result) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      })
      .catch((error) => {
        console.error("[tabcom:auth] check-username failed:", error);
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, reason: "server_error" }));
      });
    return;
  }

  if (req.method === "POST" && url.pathname === "/auth/register") {
    void readJsonBody(req)
      .then(async (body) => {
        const result = await registerAccount(
          String(body.email ?? ""),
          String(body.username ?? ""),
          String(body.displayName ?? ""),
          String(body.avatarColor ?? "#2563EB")
        );
        res.writeHead(result.ok ? 200 : 409, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      })
      .catch((error) => {
        console.error("[tabcom:auth] register failed:", error);
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, reason: "server_error" }));
      });
    return;
  }

  if (req.method === "POST" && url.pathname === "/auth/send-verification") {
    void readJsonBody(req)
      .then(async (body) => {
        const result = await sendVerificationEmail(
          String(body.sessionToken ?? ""),
          PUBLIC_BASE_URL
        );
        res.writeHead(result.ok ? 200 : 400, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      })
      .catch((error) => {
        console.error("[tabcom:auth] send-verification failed:", error);
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, reason: "server_error" }));
      });
    return;
  }

  if (req.method === "GET" && url.pathname === "/auth/me") {
    const sessionToken = url.searchParams.get("sessionToken") ?? "";
    validateSession(sessionToken)
      .then((user) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(user ? { ok: true, user } : { ok: false }));
      })
      .catch((error) => {
        console.error("[tabcom:auth] me failed:", error);
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false }));
      });
    return;
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, service: "tabcom-realtime" }));
});

const io = new Server(httpServer, { cors: { origin: "*" } });

const users = new Map<string, WireUser>(); // socket.id -> user

interface BoardComment {
  id: string;
  author: string; // username
  text: string;
  sentAt: number;
}

interface BoardPin {
  id: string;
  author: string;
  text: string;
  sentAt: number;
  /** Fallback position as a percentage of full document width/height. */
  xPercent: number;
  yPercent: number;
  /** Element anchor (preferred): CSS path + offsets within the element,
   *  so the pin sticks to CONTENT even as lazy-loading reshapes the page. */
  anchorSelector?: string;
  elXPercent?: number;
  elYPercent?: number;
}

interface BoardHighlight {
  id: string;
  author: string;
  sentAt: number;
  comment?: string;
  /** Text Quote Selector (Web Annotation-style): the exact selected text
   *  plus surrounding context, re-found by search rather than DOM path —
   *  survives markup changes that would break an element-path anchor. */
  quote: string;
  prefix: string;
  suffix: string;
}

interface BoardItem {
  id: string;
  url: string;
  /** Stable identity for a listing/product, independent of tracking params. */
  canonicalKey: string;
  title: string;
  image?: string;
  siteName?: string;
  addedBy: string;
  addedAt: number;
  comments: BoardComment[];
  pins: BoardPin[];
  highlights: BoardHighlight[];
  votes: Set<string>; // usernames who voted this item up
  decided: boolean;
}

interface Community {
  id: string;
  name: string;
  admin: string; // username
  members: Set<string>;
  memberInfo: Map<string, { name: string; color: string }>;
  invites: Map<string, { attempts: number; pending: boolean }>;
  /** Shared decision board — item id -> item. Zero-retention does not
   *  apply here by design: boards are meant to persist for the group,
   *  unlike chat messages. Cleared explicitly via board_clear. */
  board: Map<string, BoardItem>;
  boardDecidedId?: string;
}

const communities = new Map<string, Community>();
const MAX_INVITE_ATTEMPTS = 3;

function serializeBoardItem(item: BoardItem) {
  return {
    id: item.id,
    url: item.url,
    canonicalKey: item.canonicalKey,
    title: item.title,
    image: item.image,
    siteName: item.siteName,
    addedBy: item.addedBy,
    addedAt: item.addedAt,
    comments: item.comments,
    pins: item.pins,
    highlights: item.highlights,
    votes: [...item.votes],
    decided: item.decided,
  };
}

/** Find an existing item by canonicalKey, or create one on the fly —
 *  pinning/highlighting a page implicitly adds it to the board. */
function ensureBoardItem(
  community: Community,
  by: WireUser,
  anchor: { url: string; canonicalKey: string; title: string; image?: string; siteName?: string }
): BoardItem {
  const existing = [...community.board.values()].find(
    (item) => item.canonicalKey === anchor.canonicalKey
  );
  if (existing) return existing;

  const item: BoardItem = {
    id: crypto.randomUUID(),
    url: String(anchor.url).slice(0, 2000),
    canonicalKey: String(anchor.canonicalKey).slice(0, 300),
    title: String(anchor.title ?? anchor.url).slice(0, 200),
    image:
      typeof anchor.image === "string" && anchor.image.startsWith("http")
        ? anchor.image.slice(0, 1000)
        : undefined,
    siteName: anchor.siteName ? String(anchor.siteName).slice(0, 60) : undefined,
    addedBy: by.username,
    addedAt: Date.now(),
    comments: [],
    pins: [],
    highlights: [],
    votes: new Set(),
    decided: false,
  };
  community.board.set(item.id, item);
  return item;
}

function serializeCommunity(c: Community, forUsername?: string) {
  const invite = forUsername ? c.invites.get(forUsername) : undefined;
  const isAdmin = forUsername === c.admin;

  return {
    id: c.id,
    name: c.name,
    admin: c.admin,
    members: [...c.members].map((username) => ({
      username,
      ...(c.memberInfo.get(username) ?? { name: username, color: "#334155" }),
    })),
    pendingForMe: invite?.pending ?? false,
    // Only the admin can see who's been invited and hasn't responded —
    // it's membership-management info, not something every member needs.
    pendingInvites: isAdmin
      ? [...c.invites.entries()]
          .filter(([, state]) => state.pending)
          .map(([username, state]) => ({
            username,
            attemptsLeft: Math.max(0, MAX_INVITE_ATTEMPTS - state.attempts),
          }))
      : [],
    board: [...c.board.values()]
      .sort((a, b) => b.votes.size - a.votes.size || b.addedAt - a.addedAt)
      .map(serializeBoardItem),
    boardDecidedId: c.boardDecidedId,
  };
}
const pairs = new Map<string, Pair>(); // pairKey -> connection state
const blocks = new Set<string>(); // "blocker|blocked"
const presenceHidden = new Set<string>(); // "hider|viewer" — presence masked, messages still flow

// ---- Durable state --------------------------------------------------------
//
// The dev server runs under `tsx watch`, which restarts on every file
// change — with purely in-memory state, every patch applied wiped all
// communities, connections, and boards, making features appear broken
// when they were merely orphaned. Relationship state (communities incl.
// boards/pins/highlights, connections, blocks, presence masks) now
// snapshots to disk and reloads on boot.
//
// Deliberately NOT persisted, by design:
//   - chat messages (zero-retention privacy guarantee)
//   - live sessions/presence (users map — sessions are ephemeral)
//   - cursors (ephemeral relay only, never even held in memory)
//
// TABCOM_EPHEMERAL=1 disables persistence entirely (used by tests).

const STATE_FILE = process.env.TABCOM_STATE_FILE ?? "data/tabcom-state.json";
const EPHEMERAL = process.env.TABCOM_EPHEMERAL === "1";

function saveState(): void {
  if (EPHEMERAL) return;
  try {
    const snapshot = {
      version: 1,
      communities: [...communities.values()].map((c) => ({
        id: c.id,
        name: c.name,
        admin: c.admin,
        members: [...c.members],
        memberInfo: [...c.memberInfo.entries()],
        invites: [...c.invites.entries()],
        board: [...c.board.values()].map((item) => ({
          ...item,
          votes: [...item.votes],
        })),
        boardDecidedId: c.boardDecidedId,
      })),
      pairs: [...pairs.entries()],
      blocks: [...blocks],
      presenceHidden: [...presenceHidden],
    };
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(snapshot));
  } catch (error) {
    console.error("[tabcom] state save failed:", error);
  }
}

function loadState(): void {
  if (EPHEMERAL || !existsSync(STATE_FILE)) return;
  try {
    const snapshot = JSON.parse(readFileSync(STATE_FILE, "utf8"));

    for (const c of snapshot.communities ?? []) {
      communities.set(c.id, {
        id: c.id,
        name: c.name,
        admin: c.admin,
        members: new Set(c.members),
        memberInfo: new Map(c.memberInfo),
        invites: new Map(c.invites),
        board: new Map(
          (c.board ?? []).map((item: Record<string, unknown>) => [
            item.id,
            {
              ...item,
              comments: item.comments ?? [],
              pins: item.pins ?? [],
              highlights: item.highlights ?? [],
              votes: new Set(item.votes as string[]),
            },
          ])
        ),
        boardDecidedId: c.boardDecidedId,
      } as Community);
    }
    for (const [key, value] of snapshot.pairs ?? []) pairs.set(key, value);
    for (const key of snapshot.blocks ?? []) blocks.add(key);
    for (const key of snapshot.presenceHidden ?? []) presenceHidden.add(key);

    console.log(
      `[tabcom] durable state restored: ${communities.size} communities, ${pairs.size} connections`
    );
  } catch (error) {
    console.error("[tabcom] state load failed (starting fresh):", error);
  }
}

// Snapshot every 2s (small data, unconditional) and on shutdown — no
// per-mutation bookkeeping to forget in a future handler.
loadState();
if (!EPHEMERAL) {
  setInterval(saveState, 2000);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      saveState();
      process.exit(0);
    });
  }
}

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
  // Authentication is additive, not required — this keeps every
  // existing (pre-auth) client working exactly as before while
  // giving authenticated clients a REAL, server-verified identity
  // instead of a self-declared username. socket.io's own connection
  // handshake carries the token, so it's validated before any message
  // handler runs.
  const sessionToken = socket.handshake.auth?.sessionToken as string | undefined;

  socket.on("hello", (raw: Partial<WireUser>) => {
    void (sessionToken ? validateSession(sessionToken) : Promise.resolve(null)).then(
      (authedUser) => {
        // Re-checked on every "hello", not cached once at connection
        // time — verified status (and in principle the username too)
        // can change while a socket stays open (e.g. clicking the
        // verification link in another tab without reconnecting), and
        // a stale cached value would silently hide that from everyone
        // else until the person happened to reconnect.
        const authedUsername = authedUser?.username ?? null;
        const authedVerified = authedUser?.verified ?? false;

        // If this socket authenticated with a real session AND that
        // account has claimed a username, the account's username wins —
        // a client cannot impersonate anyone else's authenticated
        // identity by simply typing a different name in "hello".
        const claimedUsername = authedUsername ?? raw?.username;
        if (!claimedUsername) return;

        const user: WireUser = {
          username: String(claimedUsername).slice(0, 20).toLowerCase(),
          name: String(raw?.name ?? claimedUsername).slice(0, 40),
          color: String(raw?.color ?? "#2563EB").slice(0, 9),
          visibility: sanitizeVisibility(raw?.visibility),
          presence: sanitizePresence(raw?.presence),
          photo:
            typeof raw?.photo === "string" && raw.photo.startsWith("data:image/")
              ? raw.photo.slice(0, 60000)
              : undefined,
          // Same trust boundary as the username: only an authenticated
          // session can claim to be verified. An unauthenticated "hello"
          // (the pre-auth demo/dev path) is never marked verified,
          // regardless of what it sends.
          verified: authedUsername ? authedVerified : false,
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
      // NOTE: "connect_error" is a Socket.IO RESERVED event name — the
      // server throws if it's emitted with a custom payload, which
      // crashed the entire process for every connected user any time
      // someone requested an offline/unknown/mistyped username. Renamed
      // to a namespaced, non-reserved event.
      socket.emit("connect_request_error", { to, reason: "unavailable" });
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
      board: new Map(),
    };
    communities.set(community.id, community);
    notify(me.username, "community_update", {
      community: serializeCommunity(community, me.username),
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
        community: serializeCommunity(community, me.username),
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
            community: serializeCommunity(community, member),
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
        community: serializeCommunity(community, member),
      });
    }
    notify(me.username, "community_left", { communityId });
  });

  socket.on(
    "community_remove_member",
    ({ communityId, username }: { communityId: string; username: string }) => {
      const me = users.get(socket.id);
      const community = communities.get(communityId);
      if (!me || !community) return;
      if (community.admin !== me.username) return; // admin only
      if (username === me.username) return; // use community_leave for self
      if (!community.members.has(username)) return;

      community.members.delete(username);
      community.memberInfo.delete(username);

      // A removal counts as a strike, same as declining or leaving —
      // consistent with the existing 3-strike re-invite protection.
      const invite = community.invites.get(username) ?? {
        attempts: 0,
        pending: false,
      };
      community.invites.set(username, {
        attempts: invite.attempts + 1,
        pending: false,
      });

      for (const member of community.members) {
        notify(member, "community_update", {
          community: serializeCommunity(community, member),
        });
      }
      // The removed member's client drops the community the same way
      // it does for a voluntary leave.
      notify(username, "community_left", { communityId });
    }
  );

  socket.on(
    "community_invite_cancel",
    ({ communityId, username }: { communityId: string; username: string }) => {
      const me = users.get(socket.id);
      const community = communities.get(communityId);
      if (!me || !community) return;
      if (community.admin !== me.username) return; // admin only

      const invite = community.invites.get(username);
      if (!invite?.pending) return;
      invite.pending = false;

      notify(username, "community_invite_cancelled", { communityId });
      notify(me.username, "community_update", {
        community: serializeCommunity(community, me.username),
      });
    }
  );

  socket.on(
    "community_rename",
    ({ communityId, name }: { communityId: string; name: string }) => {
      const me = users.get(socket.id);
      const community = communities.get(communityId);
      if (!me || !community) return;
      if (community.admin !== me.username) return; // admin only

      const trimmed = String(name ?? "").trim().slice(0, 60);
      if (!trimmed) return;
      community.name = trimmed;

      for (const member of community.members) {
        notify(member, "community_update", {
          community: serializeCommunity(community, member),
        });
      }
    }
  );

  socket.on(
    "community_transfer_admin",
    ({ communityId, username }: { communityId: string; username: string }) => {
      const me = users.get(socket.id);
      const community = communities.get(communityId);
      if (!me || !community) return;
      if (community.admin !== me.username) return; // current admin only
      if (username === me.username) return;
      if (!community.members.has(username)) return; // must be a member

      community.admin = username;

      for (const member of community.members) {
        notify(member, "community_update", {
          community: serializeCommunity(community, member),
        });
      }
    }
  );

  socket.on(
    "community_delete",
    ({ communityId }: { communityId: string }) => {
      const me = users.get(socket.id);
      const community = communities.get(communityId);
      if (!me || !community) return;
      if (community.admin !== me.username) return; // admin only

      const members = [...community.members];
      communities.delete(communityId);

      for (const member of members) {
        notify(member, "community_deleted", { communityId });
      }
    }
  );

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

  // ---- Boards (shared decision layer, scoped to community membership) --

  socket.on(
    "board_add_item",
    ({
      communityId,
      url,
      canonicalKey,
      title,
      image,
      siteName,
    }: {
      communityId: string;
      url: string;
      canonicalKey: string;
      title: string;
      image?: string;
      siteName?: string;
    }) => {
      const me = users.get(socket.id);
      const community = communities.get(communityId);
      if (!me || !community || !url || !canonicalKey) return;
      if (!community.members.has(me.username)) return;

      ensureBoardItem(community, me, { url, canonicalKey, title, image, siteName });

      for (const member of community.members) {
        notify(member, "community_update", {
          community: serializeCommunity(community, member),
        });
      }
    }
  );

  socket.on(
    "board_remove_item",
    ({ communityId, itemId }: { communityId: string; itemId: string }) => {
      const me = users.get(socket.id);
      const community = communities.get(communityId);
      if (!me || !community) return;

      const item = community.board.get(itemId);
      if (!item) return;

      // Admin or the person who added it may remove it.
      if (community.admin !== me.username && item.addedBy !== me.username) {
        return;
      }

      community.board.delete(itemId);
      if (community.boardDecidedId === itemId) {
        community.boardDecidedId = undefined;
      }

      for (const member of community.members) {
        notify(member, "community_update", {
          community: serializeCommunity(community, member),
        });
      }
    }
  );

  socket.on(
    "board_comment",
    ({
      communityId,
      itemId,
      text,
    }: {
      communityId: string;
      itemId: string;
      text: string;
    }) => {
      const me = users.get(socket.id);
      const community = communities.get(communityId);
      if (!me || !community || !text?.trim()) return;
      if (!community.members.has(me.username)) return;

      const item = community.board.get(itemId);
      if (!item) return;

      item.comments.push({
        id: crypto.randomUUID(),
        author: me.username,
        text: String(text).trim().slice(0, 500),
        sentAt: Date.now(),
      });

      for (const member of community.members) {
        notify(member, "community_update", {
          community: serializeCommunity(community, member),
        });
      }
    }
  );

  socket.on(
    "board_vote",
    ({ communityId, itemId }: { communityId: string; itemId: string }) => {
      const me = users.get(socket.id);
      const community = communities.get(communityId);
      if (!me || !community) return;
      if (!community.members.has(me.username)) return;

      const item = community.board.get(itemId);
      if (!item) return;

      // Toggle: voting again retracts the vote.
      if (item.votes.has(me.username)) item.votes.delete(me.username);
      else item.votes.add(me.username);

      for (const member of community.members) {
        notify(member, "community_update", {
          community: serializeCommunity(community, member),
        });
      }
    }
  );

  socket.on(
    "board_pin_add",
    (input: {
      communityId: string;
      url: string;
      canonicalKey: string;
      title: string;
      image?: string;
      siteName?: string;
      text: string;
      xPercent: number;
      yPercent: number;
      anchorSelector?: string;
      elXPercent?: number;
      elYPercent?: number;
    }) => {
      const me = users.get(socket.id);
      const community = communities.get(input?.communityId);
      if (!me || !community || !input?.canonicalKey || !input?.text?.trim()) return;
      if (!community.members.has(me.username)) return;

      const item = ensureBoardItem(community, me, input);

      item.pins.push({
        id: crypto.randomUUID(),
        author: me.username,
        text: String(input.text).trim().slice(0, 300),
        sentAt: Date.now(),
        xPercent: Math.max(0, Math.min(100, Number(input.xPercent) || 0)),
        yPercent: Math.max(0, Math.min(100, Number(input.yPercent) || 0)),
        anchorSelector:
          typeof input.anchorSelector === "string"
            ? input.anchorSelector.slice(0, 500)
            : undefined,
        elXPercent:
          input.elXPercent != null
            ? Math.max(0, Math.min(100, Number(input.elXPercent) || 0))
            : undefined,
        elYPercent:
          input.elYPercent != null
            ? Math.max(0, Math.min(100, Number(input.elYPercent) || 0))
            : undefined,
      });

      for (const member of community.members) {
        notify(member, "community_update", {
          community: serializeCommunity(community, member),
        });
      }
    }
  );

  socket.on(
    "board_pin_remove",
    ({
      communityId,
      itemId,
      pinId,
    }: {
      communityId: string;
      itemId: string;
      pinId: string;
    }) => {
      const me = users.get(socket.id);
      const community = communities.get(communityId);
      const item = community?.board.get(itemId);
      if (!me || !community || !item) return;

      const pin = item.pins.find((p) => p.id === pinId);
      if (!pin) return;
      if (community.admin !== me.username && pin.author !== me.username) return;

      item.pins = item.pins.filter((p) => p.id !== pinId);

      for (const member of community.members) {
        notify(member, "community_update", {
          community: serializeCommunity(community, member),
        });
      }
    }
  );

  socket.on(
    "board_highlight_add",
    (input: {
      communityId: string;
      url: string;
      canonicalKey: string;
      title: string;
      image?: string;
      siteName?: string;
      quote: string;
      prefix: string;
      suffix: string;
      comment?: string;
    }) => {
      const me = users.get(socket.id);
      const community = communities.get(input?.communityId);
      if (!me || !community || !input?.canonicalKey || !input?.quote?.trim()) return;
      if (!community.members.has(me.username)) return;

      const item = ensureBoardItem(community, me, input);

      item.highlights.push({
        id: crypto.randomUUID(),
        author: me.username,
        sentAt: Date.now(),
        comment: input.comment ? String(input.comment).trim().slice(0, 300) : undefined,
        quote: String(input.quote).slice(0, 500),
        prefix: String(input.prefix ?? "").slice(0, 60),
        suffix: String(input.suffix ?? "").slice(0, 60),
      });

      for (const member of community.members) {
        notify(member, "community_update", {
          community: serializeCommunity(community, member),
        });
      }
    }
  );

  socket.on(
    "board_highlight_remove",
    ({
      communityId,
      itemId,
      highlightId,
    }: {
      communityId: string;
      itemId: string;
      highlightId: string;
    }) => {
      const me = users.get(socket.id);
      const community = communities.get(communityId);
      const item = community?.board.get(itemId);
      if (!me || !community || !item) return;

      const highlight = item.highlights.find((h) => h.id === highlightId);
      if (!highlight) return;
      if (community.admin !== me.username && highlight.author !== me.username) return;

      item.highlights = item.highlights.filter((h) => h.id !== highlightId);

      for (const member of community.members) {
        notify(member, "community_update", {
          community: serializeCommunity(community, member),
        });
      }
    }
  );

  socket.on(
    "board_decide",
    ({
      communityId,
      itemId,
    }: {
      communityId: string;
      itemId: string | null;
    }) => {
      const me = users.get(socket.id);
      const community = communities.get(communityId);
      if (!me || !community) return;
      if (community.admin !== me.username) return; // admin concludes

      for (const item of community.board.values()) item.decided = false;

      if (itemId) {
        const item = community.board.get(itemId);
        if (!item) return;
        item.decided = true;
        community.boardDecidedId = itemId;
      } else {
        community.boardDecidedId = undefined; // reopen the decision
      }

      for (const member of community.members) {
        notify(member, "community_update", {
          community: serializeCommunity(community, member),
        });
      }
    }
  );

  // ---- Live cursors (ephemeral presence, zero retention) ----------------
  //
  // Relayed only to members of the same community who are on the same
  // page (matched by canonicalKey client-side). Nothing is stored —
  // a cursor position exists only in flight.

  socket.on(
    "cursor_move",
    ({
      communityId,
      canonicalKey,
      xPercent,
      yPercent,
      anchorSelector,
      elXPercent,
      elYPercent,
    }: {
      communityId: string;
      canonicalKey: string;
      xPercent: number;
      yPercent: number;
      anchorSelector?: string;
      elXPercent?: number;
      elYPercent?: number;
    }) => {
      const me = users.get(socket.id);
      const community = communities.get(communityId);
      if (!me || !community || !canonicalKey) return;
      if (!community.members.has(me.username)) return;

      for (const member of community.members) {
        if (member === me.username) continue;
        notify(member, "cursor_peer", {
          communityId,
          canonicalKey,
          from: { username: me.username, name: me.name, color: me.color },
          xPercent: Math.max(0, Math.min(100, Number(xPercent) || 0)),
          yPercent: Math.max(0, Math.min(100, Number(yPercent) || 0)),
          anchorSelector:
            typeof anchorSelector === "string"
              ? anchorSelector.slice(0, 500)
              : undefined,
          elXPercent:
            elXPercent != null
              ? Math.max(0, Math.min(100, Number(elXPercent) || 0))
              : undefined,
          elYPercent:
            elYPercent != null
              ? Math.max(0, Math.min(100, Number(elYPercent) || 0))
              : undefined,
        });
      }
    }
  );

  socket.on(
    "cursor_leave",
    ({ communityId, canonicalKey }: { communityId: string; canonicalKey: string }) => {
      const me = users.get(socket.id);
      const community = communities.get(communityId);
      if (!me || !community || !community.members.has(me.username)) return;

      for (const member of community.members) {
        if (member === me.username) continue;
        notify(member, "cursor_peer_leave", {
          communityId,
          canonicalKey,
          from: me.username,
        });
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

  // ---- Message mutation events (edit/delete/react/read) -----------------
  //
  // No server-side message store exists (zero retention), so these are
  // pure relays — each client independently builds its local view from
  // the stream of events it receives, the same way message delivery
  // already works. The server re-applies the SAME consent/visibility
  // gates as sending a message, so a mutation can only ever reach
  // someone already inside that conversation.
  //
  // Known, accepted trade-off: because nothing is stored, the server
  // cannot verify a client's claim to have authored the message it's
  // editing/deleting — that trust is bounded by the same consent
  // relationship (accepted contact / community membership) that already
  // governs everything else here, not a new exposure.

  socket.on(
    "dm_edit",
    ({ to, messageId, text }: { to: string; messageId: string; text: string }) => {
      const from = users.get(socket.id);
      if (!from || !to || !messageId || !text?.trim()) return;
      if (from.visibility === "private") return;

      const pair = pairs.get(pairKey(from.username, to));
      if (pair?.status !== "accepted" || isBlockedEitherWay(from.username, to)) return;

      for (const id of publicSocketIdsFor(to)) {
        io.to(id).emit("dm_edited", {
          from: from.username,
          messageId,
          text: String(text).trim().slice(0, 2000),
          editedAt: Date.now(),
        });
      }
    }
  );

  socket.on(
    "dm_delete",
    ({ to, messageId }: { to: string; messageId: string }) => {
      const from = users.get(socket.id);
      if (!from || !to || !messageId) return;
      if (from.visibility === "private") return;

      const pair = pairs.get(pairKey(from.username, to));
      if (pair?.status !== "accepted" || isBlockedEitherWay(from.username, to)) return;

      for (const id of publicSocketIdsFor(to)) {
        io.to(id).emit("dm_deleted", { from: from.username, messageId });
      }
    }
  );

  socket.on(
    "dm_react",
    ({ to, messageId, emoji }: { to: string; messageId: string; emoji: string }) => {
      const from = users.get(socket.id);
      if (!from || !to || !messageId || !emoji) return;
      if (from.visibility === "private") return;

      const pair = pairs.get(pairKey(from.username, to));
      if (pair?.status !== "accepted" || isBlockedEitherWay(from.username, to)) return;

      for (const id of publicSocketIdsFor(to)) {
        io.to(id).emit("dm_reaction", {
          from: from.username,
          messageId,
          emoji: String(emoji).slice(0, 8),
        });
      }
    }
  );

  socket.on(
    "dm_read",
    ({ to, messageId }: { to: string; messageId: string }) => {
      const from = users.get(socket.id);
      if (!from || !to || !messageId) return;
      if (from.visibility === "private") return;

      const pair = pairs.get(pairKey(from.username, to));
      if (pair?.status !== "accepted" || isBlockedEitherWay(from.username, to)) return;

      for (const id of publicSocketIdsFor(to)) {
        io.to(id).emit("dm_read_receipt", {
          from: from.username,
          messageId,
          readAt: Date.now(),
        });
      }
    }
  );

  socket.on(
    "community_message_edit",
    ({
      communityId,
      messageId,
      text,
    }: {
      communityId: string;
      messageId: string;
      text: string;
    }) => {
      const from = users.get(socket.id);
      const community = communities.get(communityId);
      if (!from || !community || !messageId || !text?.trim()) return;
      if (from.visibility === "private") return;
      if (!community.members.has(from.username)) return;

      for (const member of community.members) {
        if (member === from.username) continue;
        for (const id of publicSocketIdsFor(member)) {
          io.to(id).emit("community_message_edited", {
            communityId,
            from: from.username,
            messageId,
            text: String(text).trim().slice(0, 2000),
            editedAt: Date.now(),
          });
        }
      }
    }
  );

  socket.on(
    "community_message_delete",
    ({ communityId, messageId }: { communityId: string; messageId: string }) => {
      const from = users.get(socket.id);
      const community = communities.get(communityId);
      if (!from || !community || !messageId) return;
      if (from.visibility === "private") return;
      if (!community.members.has(from.username)) return;

      for (const member of community.members) {
        if (member === from.username) continue;
        for (const id of publicSocketIdsFor(member)) {
          io.to(id).emit("community_message_deleted", {
            communityId,
            from: from.username,
            messageId,
          });
        }
      }
    }
  );

  socket.on(
    "community_message_react",
    ({
      communityId,
      messageId,
      emoji,
    }: {
      communityId: string;
      messageId: string;
      emoji: string;
    }) => {
      const from = users.get(socket.id);
      const community = communities.get(communityId);
      if (!from || !community || !messageId || !emoji) return;
      if (from.visibility === "private") return;
      if (!community.members.has(from.username)) return;

      for (const member of community.members) {
        if (member === from.username) continue;
        for (const id of publicSocketIdsFor(member)) {
          io.to(id).emit("community_reaction", {
            communityId,
            from: from.username,
            messageId,
            emoji: String(emoji).slice(0, 8),
          });
        }
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
