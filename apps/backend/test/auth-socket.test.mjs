/**
 * Proves the core security property end-to-end: an authenticated
 * socket connection cannot be used to impersonate a different
 * username than the one the account actually owns — even if the
 * client's "hello" payload claims otherwise. Own process/server
 * (needs a real database), run: pnpm test:auth
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import { io } from "socket.io-client";

const PORT = 8410;
const URL = `http://localhost:${PORT}`;
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:devpass@localhost:5432/tabcom_dev";
const MASTER_INVITE = "TAB-MASTER-TEST-CODE";
const runId = Date.now().toString().slice(-8);

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
    PUBLIC_BASE_URL: `http://localhost:${PORT}`,
    TABCOM_MASTER_INVITE: MASTER_INVITE,
    RESEND_API_KEY: "",
  },
  stdio: "pipe",
});

await new Promise((resolve) => {
  server.stdout.on("data", (chunk) => {
    if (String(chunk).includes("listening")) resolve();
  });
});

async function register(email, username, displayName) {
  const res = await fetch(`${URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      username,
      displayName,
      avatarColor: "#2563EB",
      inviteCode: MASTER_INVITE,
    }),
  });
  return res.json();
}

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

// Capture the magic link the server logs (dev mode, no RESEND_API_KEY).
let capturedLink = null;
server.stdout.on("data", (chunk) => {
  const line = chunk.toString();
  const m = line.match(/(http:\/\/localhost:\d+\/auth\/verify\?token=\S+)/);
  if (m) capturedLink = m[1];
});

const email = `socktest+${runId}@example.com`;
const username = `sockuser${runId}`;
const reg = await register(email, username, "Sock User");
if (!reg.ok) fail("register failed: " + JSON.stringify(reg));
pass("register creates a usable account before magic-link sign-in");

const req = await requestLink(email);
if (!req.ok) fail("request-link failed: " + JSON.stringify(req));
await sleep(400);
if (!capturedLink) fail("did not capture the dev-mode magic link from server logs");

const verifyRes = await fetch(capturedLink);
if (verifyRes.status !== 200) fail("verify endpoint did not return 200");
pass("full HTTP flow: request-link -> verify, against the real running server");

const polled = await poll(req.pollId);
if (polled.status !== "verified" || !polled.sessionToken) fail("poll did not return a verified session");
if (polled.user.username !== username) fail("session user missing registered username");
pass("poll returns a real session token after verification");

const sessionToken = polled.sessionToken;

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

const observer = io(URL);
await new Promise((resolve) => observer.on("connect", resolve));
const rosterPromise = new Promise((resolve) => observer.once("roster", resolve));
observer.emit("hello", { username: "observer", name: "Observer", color: "#111", visibility: "public", presence: "online" });
const roster = await rosterPromise;

const names = roster.map((u) => u.username);
if (!names.includes(username)) fail("authenticated username missing from roster: " + names.join(","));
if (names.includes("someone-else-entirely")) fail("impersonation succeeded — lie appeared on roster");
pass("authenticated socket cannot impersonate a different username");

console.log(`\nALL AUTH SOCKET TESTS PASSED (${passed.length}/${passed.length})`);
authedSocket.close();
observer.close();
server.kill();
process.exit(0);
