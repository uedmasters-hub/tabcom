import "dotenv/config"; // load apps/backend/.env before anything else

process.env.DATABASE_URL ??= "postgresql://postgres:devpass@localhost:5432/tabcom_dev";

const { requestMagicLink, verifyMagicLink, pollLoginRequest, validateSession, claimUsername } =
  await import("./src/auth/service.ts");

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

const requestAndCapture = captureLink(requestMagicLink);

// ---- User A: full happy path ----
const a1 = await requestAndCapture("alice@example.com", "http://localhost:9999");
check("request succeeds for a valid email", a1.result.ok === true);
check("token captured from the dev-mode logged link", !!a1.token);
const pollIdA = a1.result.pollId;

check("poll before verify returns waiting", (await pollLoginRequest(pollIdA)).status === "waiting");

const rateLimited = await requestMagicLink("alice@example.com", "http://localhost:9999");
check("second request for same email is rate-limited", rateLimited.ok === false && rateLimited.reason === "rate_limited");

const badEmail = await requestMagicLink("not-an-email", "http://localhost:9999");
check("invalid email format rejected", badEmail.ok === false && badEmail.reason === "invalid_email");

check("verifying a bogus token fails", (await verifyMagicLink("bogus-token")).ok === false);

const verifyA = await verifyMagicLink(a1.token);
check("verifying the real token succeeds", verifyA.ok === true && verifyA.email === "alice@example.com");
check("replaying a consumed token fails", (await verifyMagicLink(a1.token)).ok === false);

const pollAfterVerifyA = await pollLoginRequest(pollIdA);
check("poll after verify returns a session", pollAfterVerifyA.status === "verified" && !!pollAfterVerifyA.sessionToken);
check("poll returns the correct user email", pollAfterVerifyA.user.email === "alice@example.com");
check("session handoff can only be collected once", (await pollLoginRequest(pollIdA)).status !== "verified");

const sessionA = pollAfterVerifyA.sessionToken;
const userIdA = pollAfterVerifyA.user.id;

const authedA = await validateSession(sessionA);
check("issued session token validates", authedA !== null && authedA.email === "alice@example.com");
check("a forged session token is rejected", (await validateSession("forged")) === null);

const claimA = await claimUsername(userIdA, "alice", "Alice", "#2563EB");
check("first user claims a username", claimA.ok === true);
check("re-claiming your OWN username is idempotent", (await claimUsername(userIdA, "alice", "Alice", "#2563EB")).ok === true);

// ---- User B: the actual uniqueness test ----
const b1 = await requestAndCapture("bob@example.com", "http://localhost:9999");
check("second (different) user's request succeeds", b1.result.ok === true);

const verifyB = await verifyMagicLink(b1.token);
check("second user verifies successfully", verifyB.ok === true);

const pollB = await pollLoginRequest(b1.result.pollId);
const userIdB = pollB.user.id;
check("second user is a genuinely different account", userIdB !== userIdA);

const conflict = await claimUsername(userIdB, "alice", "Bob", "#059669");
check("a DIFFERENT user CANNOT claim an already-taken username", conflict.ok === false && conflict.reason === "taken");

const ownName = await claimUsername(userIdB, "bob", "Bob", "#059669");
check("the second user can still claim their OWN distinct username", ownName.ok === true);

console.log(`\nALL AUTH SERVICE TESTS PASSED (${passed}/${passed})`);
process.exit(0);
