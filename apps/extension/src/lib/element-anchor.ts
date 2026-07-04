/**
 * Element anchoring — position things relative to page ELEMENTS instead
 * of page-level coordinates.
 *
 * Why: percent-of-document coordinates break twice on real pages.
 * Lazy-loaded content keeps changing the document height, so a
 * document-percent pin drifts away from what it was placed on. And two
 * people's documents are DIFFERENT heights (personalization, ads, lazy
 * state), so the same percent lands on different content — a cursor at
 * "40% down" is in section 2 for one person and section 4 for another.
 *
 * An element anchor is a stable-ish CSS path to the nearest useful
 * element plus percentage offsets WITHIN that element. Same element =
 * same content = same spot, regardless of what the rest of the page is
 * doing. Page-percent coordinates are kept as the fallback when the
 * selector no longer resolves.
 */

export interface ElementAnchor {
  /** CSS path, e.g. "#site-content > div:nth-of-type(2) > section:nth-of-type(3)" */
  selector: string;
  /** Offsets within the element, as percentages of its box. */
  elXPercent: number;
  elYPercent: number;
}

const MAX_DEPTH = 7;

/** Build a CSS path for an element: nearest id ancestor, then nth-of-type hops. */
export function buildSelector(element: Element): string | null {
  const parts: string[] = [];
  let current: Element | null = element;
  let depth = 0;

  while (current && current !== document.body && depth < MAX_DEPTH) {
    if (current.id && /^[A-Za-z][\w-]*$/.test(current.id)) {
      parts.unshift(`#${CSS.escape(current.id)}`);
      return parts.join(" > ");
    }

    const tag = current.tagName.toLowerCase();
    if (tag === "html" || tag === "body") break;

    let index = 1;
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === current.tagName) index += 1;
      sibling = sibling.previousElementSibling;
    }
    parts.unshift(`${tag}:nth-of-type(${index})`);

    current = current.parentElement;
    depth += 1;
  }

  if (parts.length === 0) return null;
  return `body > ${parts.join(" > ")}`;
}

/** Pick a sensible anchor element for a page point: the topmost real
 *  element there, lifted to a parent when the hit is tiny/inline. */
function anchorElementAt(clientX: number, clientY: number): Element | null {
  let element: Element | null = null;
  try {
    element = document.elementFromPoint(clientX, clientY);
  } catch {
    return null;
  }
  if (!element || element === document.documentElement) return null;

  // Inline fragments (spans, bold, links) move around too easily —
  // anchor to a block-ish parent instead.
  const INLINE = new Set(["SPAN", "B", "I", "EM", "STRONG", "A", "SMALL", "SUP", "SUB"]);
  let hops = 0;
  while (element.parentElement && INLINE.has(element.tagName) && hops < 3) {
    element = element.parentElement;
    hops += 1;
  }
  return element;
}

/** Anchor a page point (client coords) to the element under it. */
export function anchorForPoint(
  clientX: number,
  clientY: number
): ElementAnchor | null {
  let element = anchorElementAt(clientX, clientY);

  // A selector must resolve back to its element to be a usable anchor.
  // Messy DOMs (duplicated subtrees, unstable ids) can fail validation
  // on the exact hit — walk up a few parents until one validates.
  for (let attempt = 0; element && attempt < 4; attempt += 1) {
    const selector = buildSelector(element);
    if (selector) {
      let resolved: Element | null = null;
      try {
        resolved = document.querySelector(selector);
      } catch {
        resolved = null;
      }
      if (resolved === element) {
        const rect = element.getBoundingClientRect();
        if (rect.width >= 1 && rect.height >= 1) {
          return {
            selector,
            elXPercent: Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)),
            elYPercent: Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100)),
          };
        }
      }
    }
    element = element.parentElement;
  }

  return null;
}

/** Resolve an anchor back to absolute PAGE coordinates, or null if the
 *  element no longer exists (caller falls back to page-percent). */
export function resolveAnchorToPagePoint(
  anchor: ElementAnchor
): { pageX: number; pageY: number } | null {
  let element: Element | null = null;
  try {
    element = document.querySelector(anchor.selector);
  } catch {
    return null;
  }
  if (!element) return null;

  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;

  return {
    pageX: rect.left + window.scrollX + (rect.width * anchor.elXPercent) / 100,
    pageY: rect.top + window.scrollY + (rect.height * anchor.elYPercent) / 100,
  };
}
