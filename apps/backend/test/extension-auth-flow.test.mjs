/**
 * Simulates the EXTENSION's own client code (lib/auth-client.ts) end
 * to end against a real running server + real database — not just
 * the server's own test of itself. Run: pnpm test:extension-auth
 */
import "dotenv/config"; // load apps/backend/.env before anything else
import { spawn } from "node:child_process";

const PORT = 9366;
const URL = `http://localhost:${PORT}`;

// Unique per run — this suite runs against a real, persistent database
// (not a disposable local one), so reusing the same email/username
// every time would mean testing against an account that already has
// state from a PRIOR run rather than the fresh-account scenario this
// test claims to verify.
const runId = Date.now().toString().slice(-8);

const server = spawn("pnpm", ["exec", "tsx", "src/index.ts"], {
  env: {
    ...process.env,
    PORT: String(PORT),
    TABCOM_EPHEMERAL: "1",
    DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://postgres:devpass@localhost:5432/tabcom_dev",
    // Same reasoning as auth-socket.test.mjs — never let the real .env's
    // PUBLIC_BASE_URL leak into this test's dynamically-ported server.
    PUBLIC_BASE_URL: `http://localhost:${PORT}`,
  },
  stdio: "pipe",
});

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

let capturedLink = null;
server.stdout.on("data", (chunk) => {
  process.stdout.write(`[server] ${chunk}`);
  const m = chunk.toString().match(/(http:\/\/localhost:\d+\/auth\/verify\?token=\S+)/);
  if (m) capturedLink = m[1];
});
server.stderr.on("data", (chunk) => {
  process.stderr.write(`[server:err] ${chunk}`);
});

await new Promise((resolve) => {
  server.stdout.on("data", (chunk) => {
    if (String(chunk).includes("listening")) resolve();
  });
});

// ---- Exact re-implementation of lib/auth-client.ts's functions, calling the REAL running server ----
async function requestMagicLink(email) {
  const res = await fetch(`${URL}/auth/request-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return res.json();
}
async function pollLoginRequest(pollId) {
  const res = await fetch(`${URL}/auth/poll?pollId=${encodeURIComponent(pollId)}`);
  return res.json();
}
async function claimUsername(sessionToken, username, displayName, avatarColor) {
  const res = await fetch(`${URL}/auth/claim-username`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionToken, username, displayName, avatarColor }),
  });
  return res.json();
}

// ---- Simulate exactly what SignInScreen.tsx does ----
const req = await requestMagicLink(`extuser+${runId}@example.com`);
if (!req.ok || !req.pollId) fail("request-link failed: " + JSON.stringify(req));
pass("extension: request-link succeeds and returns a pollId");

// Simulate waitForLogin() polling before the link is clicked
const early = await pollLoginRequest(req.pollId);
if (early.status !== "waiting") fail("expected 'waiting' before the link is clicked");
pass("extension: poll correctly reports 'waiting' before verification");

// Simulate the person clicking the link in their email client
await new Promise((r) => setTimeout(r, 300));
if (!capturedLink) fail("did not capture the dev-mode magic link");
const verifyRes = await fetch(capturedLink);
if (verifyRes.status !== 200) fail("verify link did not return 200");

// Simulate waitForLogin()'s next poll picking up the session
const verified = await pollLoginRequest(req.pollId);
if (verified.status !== "verified" || !verified.sessionToken) {
  fail("poll did not return a verified session after the link was clicked");
}
if (verified.user.username !== null) fail("brand-new account should have no username yet");
pass("extension: poll picks up the session immediately after the link is clicked, username is null (routes to Setup)");

// Simulate SetupScreen.tsx submitting the claim
const claimed = await claimUsername(verified.sessionToken, `extuser${runId}`, "Ext User", "#2563EB");
if (!claimed.ok) fail("claim-username failed: " + JSON.stringify(claimed));
pass("extension: SetupScreen's claim-username call succeeds for a fresh username");

// Simulate a second person signing in — a genuinely separate account
capturedLink = null;
const req2 = await requestMagicLink(`seconduser+${runId}@example.com`);
if (!req2.ok) fail("second user's request-link failed");
await new Promise((r) => setTimeout(r, 300));
if (!capturedLink) fail("did not capture the second user's magic link");

await fetch(capturedLink);
const verified2 = await pollLoginRequest(req2.pollId);
if (verified2.status !== "verified") fail("second user's poll did not verify");
if (verified2.user.id === verified.user.id) fail("second user resolved to the SAME account as the first — broken");
pass("extension: a second person signing in gets a genuinely distinct account");

console.log(`\nALL EXTENSION AUTH FLOW TESTS PASSED (${passed.length}/5)`);
server.kill();
process.exit(0);
