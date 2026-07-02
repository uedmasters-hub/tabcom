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

// TEST 2: public <-> public DM relays
{
  const delivery = new Promise((resolve) => bob.once("dm", resolve));
  alice.emit("dm", { to: "bob", message: { id: "t2", kind: "text", text: "hi bob", sentAt: Date.now() } });
  const { from, message } = await delivery;
  if (from.username !== "alice" || message.text !== "hi bob") fail("public->public dm corrupted");
  pass("messaging: public -> public delivers");
}

// TEST 3: DM *to* a private user is rejected; nothing reaches them
{
  let leaked = false;
  mallory.once("dm", () => (leaked = true));
  const error = new Promise((resolve) => alice.once("dm_error", resolve));
  alice.emit("dm", { to: "mallory", message: { id: "t3", kind: "text", text: "psst", sentAt: Date.now() } });
  const err = await error;
  await sleep(300);
  if (leaked) fail("message reached a private user");
  if (err.reason !== "recipient_unavailable") fail("wrong rejection reason: " + err.reason);
  pass("barrier in: dm TO private user rejected, nothing delivered");
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

// TEST 7: offline and private recipients are indistinguishable (no presence leak)
{
  const errorOffline = new Promise((resolve) => alice.once("dm_error", resolve));
  alice.emit("dm", { to: "ghost", message: { id: "t7", kind: "text", text: "?", sentAt: Date.now() } });
  const err = await errorOffline;
  if (err.reason !== "recipient_unavailable") fail("offline reason differs from private reason");
  pass("no presence leak: offline and private are indistinguishable");
}

console.log(`\nALL PRIVACY TESTS PASSED (${passed.length}/7)`);
alice.disconnect(); bob.disconnect(); mallory.disconnect();
server.kill();
process.exit(0);
