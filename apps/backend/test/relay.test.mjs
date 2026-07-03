/**
 * Privacy-rule integration tests for the realtime server.
 * Spawns the server on a test port, connects simulated browsers,
 * asserts every visibility guarantee. Run: pnpm test
 */
import { spawn } from "node:child_process";
import { io } from "socket.io-client";

const PORT = 3199;
const URL = `http://localhost:${PORT}`;

const server = spawn("pnpm", ["exec", "tsx", "src/index.ts"], {
  env: { ...process.env, PORT: String(PORT) },
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

await new Promise((resolve) => {
  server.stdout.on("data", (chunk) => {
    if (String(chunk).includes("listening")) resolve();
  });
});

const connect = (user) =>
  new Promise((resolve) => {
    const socket = io(URL);
    socket.on("connect", () => {
      socket.emit("hello", user);
      resolve(socket);
    });
  });

const nextRoster = (socket) =>
  new Promise((resolve) => socket.once("roster", resolve));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// alice (public), bob (public), mallory (PRIVATE)
const alice = await connect({ username: "alice", name: "Alice", color: "#2563EB", visibility: "public" });
const bob = await connect({ username: "bob", name: "Bob", color: "#059669", visibility: "public" });
const mallory = await connect({ username: "mallory", name: "Mallory", color: "#DC2626", visibility: "private" });
await sleep(400);

// TEST 1: private user never appears in the roster
{
  const rosterPromise = nextRoster(alice);
  mallory.emit("visibility", "private"); // triggers rebroadcast
  const roster = await rosterPromise;
  const names = roster.map((u) => u.username).sort();
  if (names.includes("mallory")) fail("private user leaked into roster");
  if (!names.includes("alice") || !names.includes("bob")) fail("public users missing from roster");
  pass("discovery: public users listed, private user invisible");
}

// TEST 2a: DM before any connection is rejected (consent gate)
{
  let leaked = false;
  bob.once("dm", () => (leaked = true));
  const error = new Promise((resolve) => alice.once("dm_error", resolve));
  alice.emit("dm", { to: "bob", message: { id: "t2a", kind: "text", text: "premature", sentAt: Date.now() } });
  const err = await error;
  await sleep(200);
  if (leaked) fail("dm delivered without an accepted connection");
  if (err.reason !== "not_connected") fail("wrong pre-connection reason: " + err.reason);
  pass("consent gate: no dm without an accepted connection");
}

// TEST 2b: request -> accept -> DM flows
{
  const requestArrives = new Promise((resolve) => bob.once("connect_request", resolve));
  alice.emit("connect_request", { to: "bob" });
  const { from } = await requestArrives;
  if (from.username !== "alice") fail("request carried wrong sender");

  const bothNotified = Promise.all([
    new Promise((resolve) => alice.once("connect_update", resolve)),
    new Promise((resolve) => bob.once("connect_update", resolve)),
  ]);
  bob.emit("connect_response", { to: "alice", action: "accept" });
  const [aliceUpdate, bobUpdate] = await bothNotified;
  if (aliceUpdate.status !== "accepted" || bobUpdate.status !== "accepted") fail("accept did not notify both sides");

  const delivery = new Promise((resolve) => bob.once("dm", resolve));
  alice.emit("dm", { to: "bob", message: { id: "t2b", kind: "text", text: "hi bob", sentAt: Date.now() } });
  const { message } = await delivery;
  if (message.text !== "hi bob") fail("post-accept dm corrupted");
  pass("consent flow: request -> accept -> dm delivers");
}

// TEST 3: a connected user who goes PRIVATE becomes unreachable
{
  // mallory goes public long enough to connect with alice
  mallory.emit("visibility", "public");
  await sleep(200);

  const req = new Promise((resolve) => mallory.once("connect_request", resolve));
  alice.emit("connect_request", { to: "mallory" });
  await req;
  const accepted = new Promise((resolve) => alice.once("connect_update", resolve));
  mallory.emit("connect_response", { to: "alice", action: "accept" });
  await accepted;

  // now mallory goes private — even the accepted connection cannot reach her
  mallory.emit("visibility", "private");
  await sleep(200);

  let leaked = false;
  mallory.once("dm", () => (leaked = true));
  const error = new Promise((resolve) => alice.once("dm_error", resolve));
  alice.emit("dm", { to: "mallory", message: { id: "t3", kind: "text", text: "psst", sentAt: Date.now() } });
  const err = await error;
  await sleep(300);
  if (leaked) fail("message reached a private user");
  if (err.reason !== "recipient_unavailable") fail("wrong rejection reason: " + err.reason);
  pass("barrier in: private overrides even an accepted connection");
}

// TEST 4: DM *from* a private user is rejected (complete end)
{
  let leaked = false;
  alice.once("dm", () => (leaked = true));
  const error = new Promise((resolve) => mallory.once("dm_error", resolve));
  mallory.emit("dm", { to: "alice", message: { id: "t4", kind: "text", text: "sneaky", sentAt: Date.now() } });
  const err = await error;
  await sleep(300);
  if (leaked) fail("private user was able to send");
  if (err.reason !== "sender_private") fail("wrong rejection reason: " + err.reason);
  pass("barrier out: dm FROM private user rejected (complete end)");
}

// TEST 5: typing from private user is silently dropped
{
  let leaked = false;
  alice.once("typing", () => (leaked = true));
  mallory.emit("typing", { to: "alice" });
  await sleep(300);
  if (leaked) fail("typing leaked from private user");
  pass("typing from private user dropped");
}

// TEST 6: going public appears live; going private vanishes live
{
  const appear = nextRoster(alice);
  mallory.emit("visibility", "public");
  const rosterAfterPublic = await appear;
  if (!rosterAfterPublic.some((u) => u.username === "mallory")) fail("user did not appear after going public");

  const vanish = nextRoster(alice);
  mallory.emit("visibility", "private");
  const rosterAfterPrivate = await vanish;
  if (rosterAfterPrivate.some((u) => u.username === "mallory")) fail("user did not vanish after going private");
  pass("live switching: appears on public, vanishes on private");
}

// TEST 7: no presence leaks at either tier
{
  // Tier 1: any unconnected target (stranger, offline, or nonexistent)
  // is uniformly "not_connected".
  const errGhost = new Promise((resolve) => alice.once("dm_error", resolve));
  alice.emit("dm", { to: "ghost", message: { id: "t7a", kind: "text", text: "?", sentAt: Date.now() } });
  if ((await errGhost).reason !== "not_connected") fail("nonexistent target leaked information");

  // Tier 2: among CONNECTED users, private and fully-offline produce the
  // identical reason (mallory is connected+private; now she disconnects).
  const errPrivate = new Promise((resolve) => alice.once("dm_error", resolve));
  alice.emit("dm", { to: "mallory", message: { id: "t7b", kind: "text", text: "?", sentAt: Date.now() } });
  const privateReason = (await errPrivate).reason;

  mallory.disconnect();
  await sleep(300);

  const errOffline = new Promise((resolve) => alice.once("dm_error", resolve));
  alice.emit("dm", { to: "mallory", message: { id: "t7c", kind: "text", text: "?", sentAt: Date.now() } });
  const offlineReason = (await errOffline).reason;

  if (privateReason !== offlineReason) fail("private vs offline distinguishable: " + privateReason + " / " + offlineReason);
  pass("no presence leak: stranger/private/offline reveal nothing");
}


// TEST 8: deny — requester informed, messaging still barred, re-request allowed
{
  const carol = await connect({ username: "carol", name: "Carol", color: "#D97706", visibility: "public" });
  await sleep(200);

  const req = new Promise((resolve) => carol.once("connect_request", resolve));
  alice.emit("connect_request", { to: "carol" });
  await req;

  const declined = new Promise((resolve) => alice.once("connect_update", resolve));
  carol.emit("connect_response", { to: "alice", action: "deny" });
  const upd = await declined;
  if (upd.status !== "declined") fail("deny did not report declined to requester");

  const error = new Promise((resolve) => alice.once("dm_error", resolve));
  alice.emit("dm", { to: "carol", message: { id: "t8", kind: "text", text: "still?", sentAt: Date.now() } });
  const err = await error;
  if (err.reason !== "not_connected") fail("messaging allowed after deny");

  const req2 = new Promise((resolve) => carol.once("connect_request", resolve));
  alice.emit("connect_request", { to: "carol" });
  await req2;
  pass("deny: requester informed, chat barred, re-request possible");
  carol.disconnect();
  await sleep(200);
}

// TEST 9: block is invisible — requests from a blocked user are swallowed
{
  const dave = await connect({ username: "dave", name: "Dave", color: "#334155", visibility: "public" });
  await sleep(200);

  bob.emit("block", { username: "dave" });
  await sleep(200);

  let reached = false;
  bob.once("connect_request", () => (reached = true));

  const ack = new Promise((resolve) => dave.once("connect_update", resolve));
  dave.emit("connect_request", { to: "bob" });
  const upd = await ack;
  await sleep(300);

  if (reached) fail("blocked user's request reached the blocker");
  if (upd.status !== "pending_out") fail("blocked requester got a distinguishable response: " + upd.status);
  pass("block: invisible — request swallowed, requester sees normal pending");
  dave.disconnect();
  await sleep(200);
}

// TEST 10: block severs an accepted connection (alice<->bob were connected)
{
  bob.emit("block", { username: "alice" });
  await sleep(200);

  const error = new Promise((resolve) => alice.once("dm_error", resolve));
  alice.emit("dm", { to: "bob", message: { id: "t10", kind: "text", text: "hello?", sentAt: Date.now() } });
  const err = await error;
  if (err.reason !== "not_connected") fail("block did not sever the accepted connection");
  pass("block: severs existing connection, dm rejected");
}

// TEST 11: unblock restores nothing automatically — consent must be re-earned
{
  bob.emit("unblock", { username: "alice" });
  await sleep(200);

  const error = new Promise((resolve) => alice.once("dm_error", resolve));
  alice.emit("dm", { to: "bob", message: { id: "t11", kind: "text", text: "now?", sentAt: Date.now() } });
  const err = await error;
  if (err.reason !== "not_connected") fail("unblock silently restored the connection");
  pass("unblock: connection must be re-requested, not auto-restored");
}

// TEST 12: report auto-blocks
{
  const eve = await connect({ username: "eve", name: "Eve", color: "#E11D48", visibility: "public" });
  await sleep(200);

  alice.emit("report", { username: "eve", reason: "spam" });
  await sleep(200);

  let reached = false;
  alice.once("connect_request", () => (reached = true));
  eve.emit("connect_request", { to: "alice" });
  await sleep(300);
  if (reached) fail("reported user could still reach the reporter");
  pass("report: auto-blocks the reported user");
  eve.disconnect();
}


// ---- Community tests ----
// fresh users: gia (admin), hana (member-to-be), ivan (stranger)
const gia = await connect({ username: "gia", name: "Gia", color: "#2563EB", visibility: "public" });
const hana = await connect({ username: "hana", name: "Hana", color: "#059669", visibility: "public" });
const ivan = await connect({ username: "ivan", name: "Ivan", color: "#7C3AED", visibility: "public" });
await sleep(200);

// connect gia <-> hana (required for invites)
{
  const req = new Promise((r) => hana.once("connect_request", r));
  gia.emit("connect_request", { to: "hana" });
  await req;
  const ok = new Promise((r) => gia.once("connect_update", r));
  hana.emit("connect_response", { to: "gia", action: "accept" });
  await ok;
}

// TEST 13: create community + invite requires an accepted connection
let communityId;
{
  const created = new Promise((r) => gia.once("community_update", r));
  gia.emit("community_create", { name: "Design Guild" });
  const { community } = await created;
  communityId = community.id;
  if (community.admin !== "gia" || community.members.length !== 1) fail("community create malformed");

  const err = new Promise((r) => gia.once("community_error", r));
  gia.emit("community_invite", { communityId, username: "ivan" }); // stranger
  const e = await err;
  if (e.reason !== "not_connected") fail("stranger invite not rejected: " + e.reason);
  pass("community: created; invites restricted to accepted connections");
}

// TEST 14: invite -> notified -> accept -> membership + group message relay
{
  const invited = new Promise((r) => hana.once("community_invite", r));
  gia.emit("community_invite", { communityId, username: "hana" });
  const inv = await invited;
  if (inv.from.username !== "gia" || inv.attempt !== 1) fail("invite notification malformed");

  const joined = new Promise((r) => {
    const handler = ({ community }) => {
      if (community.members.some((m) => m.username === "hana")) {
        gia.off("community_update", handler);
        r({ community });
      }
    };
    gia.on("community_update", handler);
  });
  hana.emit("community_invite_response", { communityId, action: "accept" });
  await joined;

  const delivery = new Promise((r) => hana.once("community_message", r));
  gia.emit("community_message", { communityId, message: { id: "cm1", kind: "text", text: "welcome!", sentAt: Date.now() } });
  const { from, message } = await delivery;
  if (from.username !== "gia" || message.text !== "welcome!") fail("group message corrupted");
  pass("community: invite notified, accept joins, group messages relay");
}

// TEST 15: non-members get nothing; members going private stop receiving
{
  let leaked = false;
  ivan.once("community_message", () => (leaked = true));
  gia.emit("community_message", { communityId, message: { id: "cm2", kind: "text", text: "secret", sentAt: Date.now() } });
  await sleep(300);
  if (leaked) fail("group message leaked to non-member");

  hana.emit("visibility", "private");
  await sleep(200);
  let leakedPrivate = false;
  hana.once("community_message", () => (leakedPrivate = true));
  gia.emit("community_message", { communityId, message: { id: "cm3", kind: "text", text: "psst", sentAt: Date.now() } });
  await sleep(300);
  if (leakedPrivate) fail("group message reached a private member");
  hana.emit("visibility", "public");
  await sleep(200);
  pass("community: non-members and private members receive nothing");
}

// TEST 16: leave notifies admin (revocation); decline counts attempts; 3-strike bars forever
{
  const revoked = new Promise((r) => gia.once("community_invite_declined", r));
  hana.emit("community_leave", { communityId });
  const rev = await revoked;
  if (rev.username !== "hana" || rev.attemptsLeft !== 2) fail("leave/revoke notify wrong: " + JSON.stringify(rev));

  // attempt 2: invite -> decline
  const inv2 = new Promise((r) => hana.once("community_invite", r));
  gia.emit("community_invite", { communityId, username: "hana" });
  await inv2;
  const dec2 = new Promise((r) => gia.once("community_invite_declined", r));
  hana.emit("community_invite_response", { communityId, action: "decline" });
  const d2 = await dec2;
  if (d2.attemptsLeft !== 1) fail("attempt counter wrong after decline 2: " + d2.attemptsLeft);

  // attempt 3: invite -> decline -> barred
  const inv3 = new Promise((r) => hana.once("community_invite", r));
  gia.emit("community_invite", { communityId, username: "hana" });
  const i3 = await inv3;
  if (i3.attempt !== 3) fail("third invite attempt not counted");
  const dec3 = new Promise((r) => gia.once("community_invite_declined", r));
  hana.emit("community_invite_response", { communityId, action: "decline" });
  const d3 = await dec3;
  if (!d3.barred || d3.attemptsLeft !== 0) fail("3-strike bar not reported");

  // attempt 4 must be refused by the server
  const limitErr = new Promise((r) => gia.once("community_error", r));
  let reached = false;
  hana.once("community_invite", () => (reached = true));
  gia.emit("community_invite", { communityId, username: "hana" });
  const le = await limitErr;
  await sleep(200);
  if (reached) fail("4th invite reached the user");
  if (le.reason !== "invite_limit") fail("wrong limit reason: " + le.reason);
  pass("community: revoke notifies admin, 3 attempts max, then barred forever");
}

gia.disconnect(); hana.disconnect(); ivan.disconnect();

console.log(`\nALL PRIVACY TESTS PASSED (${passed.length}/17)`);
alice.disconnect(); bob.disconnect(); mallory.disconnect();
server.kill();
process.exit(0);
