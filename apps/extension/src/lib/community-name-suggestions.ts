/**
 * Instant, random community name suggestions for the word-cloud picker
 * in the create-community form. No input required — this is meant to
 * be a fast, fun shortcut, not a search: type nothing, see a cloud of
 * options, tap one.
 *
 * Deliberately local-only (no server round trip, unlike guest-username
 * generation) — community names aren't unique/reserved the way
 * usernames are, so there's nothing to check availability against.
 */

const ADJECTIVES = [
  "Velvet", "Golden", "Quiet", "Bold", "Amber", "Cosmic", "Rustic", "Vivid",
  "Gentle", "Electric", "Hidden", "Sunlit", "Midnight", "Coastal", "Wild", "Crisp",
];

const NOUNS = [
  "Comet", "Falcon", "Harbor", "Meadow", "Ember", "Canyon", "Lagoon", "Summit",
  "Orchard", "Beacon", "Grove", "Tide", "Quartz", "Ridge", "Willow", "Atlas",
];

// Appended to roughly half the suggestions for variety — a bare
// "Velvet Comet" reads fine on its own, but mixing in a group-noun
// suffix keeps the cloud from looking repetitive.
const SUFFIXES = ["Circle", "Crew", "Collective", "Guild", "Hub", "Squad"];

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)]!;
}

/** One suggestion, e.g. "Velvet Comet" or "Quiet Falcon Guild". */
function suggestOne(): string {
  const parts = [pick(ADJECTIVES), pick(NOUNS)];
  if (Math.random() < 0.5) parts.push(pick(SUFFIXES));
  return parts.join(" ");
}

/** Returns `count` unique suggestions for the word cloud. */
export function generateCommunityNameSuggestions(count = 9): string[] {
  const seen = new Set<string>();
  let guardRounds = count * 10; // generous ceiling against a pathological unlucky streak

  while (seen.size < count && guardRounds > 0) {
    seen.add(suggestOne());
    guardRounds -= 1;
  }

  return [...seen];
}
