/**
 * Text Quote Selector (Web Annotation Working Group pattern).
 *
 * A highlight is stored as the selected text plus a bit of surrounding
 * context, not a DOM path or character offset. Re-finding it later means
 * searching the page's text for that quote — which survives markup
 * changes (a wrapped <span>, a re-ordered attribute, a class rename)
 * that would silently break an offset- or path-based anchor.
 */

const CONTEXT_LENGTH = 40;

export interface TextQuote {
  quote: string;
  prefix: string;
  suffix: string;
}

/** Serialize the current window selection, if any, into a Text Quote. */
export function serializeSelection(): TextQuote | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }

  const quote = selection.toString().trim();
  if (!quote) return null;

  const range = selection.getRangeAt(0);
  const fullText = document.body.innerText;

  // Locate this exact range's offset within the page's visible text by
  // measuring a range from the start of the body to the selection start.
  const preRange = range.cloneRange();
  preRange.selectNodeContents(document.body);
  preRange.setEnd(range.startContainer, range.startOffset);
  const startOffset = preRange.toString().length;

  const prefix = fullText
    .slice(Math.max(0, startOffset - CONTEXT_LENGTH), startOffset)
    .replace(/\s+/g, " ");
  const suffix = fullText
    .slice(startOffset + quote.length, startOffset + quote.length + CONTEXT_LENGTH)
    .replace(/\s+/g, " ");

  return { quote, prefix, suffix };
}

/**
 * Re-find a stored Text Quote on the current page and return a Range
 * covering it, or null if the text can no longer be found (page changed
 * too much — the highlight is simply not rendered, never guessed at).
 */
export function resolveTextQuote(selector: TextQuote): Range | null {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

  // Build a flat text index mapping offsets back to (node, localOffset).
  const nodes: Array<{ node: Text; start: number; end: number }> = [];
  let cursor = 0;
  let node: Node | null;

  while ((node = walker.nextNode())) {
    const text = node as Text;
    const length = text.data.length;
    if (length === 0) continue;
    nodes.push({ node: text, start: cursor, end: cursor + length });
    cursor += length;
  }

  const fullText = nodes.map((entry) => entry.node.data).join("");
  const needle = selector.prefix + selector.quote + selector.suffix;
  const searchIn = selector.prefix || selector.suffix ? needle : selector.quote;

  let matchIndex: number;
  if (selector.prefix || selector.suffix) {
    const combinedIndex = fullText.indexOf(searchIn);
    matchIndex = combinedIndex === -1 ? -1 : combinedIndex + selector.prefix.length;
  } else {
    matchIndex = fullText.indexOf(selector.quote);
  }

  if (matchIndex === -1) {
    // Prefix/suffix context didn't match (page changed nearby) — fall
    // back to a bare quote search before giving up entirely.
    matchIndex = fullText.indexOf(selector.quote);
    if (matchIndex === -1) return null;
  }

  const startOffset = matchIndex;
  const endOffset = matchIndex + selector.quote.length;

  const startEntry = nodes.find(
    (entry) => startOffset >= entry.start && startOffset < entry.end
  );
  const endEntry = nodes.find(
    (entry) => endOffset > entry.start && endOffset <= entry.end
  );
  if (!startEntry || !endEntry) return null;

  const range = document.createRange();
  range.setStart(startEntry.node, startOffset - startEntry.start);
  range.setEnd(endEntry.node, endOffset - endEntry.start);
  return range;
}
