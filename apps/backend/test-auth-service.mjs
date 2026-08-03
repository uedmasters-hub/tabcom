import "dotenv/config"; // load apps/backend/.env before anything else

process.env.DATABASE_URL ??= "postgresql://postgres:devpass@localhost:5432/tabcom_dev";
process.env.TABCOM_MASTER_INVITE ??= "TAB-MASTER-TEST-CODE";
// Force dev-mode mailer so magic links are logged (and capturable) —
// a real RESEND_API_KEY in .env would otherwise send silently.
delete process.env.RESEND_API_KEY;

const {
  requestMagicLink,
  verifyMagicLink,
  pollLoginRequest,
  validateSession,
  registerAccount,
  recordInviteRequest,
  purgeIncompleteUsers,
  isFullyRegisteredUser,
  checkEmailEligibleForSignIn,
} = await import("./src/auth/service.ts");
const { db, schema } = await import("./src/db/client.ts");
const { eq } = await import("drizzle-orm");

let passed = 0;
const check = (label, cond) => {
  if (cond) { console.log("✓", label); passed++; }
  else { console.error("✗ FAIL:", label); process.exit(1); }
};

function captureLink(fn) {
  return async (...args) => {
    let link = null;
    const orig = console.log;
    console.log = (...a) => {
      const line = a.join(" ");
      const m = line.match(/(http:\/\/localhost[^\s]+)/);
      if (m) link = m[1];
    };
    const result = await fn(...args);
    console.log = orig;
    const token = link ? new URL(link).searchParams.get("token") : null;
    return { result, token };
  };
}

const runId = Date.now().toString().slice(-8);
const MASTER = process.env.TABCOM_MASTER_INVITE;

// ---- Unregistered email must NOT get a magic link ----
const ghostEmail = `ghost+${runId}@example.com`;
const blocked = await requestMagicLink(ghostEmail, "http://localhost:9999");
check("unregistered email is rejected with not_registered", blocked.ok === false && blocked.reason === "not_registered");
check("unregistered rejection never includes a pollId", !blocked.pollId);

const preflight = await checkEmailEligibleForSignIn(ghostEmail);
check(
  "check-email preflight reports ineligible",
  preflight.ok === true && preflight.eligible === false && preflight.reason === "not_registered"
);

const [waitlisted] = await db
  .select()
  .from(schema.inviteRequests)
  .where(eq(schema.inviteRequests.email, ghostEmail))
  .limit(1);
check("unregistered email is recorded in invite_requests", !!waitlisted);

const [ghostUser] = await db
  .select()
  .from(schema.users)
  .where(eq(schema.users.email, ghostEmail))
  .limit(1);
check("unregistered email does NOT create a users row", !ghostUser);

const badEmail = await requestMagicLink("not-an-email", "http://localhost:9999");
check("invalid email format rejected", badEmail.ok === false && badEmail.reason === "invalid_email");

// ---- Register a real account, THEN magic-link sign-in ----
const aliceEmail = `alice+${runId}@example.com`;
const aliceUser = `alice${runId}`;
const reg = await registerAccount(aliceEmail, aliceUser, "Alice", "#2563EB", MASTER);
check("register creates a fully registered account", reg.ok === true && isFullyRegisteredUser(reg.user));

const requestAndCapture = captureLink(requestMagicLink);
const a1 = await requestAndCapture(aliceEmail, "http://localhost:9999");
check("request succeeds for a registered email", a1.result.ok === true);
check("token captured from the dev-mode logged link", !!a1.token);
const pollIdA = a1.result.pollId;

check("poll before verify returns waiting", (await pollLoginRequest(pollIdA)).status === "waiting");

const rateLimited = await requestMagicLink(aliceEmail, "http://localhost:9999");
check("second request for same email is rate-limited", rateLimited.ok === false && rateLimited.reason === "rate_limited");

check("verifying a bogus token fails", (await verifyMagicLink("bogus-token")).ok === false);

const verifyA = await verifyMagicLink(a1.token);
check("verifying the real token succeeds", verifyA.ok === true && verifyA.email === aliceEmail);
check("replaying a consumed token fails", (await verifyMagicLink(a1.token)).ok === false);

const pollAfterVerifyA = await pollLoginRequest(pollIdA);
check("poll after verify returns a session", pollAfterVerifyA.status === "verified" && !!pollAfterVerifyA.sessionToken);
check("poll returns the registered username", pollAfterVerifyA.user.username === aliceUser);
check("session handoff can only be collected once", (await pollLoginRequest(pollIdA)).status !== "verified");

const sessionA = pollAfterVerifyA.sessionToken;
const authedA = await validateSession(sessionA);
check("issued session token validates", authedA !== null && authedA.email === aliceEmail);
check("a forged session token is rejected", (await validateSession("forged")) === null);

// ---- Second registered user ----
const bobEmail = `bob+${runId}@example.com`;
const bobUser = `bob${runId}`;
const regB = await registerAccount(bobEmail, bobUser, "Bob", "#059669", MASTER);
check("second user registers", regB.ok === true);

const b1 = await requestAndCapture(bobEmail, "http://localhost:9999");
check("second user's request succeeds", b1.result.ok === true);
const verifyB = await verifyMagicLink(b1.token);
check("second user verifies successfully", verifyB.ok === true);
const pollB = await pollLoginRequest(b1.result.pollId);
check("second user is a genuinely different account", pollB.user.id !== pollAfterVerifyA.user.id);

// ---- Invite request API helper ----
const invite = await recordInviteRequest({
  email: `wait+${runId}@example.com`,
  displayName: "Waiter",
  source: "settings",
});
check("explicit invite request succeeds", invite.ok === true && invite.created === true);
const inviteAgain = await recordInviteRequest({
  email: `wait+${runId}@example.com`,
  source: "settings",
});
check("duplicate invite request is idempotent", inviteAgain.ok === true && inviteAgain.created === false);

// ---- Ghost cleanup ----
// Simulate a legacy incomplete row (should never be creatable via auth now).
const [planted] = await db
  .insert(schema.users)
  .values({ email: `orphan+${runId}@example.com` })
  .returning();
check("planted incomplete user for cleanup test", !!planted && !isFullyRegisteredUser(planted));
const purged = await purgeIncompleteUsers();
check("purgeIncompleteUsers deletes ghost rows", purged.deleted >= 1);
const [stillThere] = await db
  .select()
  .from(schema.users)
  .where(eq(schema.users.email, `orphan+${runId}@example.com`))
  .limit(1);
check("ghost row is gone after purge", !stillThere);
const [aliceStill] = await db
  .select()
  .from(schema.users)
  .where(eq(schema.users.email, aliceEmail))
  .limit(1);
check("purge does not delete fully registered users", !!aliceStill && aliceStill.username === aliceUser);

console.log(`\nALL AUTH SERVICE TESTS PASSED (${passed}/${passed})`);
process.exit(0);
