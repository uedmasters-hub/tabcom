import { checkUsernameAvailable } from "./auth-client";

/**
 * Auto-generates a unique-enough guest username — guests never type
 * their own (see the product requirement: manual username selection
 * isn't offered for guests, only a display name is).
 *
 * Deliberately reuses the same server-side availability check the
 * real registration form uses, so a guest can never collide with a
 * genuine registered username. When the server can't be reached
 * (offline/demo mode), falls back to a locally-random suffix — there's
 * no real namespace to collide with in that mode anyway.
 */

const ADJECTIVES = [
  "swift", "quiet", "amber", "bold", "calm", "clever", "bright", "gentle",
  "brave", "lucky", "mellow", "sunny", "cosmic", "crisp", "vivid", "keen",
];

const NOUNS = [
  "otter", "falcon", "maple", "harbor", "comet", "meadow", "ember", "pine",
  "heron", "willow", "boulder", "lagoon", "canyon", "sparrow", "quartz", "tide",
];

function randomHandle(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const suffix = Math.floor(Math.random() * 900) + 100; // 100-999
  return `${adjective}_${noun}${suffix}`;
}

const MAX_ATTEMPTS = 5;

export async function generateGuestUsername(): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = randomHandle();
    const result = await checkUsernameAvailable(candidate);

    if (!result.ok) {
      if (result.reason === "unreachable") {
        // No server to check against — nothing real for a local-only
        // guest handle to collide with, so accept it as-is.
        return candidate;
      }
      continue; // invalid_format is essentially unreachable here since
      // randomHandle() always produces a valid shape, but retry rather
      // than assume.
    }

    if (result.available) return candidate;
    // taken — vanishingly unlikely with this keyspace, but loop and
    // try a fresh combination rather than fail outright.
  }

  // Exhausted retries (extremely unlikely) — fall back to a
  // timestamp-suffixed handle, which is unique by construction even
  // without a server round trip.
  return `guest_${Date.now().toString(36)}`;
}
