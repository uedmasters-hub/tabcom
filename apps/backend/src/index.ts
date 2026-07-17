import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { createServer } from "node:http";
import { Server } from "socket.io";

import {
  claimUsername,
  checkUsernameAvailable,
  deleteAccount,
  findActiveSessionForDevice,
  getUserSettings,
  isUsernameRegistered,
  pollLoginRequest,
  registerAccount,
  registerGuestSession,
  endGuestSessionNow,
  requestMagicLink,
  revokeSession,
  saveUserSettings,
  sendVerificationEmail,
  sweepExpiredSessions,
  validateSession,
  verifyMagicLink,
} from "./auth/service";
import { checkInvite, listInvites } from "./auth/invites";
import { db, schema } from "./db/client";
import { and, desc, eq, inArray } from "drizzle-orm";

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
  kind:
    | "text"
    | "link"
    | "voice"
    | "image"
    | "video"
    | "file"
    | "contact"
    | "location";
  text: string;
  url?: string;
  /** Media/file payload — relayed to the recipient and immediately
   *  forgotten, exactly like message text (zero retention). Files exist
   *  only on the sender's and receiver's devices; there is no server
   *  copy and therefore no re-download once a device loses its copy. */
  dataUrl?: string;
  durationMs?: number;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  latitude?: number;
  longitude?: number;
  contactUsername?: string;
  contactName?: string;
  contactColor?: string;
  sentAt: number;
  replyToId?: string;
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

  // Cheap liveness probe. The extension pings this on panel open to
  // kick a spun-down Render instance awake as early as possible; also
  // usable by uptime monitors / keep-alive cron.
  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

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

    // Shared card shell for every verify outcome. charset=utf-8 in BOTH
    // the header and a <meta> tag — the old page omitted it, and Chrome
    // fell back to latin-1, rendering the ✓ as "âœ“" mojibake.
    const authPage = (title: string, body: string, action?: string) =>
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — Tabcom</title></head>
      <body style="margin:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        <div style="max-width:460px;margin:48px auto;padding:0 16px;">
          <div style="background:#fff;border-radius:24px;padding:56px 32px;text-align:center;">
            <h1 style="margin:0;color:#0F172A;font-size:30px;letter-spacing:-0.02em;line-height:1.25;">${title}</h1>
            <p style="margin:20px 0 0;color:#475569;font-size:15px;line-height:1.65;">${body}</p>
            ${
              action
                ? `<button onclick="window.close()" style="display:block;width:100%;margin:28px 0 0;padding:16px 24px;background:#0F172A;color:#fff;border:0;border-radius:14px;font-weight:700;font-size:17px;cursor:pointer;">Back to Tabcom</button>
                   <p style="margin:24px 0 0;color:#64748B;font-size:14px;">${action}</p>`
                : ""
            }
          </div>
        </div>
      </body></html>`;

    const htmlHeaders = { "Content-Type": "text/html; charset=utf-8" };

    void verifyMagicLink(token)
      .then((result) => {
        res.writeHead(200, htmlHeaders);
        res.end(
          result.ok
            ? authPage(
                "Email verified",
                "Your email address was successfully verified. You can close this tab and continue using Tabcom."
              )
            : authPage(
                "Oops! This link has expired",
                "Verification links expire after 15 minutes or become invalid after they're used once.",
                "Request a new link from Tabcom to continue."
              )
        );
      })
      .catch((error) => {
        console.error("[tabcom:auth] verify failed:", error);
        res.writeHead(503, htmlHeaders);
        res.end(
          authPage(
            "Something went wrong",
            "We couldn't verify this link right now.",
            "Go back to Tabcom and request a new link."
          )
        );
      });
    return;
  }

  if (req.method === "GET" && url.pathname === "/auth/poll") {
    const pollId = url.searchParams.get("pollId") ?? "";
    const deviceId = url.searchParams.get("deviceId") ?? undefined;
    const browserInfo = url.searchParams.get("browserInfo") ?? undefined;
    void pollLoginRequest(pollId, deviceId, browserInfo)
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
          String(body.avatarColor ?? "#2563EB"),
          String(body.inviteCode ?? ""),
          typeof body.deviceId === "string" ? body.deviceId : undefined,
          typeof body.browserInfo === "string" ? body.browserInfo : undefined
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

  if (req.method === "POST" && url.pathname === "/auth/check-invite") {
    void readJsonBody(req)
      .then(async (body) => {
        const result = await checkInvite(String(body.code ?? ""));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      })
      .catch((error) => {
        console.error("[tabcom:auth] check-invite failed:", error);
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, reason: "server_error" }));
      });
    return;
  }

  if (req.method === "GET" && url.pathname === "/auth/invites") {
    const sessionToken = url.searchParams.get("sessionToken") ?? "";
    validateSession(sessionToken)
      .then(async (user) => {
        if (!user) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, reason: "invalid_session" }));
          return;
        }
        const invites = await listInvites(user.id);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, invites }));
      })
      .catch((error) => {
        console.error("[tabcom:auth] invites failed:", error);
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

  if (req.method === "POST" && url.pathname === "/auth/logout") {
    void readJsonBody(req)
      .then(async (body) => {
        const result = await revokeSession(String(body.sessionToken ?? ""));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      })
      .catch((error) => {
        console.error("[tabcom:auth] logout failed:", error);
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, reason: "server_error" }));
      });
    return;
  }

  if (req.method === "POST" && url.pathname === "/auth/delete-account") {
    void readJsonBody(req)
      .then(async (body) => {
        const result = await deleteAccount(String(body.sessionToken ?? ""));
        res.writeHead(result.ok ? 200 : 401, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      })
      .catch((error) => {
        console.error("[tabcom:auth] delete-account failed:", error);
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, reason: "server_error" }));
      });
    return;
  }

  // ---- Session management (Phase 1): device recognition + guest tracking --

  if (req.method === "POST" && url.pathname === "/session/register-guest") {
    void readJsonBody(req)
      .then(async (body) => {
        const guestUsername = String(body.guestUsername ?? "");
        const deviceId = String(body.deviceId ?? "");
        if (!guestUsername || !deviceId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, reason: "missing_fields" }));
          return;
        }
        await registerGuestSession({
          guestUsername,
          deviceId,
          browserInfo: typeof body.browserInfo === "string" ? body.browserInfo : undefined,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      })
      .catch((error) => {
        console.error("[tabcom] register-guest-session failed:", error);
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, reason: "server_error" }));
      });
    return;
  }

  // Manual guest sign-out — see endGuestSessionNow's doc comment for
  // why this exists as its own endpoint rather than reusing
  // /auth/logout: guests have no sessionToken to revoke with, so
  // without this, ending a guest session client-side only left the
  // server-side row (and therefore device recognition) still live for
  // the rest of its 30-minute TTL.
  if (req.method === "POST" && url.pathname === "/session/end-guest") {
    void readJsonBody(req)
      .then(async (body) => {
        const deviceId = String(body.deviceId ?? "");
        if (!deviceId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, reason: "missing_fields" }));
          return;
        }
        await endGuestSessionNow(deviceId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      })
      .catch((error) => {
        console.error("[tabcom] end-guest-session failed:", error);
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, reason: "server_error" }));
      });
    return;
  }

  // Device recognition — "is there an active session for this device?"
  // checked once on app startup. Never returns a bearer token (see the
  // doc comment on findActiveSessionForDevice for why) — the client's
  // own locally-stored sessionToken is still what actually
  // authenticates every request; this just tells it whether to trust
  // that local state or fall back to onboarding.
  if (req.method === "GET" && url.pathname === "/session/recognize") {
    const deviceId = url.searchParams.get("deviceId") ?? "";
    void findActiveSessionForDevice(deviceId)
      .then((session) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, session }));
      })
      .catch((error) => {
        console.error("[tabcom] session recognize failed:", error);
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, reason: "server_error" }));
      });
    return;
  }

  // ---- Phase 2: registered-user settings/preferences persistence ---------
  // Guests never hit these — they have no sessionToken, and their
  // settings stay local-only, ephemeral like the rest of their identity.

  if (req.method === "GET" && url.pathname === "/settings") {
    const sessionToken = url.searchParams.get("sessionToken") ?? "";
    void getUserSettings(sessionToken)
      .then((result) => {
        res.writeHead(result.ok ? 200 : 401, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      })
      .catch((error) => {
        console.error("[tabcom] get-settings failed:", error);
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, reason: "server_error" }));
      });
    return;
  }

  if (req.method === "POST" && url.pathname === "/settings") {
    void readJsonBody(req)
      .then(async (body) => {
        const result = await saveUserSettings(
          String(body.sessionToken ?? ""),
          body.settings ?? {}
        );
        res.writeHead(result.ok ? 200 : 401, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      })
      .catch((error) => {
        console.error("[tabcom] save-settings failed:", error);
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, reason: "server_error" }));
      });
    return;
  }

  // Community logo/avatar, uploaded via the community_set_image socket
  // event (see above) and served back over plain HTTP here so it can
  // be used directly as an <img src>. No session-token auth on this
  // GET — a community's id is an unguessable random UUID, and adding
  // real per-request membership checks here would mean every <img> tag
  // needs a way to attach a bearer token, which plain <img src> can't
  // do. This is the same "unlisted by URL" trade-off most avatar/asset
  // URLs make; the upload path (community_set_image) is fully
  // authenticated and admin-gated regardless.
  if (req.method === "GET" && url.pathname.startsWith("/community-image/")) {
    const communityId = url.pathname.slice("/community-image/".length);
    void db
      .select()
      .from(schema.communityImages)
      .where(eq(schema.communityImages.communityId, communityId))
      .limit(1)
      .then(([row]) => {
        if (!row) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, {
          "Content-Type": row.mimeType,
          // Safe to cache aggressively — the client busts this via
          // ?v=<imageVersion> whenever the image actually changes.
          "Cache-Control": "public, max-age=31536000, immutable",
        });
        res.end(Buffer.from(row.data, "base64"));
      })
      .catch((error) => {
        console.error("[tabcom] community image fetch failed:", error);
        res.writeHead(500);
        res.end();
      });
    return;
  }

  // Per-user activity report — membership + board (tabs/pins/areas)
  // events only, exported as CSV. Deliberately requires a real session
  // (not available to guests, who have no durable identity to attach
  // a downloadable report to) — see communityActivity's schema comment
  // for why message content is never in scope for this at all.
  if (req.method === "GET" && url.pathname === "/activity-report") {
    void validateSession(url.searchParams.get("sessionToken") ?? "")
      .then(async (authedUser) => {
        if (!authedUser?.username) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, reason: "invalid_session" }));
          return;
        }

        const rows = await db
          .select()
          .from(schema.communityActivity)
          .where(eq(schema.communityActivity.username, authedUser.username))
          .orderBy(desc(schema.communityActivity.createdAt));

        const escapeCsv = (value: string) =>
          /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

        const header = "date,community,action,detail\n";
        const body = rows
          .map((row) =>
            [
              row.createdAt.toISOString(),
              row.communityName,
              row.action,
              row.detail ?? "",
            ]
              .map((field) => escapeCsv(String(field)))
              .join(",")
          )
          .join("\n");

        res.writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="tabcom-activity-${authedUser.username}.csv"`,
        });
        res.end(header + body);
      })
      .catch((error) => {
        console.error("[tabcom] activity report export failed:", error);
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, reason: "server_error" }));
      });
    return;
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, service: "tabcom-realtime" }));
});

// Voice notes and shared photos both ride this same relay as base64
// data URLs (see the "dm" handler below) — the 1MB default was too
// tight for either once bitrate/quality pushed past it, and there was
// no feedback at all when a frame got silently dropped for being too
// large. 8MB comfortably covers a 60s voice note at a sane bitrate
// (see ChatView's explicit audioBitsPerSecond cap) and a downscaled
// photo, with real headroom rather than a coin-flip ceiling.
//
// pingInterval/pingTimeout tightened from socket.io's defaults
// (25000/20000, ~45s to notice a dead connection) to ~18s total. A
// Chrome extension's background service worker can be killed by
// Chrome (idle timeout, or an abrupt reload during development)
// without ever running a clean socket.disconnect() — the default
// timing left stale "ghost" users showing as online in Discover for
// up to 45s per dead connection, and MV3's frequent worker restarts
// during active use/testing make that a lot more likely to be
// visible than on a typical always-on client.
const io = new Server(httpServer, {
  cors: { origin: "*" },
  maxHttpBufferSize: 8 * 1024 * 1024,
  pingInterval: 10_000,
  pingTimeout: 8_000,
});

const users = new Map<string, WireUser>(); // socket.id -> user

// Belt-and-suspenders against "ghost" online users: the "disconnect"
// handler below (and the tightened ping timeout above) SHOULD always
// catch a dead connection, but this reconciles the users map against
// what Socket.IO itself actually still considers connected every 20s,
// so a stale entry can never persist for more than one sweep even in
// an edge case neither of those catches.
setInterval(() => {
  let changed = false;
  for (const socketId of users.keys()) {
    if (!io.sockets.sockets.has(socketId)) {
      users.delete(socketId);
      changed = true;
    }
  }
  if (changed) broadcastRoster();
}, 20_000);

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
  /** Fallback position as a percentage of full document width/height —
   *  legacy field, kept for pins created before pageX/pageY existed.
   *  Drifts on pages whose total height grows over time (infinite
   *  scroll, lazy loading), since the same percentage then maps to a
   *  different absolute pixel than when it was drawn. */
  xPercent: number;
  yPercent: number;
  /** Absolute document-pixel fallback (preferred over xPercent/yPercent
   *  when present) — captured once at creation, immune to the page's
   *  total height changing later since new content appended BELOW an
   *  annotation doesn't shift anything ABOVE it. */
  pageX?: number;
  pageY?: number;
  /** Element anchor (preferred over both fallbacks): CSS path + offsets
   *  within the element, so the pin sticks to CONTENT itself even as
   *  the page reshapes — this is the best option when it holds; the
   *  pixel/percent fields only matter when it can't be resolved. */
  anchorSelector?: string;
  elXPercent?: number;
  elYPercent?: number;
  /** A genuine discussion thread ON this specific pin — separate from
   *  `text` (the pin's own caption, set once at creation). */
  comments: BoardComment[];
}

interface BoardHighlight {
  id: string;
  author: string;
  sentAt: number;
  /** Text Quote Selector (Web Annotation-style): the exact selected text
   *  plus surrounding context, re-found by search rather than DOM path —
   *  survives markup changes that would break an element-path anchor. */
  quote: string;
  prefix: string;
  suffix: string;
  /** A genuine discussion thread on this specific highlight. The
   *  optional note given at creation time (if any) becomes the first
   *  entry rather than living in a separate field. */
  comments: BoardComment[];
}

/** A rectangular region on the page, drawn by dragging — the "click and
 *  drag" half of the unified pin/area annotate tool. Works over ANY
 *  content (images, mixed layouts), unlike text-quote highlights which
 *  only apply to selectable text. Position is a percentage of the full
 *  document, same convention as BoardPin, plus a size. */
interface BoardArea {
  id: string;
  author: string;
  sentAt: number;
  text: string;
  /** Legacy percentage-based fallback — same drift issue as BoardPin's
   *  xPercent/yPercent on pages whose total height grows over time. */
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  /** Absolute document-pixel fallback (preferred over the percentage
   *  fields when present) — same reasoning as BoardPin.pageX/pageY. */
  pageX?: number;
  pageY?: number;
  pageWidth?: number;
  pageHeight?: number;
  /** Element anchor for the top-left corner — preferred over both
   *  fallbacks, same reasoning as pins. */
  anchorSelector?: string;
  elXPercent?: number;
  elYPercent?: number;
  comments: BoardComment[];
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
  areas: BoardArea[];
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
  /** Bumped on every community_set_image — the client appends this to
   *  the image URL as a cache-busting query param, since the URL
   *  itself (/community-image/:id) doesn't change when the image is
   *  replaced and browsers would otherwise keep showing the old one. */
  imageVersion?: number;
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
    comments: item.comments ?? [],
    pins: item.pins ?? [],
    highlights: item.highlights ?? [],
    areas: item.areas ?? [],
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
    areas: [],
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
    imageVersion: c.imageVersion,
  };
}
const pairs = new Map<string, Pair>(); // pairKey -> connection state

/**
 * socket.id -> the guest identity's stable instance id (see
 * ensureUniqueGuestUsername below). NOT part of the `users` map or the
 * WireUser type on purpose: this is a server-side-only disambiguation
 * signal, never broadcast to anyone. Ephemeral like `users` itself —
 * cleaned up on disconnect, never persisted.
 */
const guestInstanceIds = new Map<string, string>();
const blocks = new Set<string>(); // "blocker|blocked"
const presenceHidden = new Set<string>(); // "hider|viewer" — presence masked, messages still flow

// ---- Durable state --------------------------------------------------------
//
// The dev server runs under `tsx watch`, which restarts on every file
// change — with purely in-memory state, every patch applied wiped all
// communities, connections, and boards, making features appear broken
// when they were merely orphaned. Relationship state (communities incl.
// boards/pins/highlights, connections, blocks, presence masks) snapshots
// to Postgres (Neon) and reloads on boot.
//
// THIS WAS PREVIOUSLY A LOCAL JSON FILE (data/tabcom-state.json), which
// is durable under `tsx watch` (same disk survives that kind of
// restart) but NOT durable on Render: a spin-down/spin-up cycle (free
// tier idles after ~15 min) or any redeploy starts a brand-new
// container with a wiped filesystem, silently resetting the file to
// nonexistent — every community, tab, pin, and area was gone on the
// next request, looking exactly like "a community got automatically
// deleted." Postgres is the durable store this project already has;
// moving the exact same snapshot into one JSONB row fixes this with no
// change to the in-memory model or the save/load cadence.
//
// Deliberately NOT persisted, by design:
//   - chat messages (zero-retention privacy guarantee)
//   - live sessions/presence (users map — sessions are ephemeral)
//   - cursors (ephemeral relay only, never even held in memory)
//
// TABCOM_EPHEMERAL=1 disables persistence entirely (used by tests).

const EPHEMERAL = process.env.TABCOM_EPHEMERAL === "1";
const BOARD_STATE_KEY = "singleton";
// Legacy path from the old file-based mechanism — read ONCE on boot as
// a rescue import (whatever's still sitting on THIS instance's disk,
// if this hasn't already been wiped by a prior restart) so nothing
// still-recoverable gets thrown away on the cutover to Postgres. Never
// written to again after that.
const LEGACY_STATE_FILE = process.env.TABCOM_STATE_FILE ?? "data/tabcom-state.json";

function buildSnapshot() {
  return {
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
      imageVersion: c.imageVersion,
    })),
    pairs: [...pairs.entries()],
    blocks: [...blocks],
    presenceHidden: [...presenceHidden],
  };
}

async function saveState(): Promise<void> {
  if (EPHEMERAL) return;
  try {
    await db
      .insert(schema.boardState)
      .values({ key: BOARD_STATE_KEY, data: buildSnapshot(), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: schema.boardState.key,
        set: { data: buildSnapshot(), updatedAt: new Date() },
      });
  } catch (error) {
    console.error("[tabcom] state save failed:", error);
  }
}

function applySnapshot(snapshot: {
  communities?: unknown[];
  pairs?: [string, Pair][];
  blocks?: string[];
  presenceHidden?: string[];
}) {
  for (const c of (snapshot.communities ?? []) as Array<Record<string, unknown>>) {
    communities.set(c.id as string, {
      id: c.id,
      name: c.name,
      admin: c.admin,
      members: new Set(c.members as string[]),
      memberInfo: new Map(c.memberInfo as [string, unknown][]),
      invites: new Map(c.invites as [string, unknown][]),
      board: new Map(
        ((c.board ?? []) as Record<string, unknown>[]).map((item) => [
          item.id,
          {
            ...item,
            comments: item.comments ?? [],
            // Pins/highlights created before comment threads existed
            // are missing this field entirely in the persisted data —
            // backfill it here rather than crash the client trying to
            // read .comments.length on old data.
            pins: ((item.pins as Record<string, unknown>[]) ?? []).map((pin) => ({
              ...pin,
              comments: pin.comments ?? [],
            })),
            highlights: ((item.highlights as Record<string, unknown>[]) ?? []).map(
              (highlight) => ({
                ...highlight,
                comments: highlight.comments ?? [],
              })
            ),
            areas: ((item.areas as Record<string, unknown>[]) ?? []).map((area) => ({
              ...area,
              comments: area.comments ?? [],
            })),
            votes: new Set(item.votes as string[]),
          },
        ])
      ),
      boardDecidedId: c.boardDecidedId,
      imageVersion: c.imageVersion as number | undefined,
    } as Community);
  }
  for (const [key, value] of snapshot.pairs ?? []) pairs.set(key, value);
  for (const key of snapshot.blocks ?? []) blocks.add(key);
  for (const key of snapshot.presenceHidden ?? []) presenceHidden.add(key);
}

async function loadState(): Promise<void> {
  if (EPHEMERAL) return;
  try {
    const rows = await db
      .select()
      .from(schema.boardState)
      .where(eq(schema.boardState.key, BOARD_STATE_KEY))
      .limit(1);

    if (rows[0]) {
      applySnapshot(rows[0].data as Parameters<typeof applySnapshot>[0]);
      console.log(
        `[tabcom] durable state restored from Postgres: ${communities.size} communities, ${pairs.size} connections`
      );
      return;
    }

    // Nothing in Postgres yet — this is either a genuinely fresh
    // server, or this is the FIRST boot after upgrading to this
    // Postgres-backed version. In the latter case, THIS instance's
    // local disk may still hold the old file from before the cutover
    // (if it hasn't already been wiped by an earlier restart) — a
    // one-time rescue import so the upgrade itself doesn't cause the
    // exact data loss it's meant to fix.
    if (existsSync(LEGACY_STATE_FILE)) {
      const legacy = JSON.parse(readFileSync(LEGACY_STATE_FILE, "utf8"));
      applySnapshot(legacy);
      console.log(
        `[tabcom] rescued legacy file-based state into Postgres: ${communities.size} communities, ${pairs.size} connections`
      );
      await saveState(); // commit the rescued data before anything can wipe the file again
    } else {
      console.log("[tabcom] durable state: nothing in Postgres and no legacy file — starting fresh");
    }
  } catch (error) {
    console.error("[tabcom] state load failed (starting fresh):", error);
  }
}

// Snapshot every 2s (small data, unconditional) and on shutdown — no
// per-mutation bookkeeping to forget in a future handler.
void loadState();
if (!EPHEMERAL) {
  setInterval(() => void saveState(), 2000);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void saveState().finally(() => process.exit(0));
    });
  }
}

// Moves sessions whose time has passed from "active" to "expired" —
// same cadence class as the other periodic housekeeping here. Every
// 60s is plenty; nothing time-sensitive reads `status` more urgently
// than that (findActiveSessionForDevice also double-checks expiresAt
// directly, so a session doesn't briefly look valid in the gap
// between actually expiring and this sweep catching up to it).
//
// Presence enforcement lives here too: a socket staying CONNECTED and
// a guest's SESSION being EXPIRED are two different facts, and only
// the second one is what should decide whether that identity shows as
// "online" anywhere. Without this, a guest's background-script socket
// (which has no concept of the 30-minute session timer at all —
// that's tracked client-side, in the popup UI only) would keep
// reporting them as live indefinitely, which is exactly the "expired
// session still shows as Live" bug this closes: the database's
// expiry is now enforced against the actual live connection, not the
// other way around.
if (!EPHEMERAL) {
  setInterval(() => {
    void sweepExpiredSessions().then(({ expiredGuestUsernames }) => {
      if (expiredGuestUsernames.length === 0) return;
      const expired = new Set(expiredGuestUsernames);

      for (const [socketId, user] of users) {
        if (!expired.has(user.username)) continue;
        console.log(
          "[tabcom] disconnecting socket for expired guest session:",
          user.username
        );
        io.sockets.sockets.get(socketId)?.disconnect(true);
        // The socket's own "disconnect" handler also does this, but
        // don't wait on that round trip — remove it from the roster
        // immediately so presence reflects reality the instant the
        // database says the session is gone, not one event-loop tick
        // later.
        users.delete(socketId);
        guestInstanceIds.delete(socketId);
      }
      broadcastRoster();
    });
  }, 60_000);
}

// ---- Per-user activity log (membership + board only, never messages) -----

type ActivityAction =
  | "community_created"
  | "joined"
  | "left"
  | "tab_added"
  | "tab_removed"
  | "pin_added"
  | "pin_removed"
  | "area_added"
  | "area_removed";

/**
 * Fire-and-forget by design: a logging failure must never break the
 * actual feature it's describing (creating a pin still has to work
 * even if, say, the DB briefly hiccups on the log insert). Errors are
 * caught and reported, never thrown back into the caller.
 *
 * `detail` is intentionally restricted to short, non-sensitive context
 * (a page title, truncated) — never pin/area text, never message
 * content. See the schema comment on communityActivity for why.
 */
function logActivity(
  communityId: string,
  communityName: string,
  username: string,
  action: ActivityAction,
  detail?: string
): void {
  db.insert(schema.communityActivity)
    .values({
      communityId,
      communityName,
      username,
      action,
      detail: detail ? detail.slice(0, 200) : null,
    })
    .catch((error) => {
      console.error("[tabcom] activity log insert failed:", error);
    });
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

// Deliberate statuses WIN over the default "online". A user with two
// live sockets (panel + background relay, or two devices) who sets
// Busy/Away/Appear-offline on one must not be overridden by another
// socket still reporting the default — and a call context marking
// itself "busy" flips the whole account busy, which is exactly the
// auto-busy-during-calls behavior.
const PRESENCE_PRIORITY: Presence[] = ["busy", "away", "offline", "online"];

/** The presence peers should treat as this account's, across all its
 *  public sockets. "offline" from a connected socket means the user
 *  CHOSE Appear offline; no public sockets at all also reads offline. */
function effectivePresenceOf(username: string): Presence {
  let best: Presence | null = null;
  for (const user of users.values()) {
    if (user.username !== username || user.visibility !== "public") continue;
    const p = user.presence ?? "online";
    if (best === null || PRESENCE_PRIORITY.indexOf(p) < PRESENCE_PRIORITY.indexOf(best)) {
      best = p;
    }
  }
  return best ?? "offline";
}

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

/**
 * Guarantees an unauthenticated ("hello" with no session) connection
 * can never claim a username that's already in use — by a real
 * registered account, OR by another currently-connected socket (guest
 * or otherwise). Retries with a random numeric suffix until free.
 *
 * This is the actual fix for guests appearing to "merge": previously
 * an unauthenticated hello's username was trusted verbatim with zero
 * collision check, so two different people (or two devices) landing
 * on the same generated/typed name became indistinguishable to every
 * part of the system that keys by username string — same roster
 * entry, same community membership, same DM delivery target.
 *
 * myGuestInstanceId disambiguates the OPPOSITE case: one browser
 * legitimately holds several simultaneous connections under the same
 * guest identity (the panel, the background relay, the pip window),
 * each a genuinely different socket. Without this, connection #2 and
 * #3 collided against connection #1's already-claimed name every
 * time, fragmenting one guest into two or three different suffixed
 * usernames that show up as separate strangers in Discover — this was
 * the actual mechanism behind that bug, not a display issue.
 */
async function ensureUniqueGuestUsername(
  candidate: string,
  mySocketId: string,
  myGuestInstanceId?: string
): Promise<string> {
  let attempt = candidate;

  for (let i = 0; i < 6; i++) {
    const takenByAccount = await isUsernameRegistered(attempt);
    const takenByOtherSocket = [...users.entries()].some(([id, user]) => {
      if (id === mySocketId) return false;
      if (user.username !== attempt) return false;
      // Same username, different socket — only a REAL collision if
      // it's not just another connection of this same guest identity.
      if (myGuestInstanceId && guestInstanceIds.get(id) === myGuestInstanceId) {
        return false;
      }
      return true;
    });

    if (!takenByAccount && !takenByOtherSocket) return attempt;

    const suffix = String(Math.floor(1000 + Math.random() * 9000));
    attempt = `${candidate.slice(0, 20 - suffix.length)}${suffix}`;
  }

  // Practically unreachable after 6 rounds of a 4-digit suffix, but a
  // time-based tail is unique by construction if it ever comes to that.
  return `${candidate.slice(0, 14)}${Date.now().toString(36).slice(-6)}`;
}

  socket.on(
    "hello",
    (
      raw: Partial<WireUser> & { guestInstanceId?: string },
      ack?: (response: { username: string }) => void
    ) => {
      void (sessionToken ? validateSession(sessionToken) : Promise.resolve(null)).then(
      async (authedUser) => {
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
        let claimedUsername = authedUsername ?? raw?.username;
        if (!claimedUsername) return;
        claimedUsername = String(claimedUsername).slice(0, 20).toLowerCase();

        // Authenticated usernames are already guaranteed unique — they
        // went through real DB-backed uniqueness checking at
        // registration (see auth/service.ts's claimUsername /
        // registerAccount). Only the unauthenticated path — guests,
        // and the pre-auth demo/dev fallback — ever needs this, since
        // it used to trust the client's self-reported name completely.
        if (!authedUsername) {
          const guestInstanceId = raw?.guestInstanceId
            ? String(raw.guestInstanceId).slice(0, 64)
            : undefined;
          if (guestInstanceId) guestInstanceIds.set(socket.id, guestInstanceId);
          claimedUsername = await ensureUniqueGuestUsername(
            claimedUsername,
            socket.id,
            guestInstanceId
          );
        }

        const user: WireUser = {
          username: claimedUsername,
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

      // Tells the client the username it's ACTUALLY registered under —
      // essential for guests, since that can now differ from what they
      // proposed if it collided with someone else. A client that kept
      // using the old value locally would sign its own outgoing
      // messages/board actions with an identity the server no longer
      // recognizes as this socket.
      ack?.({ username: user.username });
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

  // Mirror of connect_response's "deny" branch, but triggered by the
  // ORIGINAL REQUESTER withdrawing their own still-pending request
  // (the "Revoke" action) rather than the recipient declining it.
  socket.on("connect_cancel", ({ to }: { to: string }) => {
    const me = users.get(socket.id);
    if (!me || !to) return;

    const key = pairKey(me.username, to);
    const pair = pairs.get(key);

    // Only the person who SENT the still-pending request may cancel
    // it — same "only the right side of this pair may act" guard
    // connect_response uses, just checking the opposite party.
    if (!pair || pair.status !== "pending" || pair.requester !== me.username) return;

    pairs.delete(key);
    notify(me.username, "connect_update", { username: to, status: "none" });
    notify(to, "connect_update", { username: me.username, status: "none" });
  });

  // Extends Phase 2 (registered-user persistence) to contacts. The
  // `pairs` map is already durable (see boardState's snapshot — pairs
  // ride along with it), so an accepted connection surviving a restart
  // was never the gap; the gap was that a FRESH client (new device, or
  // this one after a reinstall) had no way to ask for that history at
  // all — its local `contacts` array started empty and only ever grew
  // from live roster/DM activity, silently losing every OFFLINE
  // contact the moment local storage did.
  //
  // Only returns connections to REGISTERED accounts, deliberately — a
  // guest contact's username is inherently a dead end once that guest
  // session has ended (a new guest session picks a fresh, unrelated
  // username), so "restoring" one would just repopulate the contact
  // list with people who can never be reached again. A registered
  // account's username is permanent, so restoring those is genuinely
  // useful.
  socket.on(
    "get_my_connections",
    async (_: unknown, ack?: (response: { connections: Array<{ username: string; displayName: string | null; avatarColor: string | null }> }) => void) => {
      const me = users.get(socket.id);
      if (!me || !ack) return;

      const connectedUsernames = [...pairs.entries()]
        .filter(([key, pair]) => pair.status === "accepted" && key.split("|").includes(me.username))
        .map(([key]) => key.split("|").find((u) => u !== me.username)!)
        .filter(Boolean);

      if (connectedUsernames.length === 0) {
        ack({ connections: [] });
        return;
      }

      try {
        const rows = await db
          .select({
            username: schema.users.username,
            displayName: schema.users.displayName,
            avatarColor: schema.users.avatarColor,
          })
          .from(schema.users)
          .where(inArray(schema.users.username, connectedUsernames));

        ack({
          connections: rows
            .filter((r) => r.username)
            .map((r) => ({
              username: r.username!,
              displayName: r.displayName,
              avatarColor: r.avatarColor,
            })),
        });
      } catch (error) {
        console.error("[tabcom] get_my_connections failed:", error);
        ack({ connections: [] });
      }
    }
  );

  /**
   * "Clear history" — resets this user's own activity while keeping
   * their identity, session, contacts, and community memberships
   * completely untouched. Works for both registered accounts AND
   * guests — a guest session already resets everything automatically
   * after 30 minutes, but there's no real reason to force someone to
   * wait that long if they want a clean slate for the REST of an
   * otherwise still-active session.
   *
   * The board-content cleanup below only ever removes THIS user's own
   * pins/areas/votes, and only removes a TAB they added if nobody
   * else has since contributed anything to it — pins/tabs/areas are
   * shared community objects other members may be actively relying
   * on, and this project has already paid for the mistake of treating
   * per-user cleanup as "delete the shared thing" once before (see the
   * guest cascading-cleanup comment on sweepExpiredSessions). Deleting
   * someone else's contribution because IT happened to live on a tab
   * this user added would be that same mistake again.
   *
   * The board mutation is applied in-memory and durably persisted via
   * the same board_state snapshot every other board write already
   * uses — it is NOT part of the SQL transaction below, because that
   * data was never in a relational table to begin with; wrapping only
   * the two genuinely relational deletes (activity log, settings) in
   * a real transaction is the honest scope of "transactional" this
   * architecture actually supports.
   */
  socket.on(
    "clear_my_history",
    async (_: unknown, ack?: (response: { ok: boolean; reason?: string }) => void) => {
      const me = users.get(socket.id);
      if (!me || !ack) return;

      // Only registered accounts have a users-table row (and
      // therefore a user_settings row to clear) — guests legitimately
      // have neither, which is fine, not an error condition.
      const [registeredUser] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.username, me.username))
        .limit(1)
        .catch(() => [] as { id: string }[]);

      // ---- In-memory board cleanup: only this user's own contributions ----
      for (const community of communities.values()) {
        if (!community.members.has(me.username)) continue;
        let touched = false;

        for (const item of community.board.values()) {
          const beforePins = item.pins.length;
          const beforeAreas = item.areas.length;
          item.pins = item.pins.filter((p) => p.author !== me.username);
          item.areas = item.areas.filter((a) => a.author !== me.username);
          if (item.pins.length !== beforePins || item.areas.length !== beforeAreas) touched = true;
          if (item.votes.delete(me.username)) touched = true;
        }

        // A tab this user added is only removed if NO ONE ELSE has
        // contributed anything to it since — otherwise it stays, with
        // just this user's own pieces of it already stripped above.
        for (const [itemId, item] of [...community.board.entries()]) {
          if (item.addedBy !== me.username) continue;
          const hasOthersContent =
            item.pins.some((p) => p.author !== me.username) ||
            item.areas.some((a) => a.author !== me.username) ||
            item.highlights.some((h) => h.author !== me.username) ||
            item.comments.some((c) => c.author !== me.username) ||
            item.votes.size > 0;
          if (!hasOthersContent) {
            community.board.delete(itemId);
            if (community.boardDecidedId === itemId) community.boardDecidedId = undefined;
            touched = true;
          }
        }

        if (touched) {
          for (const member of community.members) {
            notify(member, "community_update", {
              community: serializeCommunity(community, member),
            });
          }
        }
      }

      // ---- Durable cleanup: activity log + settings ----
      try {
        await db.transaction(async (tx) => {
          await tx
            .delete(schema.communityActivity)
            .where(eq(schema.communityActivity.username, me.username));
          if (registeredUser) {
            await tx
              .delete(schema.userSettings)
              .where(eq(schema.userSettings.userId, registeredUser.id));
          }
        });
        ack({ ok: true });
      } catch (error) {
        console.error("[tabcom] clear-history failed:", error);
        ack({ ok: false, reason: "server_error" });
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

  socket.on(
    "community_create",
    ({ name }: { name: string }, ack?: (response: { communityId: string }) => void) => {
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
      logActivity(community.id, community.name, me.username, "community_created");
      notify(me.username, "community_update", {
        community: serializeCommunity(community, me.username),
      });
      // Lets the client immediately follow up with community_set_image
      // for the "add a logo while creating" flow, without waiting on
      // (and having to correlate itself against) the broadcast above.
      ack?.({ communityId: community.id });
    }
  );

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
        logActivity(community.id, community.name, me.username, "joined");
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
    logActivity(community.id, community.name, me.username, "left");

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
      logActivity(community.id, community.name, username, "left");

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

  // Routed through the socket rather than a REST endpoint on purpose:
  // REST auth here would need a session token, which guests (a
  // legitimate kind of community admin in this app) don't have —
  // sockets already resolve identity uniformly for both. maxHttpBufferSize
  // is raised (see the Server(...) config below) so a base64-encoded
  // ~2MB image comfortably fits under socket.io's per-message cap.
  socket.on(
    "community_set_image",
    ({
      communityId,
      mimeType,
      data,
    }: {
      communityId: string;
      mimeType: string;
      data: string; // base64
    }) => {
      const me = users.get(socket.id);
      const community = communities.get(communityId);
      if (!me || !community) return;
      if (community.admin !== me.username) return; // admin only

      const allowedMimeTypes = ["image/png", "image/jpeg", "image/webp"];
      if (!allowedMimeTypes.includes(mimeType)) return;

      // Reject oversized uploads before writing anything — base64 is
      // ~4/3 the size of the original bytes, so 2MB of actual image
      // data is roughly 2.7M base64 characters.
      const MAX_BASE64_LENGTH = 2_800_000;
      if (typeof data !== "string" || data.length === 0 || data.length > MAX_BASE64_LENGTH) {
        notify(me.username, "community_image_error", {
          communityId,
          reason: "too_large",
        });
        return;
      }

      db.insert(schema.communityImages)
        .values({ communityId, mimeType, data, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: schema.communityImages.communityId,
          set: { mimeType, data, updatedAt: new Date() },
        })
        .then(() => {
          community.imageVersion = (community.imageVersion ?? 0) + 1;
          for (const member of community.members) {
            notify(member, "community_update", {
              community: serializeCommunity(community, member),
            });
          }
        })
        .catch((error) => {
          console.error("[tabcom] community image save failed:", error);
          notify(me.username, "community_image_error", {
            communityId,
            reason: "server_error",
          });
        });
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
    (
      {
        communityId,
        message,
      }: {
        communityId: string;
        message: WireMessage;
      },
      ack?: (result: { delivered: boolean }) => void
    ) => {
      const from = users.get(socket.id);
      const community = communities.get(communityId);
      if (!from || !community || !message) {
        ack?.({ delivered: false });
        return;
      }
      if (from.visibility === "private") {
        socket.emit("dm_error", { to: communityId, reason: "sender_private" });
        ack?.({ delivered: false });
        return;
      }
      if (!community.members.has(from.username)) {
        ack?.({ delivered: false });
        return;
      }

      // Relay to every ONLINE member except the sender. Zero retention.
      let reached = 0;
      for (const member of community.members) {
        if (member === from.username) continue;
        for (const id of publicSocketIdsFor(member)) {
          io.to(id).emit("community_message", { communityId, from, message });
          reached += 1;
        }
      }
      // "Delivered" for a community = relayed to at least one live
      // member socket. An empty room still counts the SEND as accepted
      // by the relay, so we report delivered:true when membership is
      // valid — the message reached everyone currently reachable.
      void reached;
      ack?.({ delivered: true });
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
      logActivity(community.id, community.name, me.username, "tab_added", title);

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
      logActivity(community.id, community.name, me.username, "tab_removed", item.title);

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
    "board_pin_comment",
    ({
      communityId,
      itemId,
      pinId,
      text,
    }: {
      communityId: string;
      itemId: string;
      pinId: string;
      text: string;
    }) => {
      const me = users.get(socket.id);
      const community = communities.get(communityId);
      if (!me || !community || !text?.trim()) return;
      if (!community.members.has(me.username)) return;

      const item = community.board.get(itemId);
      const pin = item?.pins.find((p) => p.id === pinId);
      if (!pin) return;

      pin.comments.push({
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
    "board_highlight_comment",
    ({
      communityId,
      itemId,
      highlightId,
      text,
    }: {
      communityId: string;
      itemId: string;
      highlightId: string;
      text: string;
    }) => {
      const me = users.get(socket.id);
      const community = communities.get(communityId);
      if (!me || !community || !text?.trim()) return;
      if (!community.members.has(me.username)) return;

      const item = community.board.get(itemId);
      const highlight = item?.highlights.find((h) => h.id === highlightId);
      if (!highlight) return;

      highlight.comments.push({
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
      pageX?: number;
      pageY?: number;
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
        comments: [],
        xPercent: Math.max(0, Math.min(100, Number(input.xPercent) || 0)),
        yPercent: Math.max(0, Math.min(100, Number(input.yPercent) || 0)),
        pageX: input.pageX != null ? Math.max(0, Number(input.pageX) || 0) : undefined,
        pageY: input.pageY != null ? Math.max(0, Number(input.pageY) || 0) : undefined,
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
      // detail is the PAGE title, never the pin's own text — see the
      // schema comment on communityActivity for why that line matters.
      logActivity(community.id, community.name, me.username, "pin_added", item.title);

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
      logActivity(community.id, community.name, me.username, "pin_removed", item.title);

      for (const member of community.members) {
        notify(member, "community_update", {
          community: serializeCommunity(community, member),
        });
      }
    }
  );

  socket.on(
    "board_area_add",
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
      widthPercent: number;
      heightPercent: number;
      pageX?: number;
      pageY?: number;
      pageWidth?: number;
      pageHeight?: number;
      anchorSelector?: string;
      elXPercent?: number;
      elYPercent?: number;
    }) => {
      const me = users.get(socket.id);
      const community = communities.get(input?.communityId);
      if (!me || !community || !input?.canonicalKey || !input?.text?.trim()) return;
      if (!community.members.has(me.username)) return;

      const item = ensureBoardItem(community, me, input);

      item.areas.push({
        id: crypto.randomUUID(),
        author: me.username,
        sentAt: Date.now(),
        text: String(input.text).trim().slice(0, 300),
        xPercent: Math.max(0, Math.min(100, Number(input.xPercent) || 0)),
        yPercent: Math.max(0, Math.min(100, Number(input.yPercent) || 0)),
        widthPercent: Math.max(0.5, Math.min(100, Number(input.widthPercent) || 0.5)),
        heightPercent: Math.max(0.5, Math.min(100, Number(input.heightPercent) || 0.5)),
        pageX: input.pageX != null ? Math.max(0, Number(input.pageX) || 0) : undefined,
        pageY: input.pageY != null ? Math.max(0, Number(input.pageY) || 0) : undefined,
        pageWidth:
          input.pageWidth != null ? Math.max(1, Number(input.pageWidth) || 1) : undefined,
        pageHeight:
          input.pageHeight != null ? Math.max(1, Number(input.pageHeight) || 1) : undefined,
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
        comments: [],
      });
      logActivity(community.id, community.name, me.username, "area_added", item.title);

      for (const member of community.members) {
        notify(member, "community_update", {
          community: serializeCommunity(community, member),
        });
      }
    }
  );

  socket.on(
    "board_area_remove",
    ({
      communityId,
      itemId,
      areaId,
    }: {
      communityId: string;
      itemId: string;
      areaId: string;
    }) => {
      const me = users.get(socket.id);
      const community = communities.get(communityId);
      const item = community?.board.get(itemId);
      if (!me || !community || !item) return;

      const area = item.areas.find((a) => a.id === areaId);
      if (!area) return;
      if (community.admin !== me.username && area.author !== me.username) return;

      item.areas = item.areas.filter((a) => a.id !== areaId);
      logActivity(community.id, community.name, me.username, "area_removed", item.title);

      for (const member of community.members) {
        notify(member, "community_update", {
          community: serializeCommunity(community, member),
        });
      }
    }
  );

  socket.on(
    "board_area_comment",
    ({
      communityId,
      itemId,
      areaId,
      text,
    }: {
      communityId: string;
      itemId: string;
      areaId: string;
      text: string;
    }) => {
      const me = users.get(socket.id);
      const community = communities.get(communityId);
      if (!me || !community || !text?.trim()) return;
      if (!community.members.has(me.username)) return;

      const item = community.board.get(itemId);
      const area = item?.areas.find((a) => a.id === areaId);
      if (!area) return;

      area.comments.push({
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
        comments: input.comment?.trim()
          ? [
              {
                id: crypto.randomUUID(),
                author: me.username,
                text: String(input.comment).trim().slice(0, 300),
                sentAt: Date.now(),
              },
            ]
          : [],
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
      pageX,
      pageY,
      anchorSelector,
      elXPercent,
      elYPercent,
    }: {
      communityId: string;
      canonicalKey: string;
      xPercent: number;
      yPercent: number;
      /** Absolute document pixels — receiver-side fallback when the
       *  element anchor doesn't resolve; immune to page-height drift
       *  between peers (infinite scroll), unlike the percents. */
      pageX?: number;
      pageY?: number;
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
          pageX: pageX != null ? Math.max(0, Number(pageX) || 0) : undefined,
          pageY: pageY != null ? Math.max(0, Number(pageY) || 0) : undefined,
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

  // ---- Ephemeral quick annotations (speech-bubble notes) -----------------
  //
  // Same relay-only, zero-retention model as cursors: this exists only in
  // flight, matched by canonicalKey client-side, never touches the
  // `communities` map or its snapshot. Distinct from board pins/areas,
  // which ARE persisted — see board_pin_add below for those. The 50-char
  // cap is enforced here too, not just client-side, since the client is
  // never trusted for limits that matter.
  socket.on(
    "annotation_ephemeral",
    ({
      communityId,
      canonicalKey,
      text,
      xPercent,
      yPercent,
      pageX,
      pageY,
      anchorSelector,
      elXPercent,
      elYPercent,
    }: {
      communityId: string;
      canonicalKey: string;
      text: string;
      xPercent: number;
      yPercent: number;
      /** Absolute document pixels — see cursor_move for why. */
      pageX?: number;
      pageY?: number;
      anchorSelector?: string;
      elXPercent?: number;
      elYPercent?: number;
    }) => {
      const me = users.get(socket.id);
      const community = communities.get(communityId);
      if (!me || !community || !canonicalKey) return;
      if (!community.members.has(me.username)) return;

      const trimmed = String(text ?? "").trim().slice(0, 50);
      if (!trimmed) return;

      for (const member of community.members) {
        if (member === me.username) continue;
        notify(member, "annotation_peer", {
          communityId,
          canonicalKey,
          id: crypto.randomUUID(),
          from: { username: me.username, name: me.name, color: me.color },
          text: trimmed,
          xPercent: Math.max(0, Math.min(100, Number(xPercent) || 0)),
          yPercent: Math.max(0, Math.min(100, Number(yPercent) || 0)),
          pageX: pageX != null ? Math.max(0, Number(pageX) || 0) : undefined,
          pageY: pageY != null ? Math.max(0, Number(pageY) || 0) : undefined,
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

  // ---- Messaging (public + accepted only) ------------------------------

  socket.on(
    "dm",
    (
      { to, message }: { to: string; message: WireMessage },
      ack?: (result: { delivered: boolean }) => void
    ) => {
      const from = users.get(socket.id);
      if (!from || !to || !message) return;

      if (from.visibility === "private") {
        socket.emit("dm_error", { to, reason: "sender_private" });
        ack?.({ delivered: false });
        return;
      }

      // Consent gate: connection must be accepted and unblocked.
      const pair = pairs.get(pairKey(from.username, to));
      if (
        pair?.status !== "accepted" ||
        isBlockedEitherWay(from.username, to)
      ) {
        socket.emit("dm_error", { to, reason: "not_connected" });
        ack?.({ delivered: false });
        return;
      }

      const targets = publicSocketIdsFor(to);
      if (targets.length === 0) {
        socket.emit("dm_error", { to, reason: "recipient_unavailable" });
        ack?.({ delivered: false });
        return;
      }

      for (const id of targets) {
        io.to(id).emit("dm", { from, message });
      }
      // Delivered = handed to at least one of the recipient's live
      // sockets. Nothing is stored — this is a relay receipt, not a
      // persistence receipt.
      ack?.({ delivered: true });

      // Appear-offline contract: the message still flows, but the
      // sender is told the recipient is offline so they know to wait —
      // and (see "dm_read") they will only ever see Sent, never
      // Delivered/Read, while the recipient stays hidden.
      if (effectivePresenceOf(to) === "offline") {
        socket.emit("dm_notice", { to, reason: "recipient_offline" });
      }
    }
  );

  // ---- Call signaling (WebRTC offer/answer/ICE relay) --------------------
  //
  // The server ONLY relays session negotiation between two accepted,
  // unblocked contacts — the same consent gate as "dm" above. Audio/
  // video itself flows peer-to-peer over WebRTC (DTLS-SRTP encrypted
  // end-to-end by the browser); no media ever touches this server, and
  // nothing here is stored. `busy` / `reject` / `end` reuse the same
  // channel so call state changes are just more signals.
  socket.on(
    "call_signal",
    ({ to, signal }: { to: string; signal: { kind: string; [key: string]: unknown } }) => {
      const from = users.get(socket.id);
      if (!from || !to || !signal?.kind) return;
      if (from.visibility === "private") return;

      const pair = pairs.get(pairKey(from.username, to));
      if (pair?.status !== "accepted" || isBlockedEitherWay(from.username, to)) {
        socket.emit("call_error", { to, reason: "not_connected" });
        return;
      }

      const targets = publicSocketIdsFor(to);
      if (targets.length === 0) {
        socket.emit("call_error", { to, reason: "recipient_unavailable" });
        return;
      }

      // Appear-offline contract, both directions — gate new calls
      // (offers) only; answer/ICE/end/busy for an ALREADY-RUNNING call
      // must always flow or teardown breaks.
      if (signal.kind === "offer") {
        if ((from.presence ?? "online") === "offline") {
          socket.emit("call_error", { to, reason: "caller_offline" });
          return;
        }
        if (effectivePresenceOf(to) === "offline") {
          socket.emit("call_error", { to, reason: "recipient_offline" });
          return;
        }
      }

      for (const id of targets) {
        io.to(id).emit("call_signal", {
          from: { username: from.username, name: from.name, color: from.color },
          signal,
        });
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
      // Appear-offline contract: reading while hidden must not leak a
      // Read receipt — the sender only ever sees Sent. Receipts are
      // dropped (not deferred): surfacing them later would retroactively
      // reveal when the "offline" user was actually reading.
      if ((from.presence ?? "online") === "offline") return;

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
    guestInstanceIds.delete(socket.id);
    if (user) broadcastRoster();
  });
});

const PORT = Number(process.env.PORT ?? 3001);

function lanAddresses(): string[] {
  const addresses: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.push(entry.address);
    }
  }
  return addresses;
}

httpServer.listen(PORT, () => {
  console.log(`[tabcom] realtime server listening on http://localhost:${PORT}`);
  // The line above is only reachable from THIS machine — "localhost"
  // never means anything else to any other device. This one is what
  // another device on the same network (or a .local hostname pointing
  // at this machine) actually needs, and it's easy to mistake the line
  // above for "the server only listens on localhost" when debugging
  // LAN/cross-device connectivity, since listen(PORT) with no host
  // argument actually binds every interface, not just loopback.
  for (const address of lanAddresses()) {
    console.log(`[tabcom] also reachable on your network at http://${address}:${PORT}`);
  }
  console.log(
    "[tabcom] privacy: zero message retention, server-enforced visibility, consent before contact"
  );
});