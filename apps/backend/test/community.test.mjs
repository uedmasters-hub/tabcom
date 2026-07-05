/**
 * Community management tests — run in their own process/server to
 * avoid any accumulation from the main relay suite (28 prior tests,
 * 60+ sockets opened in one Node process). Run: pnpm test:community
 */
import { spawn } from "node:child_process";
import { io } from "socket.io-client";

const PORT = 4231;
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

// ---- Community management tests ----
{
  const cmA = await connect({ username: "cma", name: "CmA", color: "#111", visibility: "public" });
  const cmb = await connect({ username: "cmb", name: "CmB", color: "#222", visibility: "public" });
  const cmc = await connect({ username: "cmc", name: "CmC", color: "#333", visibility: "public" });
  const cmmallory = await connect({ username: "cmmallory", name: "CmMallory", color: "#DC2626", visibility: "public" });
  await sleep(300);

  // connect cmA<->cmb, cmA<->cmc, and cmA<->cmmallory (needed for TEST 30's invite)
  for (const [a, bName, b] of [[cmA, "cmb", cmb], [cmA, "cmc", cmc], [cmA, "cmmallory", cmmallory]]) {
    const req = new Promise((r) => b.once("connect_request", r));
    a.emit("connect_request", { to: bName });
    await req;
    const ok = new Promise((r) => a.once("connect_update", r));
    b.emit("connect_response", { to: "cma", action: "accept" });
    await ok;
    }

  const created = new Promise((r) => cmA.once("community_update", r));
  cmA.emit("community_create", { name: "Manage Me" });
  const { community } = await created;
  const cid = community.id;

  const joinBoth = async (username, sock) => {
    const invited = new Promise((r) => sock.once("community_invite", r));
    cmA.emit("community_invite", { communityId: cid, username });
    await invited;
    const joined = new Promise((r) => {
      const h = ({ community: c }) => {
        if (c.members.some((m) => m.username === username)) { cmA.off("community_update", h); r(); }
      };
      cmA.on("community_update", h);
    });
    sock.emit("community_invite_response", { communityId: cid, action: "accept" });
    await joined;
  };
  await joinBoth("cmb", cmb);
  await joinBoth("cmc", cmc);
  await sleep(300); // let every member's copy of the join broadcast fully settle

  // TEST 29: rename — admin only
  {
    let leaked = false;
    const spy = () => (leaked = true);
    cmb.once("community_update", spy);
    cmb.emit("community_rename", { communityId: cid, name: "Hacked Name" });
    await sleep(300);
    cmb.off("community_update", spy);
    if (leaked) fail("non-admin was able to rename the community");

    const renamed = new Promise((r) => {
      const h = ({ community: c }) => { if (c.name === "Renamed") { cmb.off("community_update", h); r(); } };
      cmb.on("community_update", h);
    });
    cmA.emit("community_rename", { communityId: cid, name: "Renamed" });
    await renamed;
    pass("community: rename restricted to admin, propagates to all members");
  }

  // TEST 30: pending invites visible to admin only
  {
    const invited = new Promise((r) => cmmallory.once("community_invite", r));
    cmA.emit("community_invite", { communityId: cid, username: "cmmallory" });
    await invited;

    const adminSnap = await new Promise((r) => {
      cmA.emit("hello", { username: "cma", name: "CmA", color: "#111", visibility: "public" });
      cmA.once("communities", r);
    });
    const adminView = adminSnap.find((c) => c.id === cid);
    if (!adminView.pendingInvites.some((p) => p.username === "cmmallory")) {
      fail("admin did not see the pending invite");
    }

    const memberSnap = await new Promise((r) => {
      cmb.emit("hello", { username: "cmb", name: "CmB", color: "#222", visibility: "public" });
      cmb.once("communities", r);
    });
    const memberView = memberSnap.find((c) => c.id === cid);
    if (memberView.pendingInvites.length !== 0) {
      fail("non-admin member could see pending invites");
    }
    pass("community: pending invites visible to admin only");
  }

  // TEST 31: cancel a pending invite
  {
    const cancelled = new Promise((r) => cmmallory.once("community_invite_cancelled", r));
    cmA.emit("community_invite_cancel", { communityId: cid, username: "cmmallory" });
    await cancelled;

    // cmmallory accepting now should NOT be able to join (invite no longer pending)
    cmmallory.emit("community_invite_response", { communityId: cid, action: "accept" });
    await sleep(300);
    const snap = await new Promise((r) => {
      cmA.emit("hello", { username: "cma", name: "CmA", color: "#111", visibility: "public" });
      cmA.once("communities", r);
    });
    const view = snap.find((c) => c.id === cid);
    if (view.members.some((m) => m.username === "cmmallory")) {
      fail("cancelled invite still allowed joining");
    }
    pass("community: cancelled invite correctly blocks a late accept");
  }

  // TEST 32: remove a member — admin only, counts as a strike
  {
    let leaked = false;
    const spy = ({ community: c }) => {
      if (!c.members.some((m) => m.username === "cmc")) leaked = true;
    };
    cmc.on("community_update", spy);
    cmb.emit("community_remove_member", { communityId: cid, username: "cmc" });
    await sleep(300);
    cmc.off("community_update", spy);
    if (leaked) fail("non-admin was able to remove a member");

    const removed = new Promise((r) => cmc.once("community_left", r));
    const updated = new Promise((r) => {
      const h = ({ community: c }) => {
        if (!c.members.some((m) => m.username === "cmc")) { cmb.off("community_update", h); r(); }
      };
      cmb.on("community_update", h);
    });
    cmA.emit("community_remove_member", { communityId: cid, username: "cmc" });
    await Promise.all([removed, updated]);
    pass("community: remove-member restricted to admin, removed user notified");
  }

  // TEST 33: transfer admin
  {
    let leaked = false;
    const spy = ({ community: c }) => { if (c.admin === "cmb") leaked = true; };
    cmb.on("community_update", spy);
    cmb.emit("community_transfer_admin", { communityId: cid, username: "cmb" }); // cmb isn't admin
    await sleep(300);
    cmb.off("community_update", spy);
    if (leaked) fail("non-admin was able to transfer admin");

    const transferred = new Promise((r) => {
      const h = ({ community: c }) => { if (c.admin === "cmb") { cmb.off("community_update", h); r(); } };
      cmb.on("community_update", h);
    });
    cmA.emit("community_transfer_admin", { communityId: cid, username: "cmb" });
    await transferred;

    // cmA (former admin) should no longer be able to rename
    let stillWorks = false;
    const spy2 = () => (stillWorks = true);
    cmA.once("community_update", spy2);
    cmA.emit("community_rename", { communityId: cid, name: "Should not apply" });
    await sleep(300);
    cmA.off("community_update", spy2);
    if (stillWorks) fail("former admin retained rename permission after transfer");
    pass("community: admin transfer works, former admin loses privileges");
  }

  // TEST 34: delete community — admin only, all members notified
  {
    let leaked = false;
    const spy = () => (leaked = true);
    cmA.once("community_deleted", spy);
    cmA.emit("community_delete", { communityId: cid }); // cmA is no longer admin (cmB is now)
    await sleep(300);
    cmA.off("community_deleted", spy);
    if (leaked) fail("non-admin (former admin) was able to delete the community");

    const del1 = new Promise((r) => cmA.once("community_deleted", r));
    const del2 = new Promise((r) => cmb.once("community_deleted", r));
    cmb.emit("community_delete", { communityId: cid });
    await Promise.all([del1, del2]);
    pass("community: delete restricted to current admin, all members notified");
  }

  cmA.disconnect(); cmb.disconnect(); cmc.disconnect(); cmmallory.disconnect();
}


console.log(`\nALL COMMUNITY MANAGEMENT TESTS PASSED (${passed.length}/6)`);
server.kill();
process.exit(0);
