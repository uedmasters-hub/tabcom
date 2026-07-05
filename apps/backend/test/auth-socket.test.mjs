/**
 * Proves the core security property end-to-end: an authenticated
 * socket connection cannot be used to impersonate a different
 * username than the one the account actually owns — even if the
 * client's "hello" payload claims otherwise. Own process/server
 * (needs a real database), run: pnpm test:auth
 */
import "dotenv/config"; // load apps/backend/.env before anything else
import { spawn } from "node:child_process";
import { io } from "socket.io-client";

const PORT = 8410;
const URL = `http://localhost:${PORT}`;
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:devpass@localhost:5432/tabcom_dev";

const passed = [];
const fail = (msg) => {
  console.error("✗ FAIL:", msg);
  server.kill();
  process.exit(1);
};
const pass = (msg) => {
  passed.push(msg);
  console.log("✓", msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn("pnpm", ["exec", "tsx", "src/index.ts"], {
  env: {
    ...process.env,
    PORT: String(PORT),
    DATABASE_URL,
    TABCOM_EPHEMERAL: "1",
    // Override whatever the developer's own .env has — this test's
    // server runs on its own dynamic port, and magic links MUST point
    // back at that exact port, not whatever the real dev server uses.
    PUBLIC_BASE_URL: `http://localhost:${PORT}`,
  },
  stdio: "pipe",
});

await new Promise((resolve) => {
  server.stdout.on("data", (chunk) => {
    if (String(chunk).includes("listening")) resolve();
  });
});

// ---- Real magic-link flow over real HTTP, against the real running server ----
async function requestLink(email) {
  const res = await fetch(`${URL}/auth/request-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return res.json();
}

async function poll(pollId) {
  const res = await fetch(`${URL}/auth/poll?pollId=${encodeURIComponent(pollId)}`);
  return res.json();
}

async function claimUsername(sessionToken, username, displayName) {
  const res = await fetch(`${URL}/auth/claim-username`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionToken, username, displayName, avatarColor: "#2563EB" }),
  });
  return { status: res.status, body: await res.json() };
}

// Capture the magic link the server logs (dev mode, no RESEND_API_KEY).
let capturedLink = null;
server.stdout.on("data", (chunk) => {
  const line = chunk.toString();
  const m = line.match(/(http:\/\/localhost:\d+\/auth\/verify\?token=\S+)/);
  if (m) capturedLink = m[1];
});

const req = await requestLink("socktest@example.com");
if (!req.ok) fail("request-link failed: " + JSON.stringify(req));
await sleep(400);
if (!capturedLink) fail("did not capture the dev-mode magic link from server logs");

const verifyRes = await fetch(capturedLink);
if (verifyRes.status !== 200) fail("verify endpoint did not return 200");
pass("full HTTP flow: request-link -> verify, against the real running server");

const polled = await poll(req.pollId);
if (polled.status !== "verified" || !polled.sessionToken) fail("poll did not return a verified session");
pass("poll returns a real session token after verification");

const sessionToken = polled.sessionToken;
const claim = await claimUsername(sessionToken, "sockuser", "Sock User");
if (!claim.body.ok) fail("claim-username failed: " + JSON.stringify(claim.body));
pass("username claimed via the real HTTP endpoint");

// ---- THE actual security test: connect with this session, try to lie in "hello" ----
const authedSocket = io(URL, { auth: { sessionToken } });
await new Promise((resolve) => authedSocket.on("connect", resolve));

const rosterSeen = new Promise((resolve) => authedSocket.once("communities", resolve));
authedSocket.emit("hello", {
  username: "someone-else-entirely", // the lie
  name: "Impersonator",
  color: "#000000",
  visibility: "public",
  presence: "online",
});
await rosterSeen;

// Ask a second, unauthenticated observer to see the public roster and
// confirm which username actually showed up.
const observer = io(URL);
await new Promise((resolve) => observer.on("connect", resolve));
const rosterPromise = new Promise((resolve) => observer.once("roster", resolve));
observer.emit("hello", { username: "observer", name: "Observer", color: "#111", visibility: "public", presence: "online" });
const roster = await rosterPromise;

const entry = roster.find((u) => u.username === "sockuser" || u.username === "someone-else-entirely");
if (!entry) fail("authenticated user never appeared in the roster at all");
if (entry.username === "someone-else-entirely") {
  fail("IMPERSONATION SUCCEEDED — authenticated socket claimed a different username than its account owns");
}
if (entry.username !== "sockuser") fail("unexpected username in roster: " + entry.username);
pass("authenticated socket CANNOT impersonate another username — server enforces the real account identity");

console.log(`\nALL AUTH SOCKET TESTS PASSED (${passed.length}/4)`);
authedSocket.disconnect();
observer.disconnect();
server.kill();
process.exit(0);
