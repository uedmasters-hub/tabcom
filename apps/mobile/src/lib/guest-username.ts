import { auth } from "./auth-client";

/**
 * Auto-generates a unique-enough guest username. Ported verbatim from
 * the extension (lib/guest-username.ts) so both platforms mint handles
 * from the same keyspace and a guest can never collide with a real
 * registered username.
 *
 * Guests never type a username — only a display name — so this runs
 * silently in the background during onboarding.
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
    const result = await auth.checkUsernameAvailable(candidate);

    if (!result.ok) {
      // No server to check against — nothing real for a local-only
      // guest handle to collide with, so accept it as-is.
      if (result.reason === "unreachable") return candidate;
      continue;
    }
    if (result.available) return candidate;
    // Taken — vanishingly unlikely with this keyspace; try again.
  }

  // Unique by construction, no round trip needed.
  return `guest_${Date.now().toString(36)}`;
}
