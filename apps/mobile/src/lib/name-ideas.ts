/**
 * Community name ideas.
 *
 * Generates plausible, brandable community names by blending curated
 * fragments — the "curated default" path the creation spec requires so
 * the naming screen is never empty. Runs entirely on-device: no
 * network, no latency, works offline, and refresh is instant.
 *
 * If a server-side AI suggestion endpoint is added later, swap the
 * body of `generateNameIdeas` for the fetch and keep this generator as
 * the offline/error fallback — the screen's contract doesn't change.
 */

const ROOTS = [
  "Art", "Show", "Talent", "Culture", "Film", "Craft", "Studio", "Pixel",
  "Story", "Sound", "Frame", "Muse", "Canvas", "Scene", "Vibe", "Maker",
  "Idea", "Design", "Code", "Play", "Beat", "Page", "Lens", "Sketch",
];

const SUFFIXES = [
  "lystic", "buzzr", "flow", "hub", "folk", "verse", "nest", "works",
  "circle", "lab", "space", "loop", "wave", "crew", "club", "yard",
  "forge", "haus", "port", "line",
];

/** Blend a root and suffix, dropping a doubled joint letter so pairs
 *  like Art+tlystic never produce an awkward "tt". */
function blend(root: string, suffix: string): string {
  const last = root[root.length - 1]?.toLowerCase();
  const trimmed = suffix[0] === last ? suffix.slice(1) : suffix;
  return root + trimmed;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Returns `count` distinct name ideas, avoiding anything in `exclude`
 * (typically the batch currently on screen, so "More ideas" always
 * feels fresh rather than reshuffling the same chips).
 */
export function generateNameIdeas(count = 5, exclude: string[] = []): string[] {
  const seen = new Set(exclude.map((s) => s.toLowerCase()));
  const out: string[] = [];
  const roots = shuffle(ROOTS);
  const suffixes = shuffle(SUFFIXES);

  outer: for (const root of roots) {
    for (const suffix of suffixes) {
      const name = blend(root, suffix);
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
      if (out.length >= count) break outer;
    }
  }
  return out;
}
