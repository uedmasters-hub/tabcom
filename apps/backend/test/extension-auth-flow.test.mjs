/**
 * Simulates the EXTENSION's auth client end-to-end against a real
 * running server. Sign-in is for fully registered accounts only —
 * unregistered emails are waitlisted, never auto-created.
 * Run: pnpm test:extension-auth
 */
import "dotenv/config";
import { spawn } from "node:child_process";

const PORT = 9366;
const URL = `http://localhost:${PORT}`;
const MASTER_INVITE = "TAB-MASTER-TEST-CODE";
const runId = Date.now().toString().slice(-8);

const server = spawn("pnpm", ["exec", "tsx", "src/index.ts"], {
  env: {
    ...process.env,
    PORT: String(PORT),
    TABCOM_EPHEMERAL: "1",
    DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://postgres:devpass@localhost:5432/tabcom_dev",
    PUBLIC_BASE_URL: `http://localhost:${PORT}`,
    TABCOM_MASTER_INVITE: MASTER_INVITE,
    RESEND_API_KEY: "",
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

// ---- Unregistered email: no magic link, invite request recorded ----
const unknown = await requestMagicLink(`nobody+${runId}@example.com`);
if (unknown.ok || unknown.reason !== "not_registered") {
  fail("unregistered email should return not_registered: " + JSON.stringify(unknown));
}
if (unknown.pollId) fail("unregistered response must not include pollId");
pass("extension: unregistered email is rejected (not_registered) — no ghost account");

const checkRes = await fetch(
  `${URL}/auth/check-email?email=${encodeURIComponent(`nobody+${runId}@example.com`)}`
);
const checkBody = await checkRes.json();
if (!checkBody.ok || checkBody.eligible !== false || checkBody.reason !== "not_registered") {
  fail("check-email should report ineligible: " + JSON.stringify(checkBody));
}
pass("extension: check-email preflight blocks unregistered addresses");

// ---- Register, then magic-link sign-in ----
const email = `extuser+${runId}@example.com`;
const username = `extuser${runId}`;
const reg = await register(email, username, "Ext User");
if (!reg.ok) fail("register failed: " + JSON.stringify(reg));
pass("extension: register creates a fully formed account");

const req = await requestMagicLink(email);
if (!req.ok || !req.pollId) fail("request-link failed: " + JSON.stringify(req));
pass("extension: request-link succeeds for a registered account");

const early = await pollLoginRequest(req.pollId);
if (early.status !== "waiting") fail("expected 'waiting' before the link is clicked");
pass("extension: poll correctly reports 'waiting' before verification");

await new Promise((r) => setTimeout(r, 300));
if (!capturedLink) fail("did not capture the dev-mode magic link");
const verifyRes = await fetch(capturedLink);
if (verifyRes.status !== 200) fail("verify link did not return 200");

const verified = await pollLoginRequest(req.pollId);
if (verified.status !== "verified" || !verified.sessionToken) {
  fail("poll did not return a verified session after the link was clicked");
}
if (verified.user.username !== username) {
  fail("verified session must carry the registered username, got: " + verified.user.username);
}
pass("extension: poll picks up a fully registered session after the link is clicked");

// ---- Second registered person ----
capturedLink = null;
const email2 = `seconduser+${runId}@example.com`;
const username2 = `second${runId}`;
const reg2 = await register(email2, username2, "Second User");
if (!reg2.ok) fail("second register failed: " + JSON.stringify(reg2));

const req2 = await requestMagicLink(email2);
if (!req2.ok) fail("second user's request-link failed");
await new Promise((r) => setTimeout(r, 300));
if (!capturedLink) fail("did not capture the second user's magic link");

await fetch(capturedLink);
const verified2 = await pollLoginRequest(req2.pollId);
if (verified2.status !== "verified") fail("second user's poll did not verify");
if (verified2.user.id === verified.user.id) fail("second user resolved to the SAME account as the first — broken");
pass("extension: a second person signing in gets a genuinely distinct account");

console.log(`\nALL EXTENSION AUTH FLOW TESTS PASSED (${passed.length}/${passed.length})`);
server.kill();
process.exit(0);
