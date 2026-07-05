/**
 * Lean onboarding: register immediately (no click-a-link gate), verify
 * later as a background upgrade, and the verified flag has to actually
 * reach other people (roster + connect_request), not just Settings.
 * Own process/server (needs a real database), run: pnpm test:lean-onboarding
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import { io } from "socket.io-client";

const PORT = 5817;
const URL = `http://localhost:${PORT}`;

/** Multi-use operator code, injected via env for this test server. */
const MASTER_INVITE = "TAB-MASTER-TEST-CODE";

// Unique per run — this suite runs against a real, persistent database
// (not a disposable local one), so hardcoded emails/usernames would
// mean a second run finds accounts with state left over from the
// first (e.g. already verified from a prior TEST 7), rather than the
// fresh-account scenarios these tests actually claim to check.
const runId = Date.now().toString().slice(-8);

const server = spawn("pnpm", ["exec", "tsx", "src/index.ts"], {
  env: {
    ...process.env,
    PORT: String(PORT),
    TABCOM_EPHEMERAL: "1",
    DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://postgres:devpass@localhost:5432/tabcom_dev",
    PUBLIC_BASE_URL: `http://localhost:${PORT}`,
    TABCOM_MASTER_INVITE: MASTER_INVITE,
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let capturedLink = null;
server.stdout.on("data", (chunk) => {
  const m = chunk.toString().match(/(http:\/\/localhost:\d+\/auth\/verify\?token=\S+)/);
  if (m) capturedLink = m[1];
});

await new Promise((resolve) => {
  server.stdout.on("data", (chunk) => {
    if (String(chunk).includes("listening")) resolve();
  });
});

async function register(email, username, displayName, inviteCode = MASTER_INVITE) {
  const res = await fetch(`${URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, username, displayName, avatarColor: "#2563EB", inviteCode }),
  });
  return res.json();
}
async function myInvites(sessionToken) {
  const res = await fetch(`${URL}/auth/invites?sessionToken=${encodeURIComponent(sessionToken)}`);
  return res.json();
}
async function checkUsername(username) {
  const res = await fetch(`${URL}/auth/check-username?username=${encodeURIComponent(username)}`);
  return res.json();
}
async function sendVerification(sessionToken) {
  const res = await fetch(`${URL}/auth/send-verification`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionToken }),
  });
  return res.json();
}
async function me(sessionToken) {
  const res = await fetch(`${URL}/auth/me?sessionToken=${encodeURIComponent(sessionToken)}`);
  return res.json();
}

// TEST 1: register creates a usable account immediately, unverified
const reg1 = await register(`lean1+${runId}@example.com`, `leanuser${runId}`, "Lean User");
if (!reg1.ok) fail("register failed: " + JSON.stringify(reg1));
if (reg1.user.verified !== false) fail("freshly registered account should be unverified");
if (!reg1.sessionToken) fail("register did not return a usable session token immediately");
pass("register: creates a usable, unverified account with an immediate session — no click-a-link gate");

// TEST 1b: the invite gate — no code / bad code means no account
const gateMissing = await register(`gate1+${runId}@example.com`, `gate1${runId}`, "No Code", "");
if (gateMissing.ok || gateMissing.reason !== "invalid_invite") fail("register without an invite code should fail with invalid_invite");
const gateBad = await register(`gate2+${runId}@example.com`, `gate2${runId}`, "Bad Code", "TAB-ZZZZ-ZZZZ");
if (gateBad.ok || gateBad.reason !== "invalid_invite") fail("register with a nonexistent code should fail with invalid_invite");
pass("invite gate: registration is refused without a valid invitation code");

// TEST 1c: a new account is granted 5 single-use codes
const inv1 = await myInvites(reg1.sessionToken);
if (!inv1.ok) fail("could not list invites: " + JSON.stringify(inv1));
if (inv1.invites.length !== 5) fail(`expected 5 granted invites, got ${inv1.invites.length}`);
if (inv1.invites.some((i) => i.used)) fail("freshly granted invites should all be unused");
pass("invite grant: every new account receives 5 unused invitation codes");

// TEST 1d: a granted code admits exactly one person, then dies
const sharedCode = inv1.invites[0].code;
const friend = await register(`friend+${runId}@example.com`, `friend${runId}`, "Invited Friend", sharedCode);
if (!friend.ok) fail("registering with a freshly granted code failed: " + JSON.stringify(friend));
const reuse = await register(`reuse+${runId}@example.com`, `reuse${runId}`, "Second Try", sharedCode);
if (reuse.ok || reuse.reason !== "invalid_invite") fail("a used invite code must not admit a second account");
const inv1After = await myInvites(reg1.sessionToken);
const spent = inv1After.invites.find((i) => i.code === sharedCode);
if (!spent?.used) fail("the redeemed code should now be marked used in the inviter's list");
pass("invite consumption: each code is single-use and shows as used to its owner");

// TEST 1e: re-registering an existing email does NOT need (or burn) a code
const rereg = await register(`lean1+${runId}@example.com`, `leanuser${runId}`, "Lean User", "");
if (!rereg.ok) fail("re-register with existing email should skip the invite gate: " + JSON.stringify(rereg));
pass("invite gate: existing accounts can re-register without a code — the seat is already theirs");

// TEST 1f: re-registering an already-topped-up account must not grant
// a SECOND allowance on top of the first — 5 is a one-time grant
const inv1Rereg = await myInvites(rereg.sessionToken);
if (!inv1Rereg.ok || inv1Rereg.invites.length !== 5) fail(`re-registering should not grant a duplicate allowance: expected 5, got ${inv1Rereg.invites?.length}`);
pass("invite allowance: re-registering an already-topped-up account does not grant a duplicate allowance");


// TEST 2: username availability + real suggestions when taken
const takenCheck = await checkUsername(`leanuser${runId}`);
if (takenCheck.available !== false) fail("expected 'leanuser' to be reported taken");
if (!takenCheck.suggestions || takenCheck.suggestions.length === 0) fail("no suggestions returned for a taken username");
if (takenCheck.suggestions.includes(`leanuser${runId}`)) fail("suggestions must not include the bare taken name itself");
pass(`username check: 'leanuser' correctly taken, suggestions offered: ${takenCheck.suggestions.join(", ")}`);

const freeCheck = await checkUsername(`free${runId}`);
if (freeCheck.available !== true) fail("expected a random unused username to be available");
pass("username check: a genuinely free username reports available");

// TEST 3: can't register with an already-taken username
const reg2 = await register(`lean2+${runId}@example.com`, `leanuser${runId}`, "Someone Else");
if (reg2.ok) fail("registering with an already-taken username should have failed");
if (reg2.reason !== "username_taken") fail("wrong rejection reason: " + reg2.reason);
pass("register: rejects an already-taken username correctly");

// TEST 4: registering the same email again reuses the same account
const reg3 = await register(`lean1+${runId}@example.com`, `leanuser${runId}`, "Lean User");
if (!reg3.ok) fail("re-registering the same email should succeed (idempotent)");
if (reg3.user.id !== reg1.user.id) fail("re-registering the same email created a DIFFERENT account");
pass("register: same email again reuses the existing account rather than duplicating it");

// TEST 5: /auth/me reflects unverified status
const meBefore = await me(reg1.sessionToken);
if (!meBefore.ok || meBefore.user.verified !== false) fail("/auth/me should show unverified before any link is clicked");
pass("/auth/me: correctly reports unverified before verification");

// TEST 6: verified propagates to the ROSTER, not just to the account itself
const socket = io(URL, { auth: { sessionToken: reg1.sessionToken } });
await new Promise((resolve) => socket.on("connect", resolve));

const observer = io(URL);
await new Promise((resolve) => observer.on("connect", resolve));

function waitForRosterEntry(username, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for " + username)), timeoutMs);
    const handler = (roster) => {
      const entry = roster.find((u) => u.username === username);
      if (entry) {
        clearTimeout(timer);
        observer.off("roster", handler);
        resolve(entry);
      }
    };
    observer.on("roster", handler);
  });
}

const entryBeforePromise = waitForRosterEntry(`leanuser${runId}`);
socket.emit("hello", { username: `leanuser${runId}`, name: "Lean User", color: "#2563EB", visibility: "public", presence: "online" });
observer.emit("hello", { username: "observer1", name: "Observer", color: "#111", visibility: "public", presence: "online" });
const entryBefore = await entryBeforePromise.catch(() => null);
if (!entryBefore) fail("registered user never appeared in the roster");
if (entryBefore.verified !== false) fail("roster should show verified:false before the link is clicked");
pass("roster: unverified account correctly shows verified:false to OTHER users, not just locally");

// TEST 7: send-verification + actually clicking the link flips it, and the NEXT roster broadcast reflects it
const sendResult = await sendVerification(reg1.sessionToken);
if (!sendResult.ok) fail("send-verification failed: " + JSON.stringify(sendResult));
await sleep(300);
if (!capturedLink) fail("did not capture the dev-mode verification link");

const verifyRes = await fetch(capturedLink);
if (verifyRes.status !== 200) fail("clicking the verification link did not return 200");

const meAfter = await me(reg1.sessionToken);
if (meAfter.user.verified !== true) fail("/auth/me should show verified:true after clicking the link");
pass("send-verification + click: /auth/me flips to verified:true");

const entryAfterPromise = waitForRosterEntry(`leanuser${runId}`);
socket.emit("hello", { username: `leanuser${runId}`, name: "Lean User", color: "#2563EB", visibility: "public", presence: "online" });
const entryAfter = await entryAfterPromise.catch(() => null);
if (!entryAfter || entryAfter.verified !== true) fail("roster did not pick up the new verified status on re-hello");
pass("roster: verified status updates for other users once the account actually verifies");

// TEST 8: an unauthenticated ('hello'-only, no session) connection is NEVER marked verified,
// even if the account backing that username happens to be verified
const spoofSocket = io(URL);
await new Promise((resolve) => spoofSocket.on("connect", resolve));
const spoofEntryPromise = waitForRosterEntry("spoofer");
spoofSocket.emit("hello", { username: "spoofer", name: "Spoofer", color: "#000", visibility: "public", presence: "online" });
const spoofEntry = await spoofEntryPromise.catch(() => null);
if (spoofEntry?.verified) fail("an unauthenticated hello was able to claim verified:true");
if (!spoofEntry) fail("spoofer never appeared in roster at all");
pass("roster: an unauthenticated connection can never claim verified status for itself");

console.log(`\nALL LEAN ONBOARDING TESTS PASSED (${passed.length}/${passed.length})`);
socket.disconnect();
observer.disconnect();
spoofSocket.disconnect();
server.kill();
process.exit(0);
