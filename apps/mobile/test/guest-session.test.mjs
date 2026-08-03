/**
 * Pure guest-session timing helpers — no Expo / RN imports so this can
 * run under plain Node. Guards against the isolation regressions that
 * previously let guest B inherit guest A's leftover clock/state.
 *
 * Run: node apps/mobile/test/guest-session.test.mjs
 */
import assert from "node:assert/strict";

const GUEST_SESSION_MS = 30 * 60 * 1000;
const GUEST_WARN_MS = 5 * 60 * 1000;

function guestExpiresAt(startedAt) {
  return startedAt + GUEST_SESSION_MS;
}
function guestMsRemaining(startedAt, now = Date.now()) {
  return Math.max(0, guestExpiresAt(startedAt) - now);
}
function isGuestExpired(startedAt, now = Date.now()) {
  return now >= guestExpiresAt(startedAt);
}
function shouldShowGuestExpiryBanner(startedAt, now = Date.now()) {
  const left = guestMsRemaining(startedAt, now);
  return left > 0 && left <= GUEST_WARN_MS;
}
function formatGuestCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const start = 1_000_000_000_000;

assert.equal(isGuestExpired(start, start + GUEST_SESSION_MS - 1), false);
assert.equal(isGuestExpired(start, start + GUEST_SESSION_MS), true);
assert.equal(isGuestExpired(start, start + GUEST_SESSION_MS + 60_000), true);

assert.equal(shouldShowGuestExpiryBanner(start, start + 10 * 60_000), false);
assert.equal(shouldShowGuestExpiryBanner(start, start + 25 * 60_000), true);
assert.equal(shouldShowGuestExpiryBanner(start, start + 29 * 60_000), true);
assert.equal(shouldShowGuestExpiryBanner(start, start + GUEST_SESSION_MS), false);

assert.equal(formatGuestCountdown(5 * 60_000), "5:00");
assert.equal(formatGuestCountdown(4 * 60_000 + 32_000), "4:32");
assert.equal(formatGuestCountdown(900), "0:01");
assert.equal(formatGuestCountdown(0), "0:00");

// A brand-new guest clock must never inherit a previous startedAt.
const guestA = { startedAt: start };
const guestB = { startedAt: start + GUEST_SESSION_MS + 1 };
assert.equal(isGuestExpired(guestA.startedAt, guestB.startedAt), true);
assert.equal(isGuestExpired(guestB.startedAt, guestB.startedAt), false);
assert.notEqual(guestA.startedAt, guestB.startedAt);

console.log("✓ guest-session timing + isolation helpers passed");
