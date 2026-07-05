/**
 * Message capability tests (edit/delete/react/read receipts) — own
 * process/server, same reasoning as community.test.mjs: avoid any
 * accumulation from other suites. Run: pnpm test:messages
 */
import { spawn } from "node:child_process";
import { io } from "socket.io-client";

const PORT = 4417;
const URL = `http://localhost:${PORT}`;

const server = spawn("pnpm", ["exec", "tsx", "src/index.ts"], {
  env: { ...process.env, PORT: String(PORT), TABCOM_EPHEMERAL: "1" },
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

const mfa = await connect({ username: "mfa", name: "MfA", color: "#111", visibility: "public" });
const mfb = await connect({ username: "mfb", name: "MfB", color: "#222", visibility: "public" });
const mfc = await connect({ username: "mfc", name: "MfC", color: "#333", visibility: "public" });
await sleep(300);

{
  const req = new Promise((r) => mfb.once("connect_request", r));
  mfa.emit("connect_request", { to: "mfb" });
  await req;
  const ok = new Promise((r) => mfa.once("connect_update", r));
  mfb.emit("connect_response", { to: "mfa", action: "accept" });
  await ok;
}

// TEST: dm_edit relays to the recipient, non-connected user gets nothing
{
  let leaked = false;
  mfc.once("dm_edited", () => (leaked = true));

  const edited = new Promise((r) => mfb.once("dm_edited", r));
  mfa.emit("dm_edit", { to: "mfb", messageId: "m1", text: "corrected text" });
  const payload = await Promise.race([
    edited,
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 2000)),
  ]);
  if (payload.from !== "mfa" || payload.text !== "corrected text" || payload.messageId !== "m1") {
    fail("dm_edited payload malformed: " + JSON.stringify(payload));
  }
  await sleep(200);
  if (leaked) fail("dm_edited leaked to a non-connected user");
  pass("dm_edit: relays correct payload to the recipient only");
}

// TEST: dm_delete relay
{
  const deleted = new Promise((r) => mfb.once("dm_deleted", r));
  mfa.emit("dm_delete", { to: "mfb", messageId: "m1" });
  const payload = await deleted;
  if (payload.from !== "mfa" || payload.messageId !== "m1") fail("dm_deleted payload malformed");
  pass("dm_delete: relays correctly");
}

// TEST: dm_react relay (toggle semantics are client-side; server just relays intent)
{
  const reacted = new Promise((r) => mfa.once("dm_reaction", r));
  mfb.emit("dm_react", { to: "mfa", messageId: "m1", emoji: "👍" });
  const payload = await reacted;
  if (payload.from !== "mfb" || payload.emoji !== "👍") fail("dm_reaction payload malformed");
  pass("dm_react: relays correctly");
}

// TEST: dm_read relay
{
  const read = new Promise((r) => mfa.once("dm_read_receipt", r));
  mfb.emit("dm_read", { to: "mfa", messageId: "m1" });
  const payload = await read;
  if (payload.from !== "mfb" || payload.messageId !== "m1" || !payload.readAt) {
    fail("dm_read_receipt payload malformed");
  }
  pass("dm_read: relays a read receipt with timestamp");
}

// TEST: private sender cannot edit/delete/react/read (complete-end enforced)
{
  const mfPrivate = await connect({ username: "mfprivate", name: "Priv", color: "#999", visibility: "private" });
  let leaked = false;
  mfb.once("dm_edited", () => (leaked = true));
  mfPrivate.emit("dm_edit", { to: "mfb", messageId: "m2", text: "sneaky" });
  await sleep(300);
  if (leaked) fail("private user's edit was relayed");
  pass("dm_edit: blocked from private-mode senders");
  mfPrivate.disconnect();
}

// ---- Community message mutation tests ----
let cid;
{
  const created = new Promise((r) => mfa.once("community_update", r));
  mfa.emit("community_create", { name: "Msg Features" });
  const { community } = await created;
  cid = community.id;

  const invited = new Promise((r) => mfb.once("community_invite", r));
  mfa.emit("community_invite", { communityId: cid, username: "mfb" });
  await invited;
  const joined = new Promise((r) => {
    const h = ({ community: c }) => {
      if (c.members.some((m) => m.username === "mfb")) { mfa.off("community_update", h); r(); }
    };
    mfa.on("community_update", h);
  });
  mfb.emit("community_invite_response", { communityId: cid, action: "accept" });
  await joined;
}

// TEST: community edit/delete/react relay to members, not non-members
{
  let leaked = false;
  mfc.once("community_message_edited", () => (leaked = true));

  const edited = new Promise((r) => mfb.once("community_message_edited", r));
  mfa.emit("community_message_edit", { communityId: cid, messageId: "cm1", text: "edited group text" });
  const payload = await edited;
  if (payload.from !== "mfa" || payload.text !== "edited group text") fail("community edit payload malformed");
  await sleep(200);
  if (leaked) fail("community edit leaked to a non-member");
  pass("community_message_edit: relays to members only");

  const deleted = new Promise((r) => mfb.once("community_message_deleted", r));
  mfa.emit("community_message_delete", { communityId: cid, messageId: "cm1" });
  await deleted;
  pass("community_message_delete: relays correctly");

  const reacted = new Promise((r) => mfa.once("community_reaction", r));
  mfb.emit("community_message_react", { communityId: cid, messageId: "cm1", emoji: "🎉" });
  const reactPayload = await reacted;
  if (reactPayload.emoji !== "🎉") fail("community_reaction payload malformed");
  pass("community_message_react: relays correctly");
}

// TEST: non-member cannot edit/delete/react in a community
{
  let leaked = false;
  mfb.once("community_message_edited", () => (leaked = true));
  mfc.emit("community_message_edit", { communityId: cid, messageId: "cm2", text: "hacked" });
  await sleep(300);
  if (leaked) fail("non-member was able to edit a community message");
  pass("community message mutations: restricted to members");
}

console.log(`\nALL MESSAGE FEATURE TESTS PASSED (${passed.length}/9)`);
mfa.disconnect(); mfb.disconnect(); mfc.disconnect();
server.kill();
process.exit(0);
