/**
 * Canonical anchoring — the boring, hard part that makes a Board survive
 * a listing being revisited a week later with different tracking params,
 * a different price, or a personalized layout.
 *
 * Strategy, in order:
 *  1. Site-aware extractors for common shopping/listing domains: pull the
 *     stable listing/product ID straight out of the URL path, since that's
 *     the one thing sites rarely change even when everything else does.
 *  2. <link rel="canonical"> if the page declares one.
 *  3. Generic fallback: origin + pathname with tracking/query noise
 *     stripped, so at least UTM params and session IDs don't fork items.
 *
 * This runs in the content script, against the page currently open in
 * the tab — never against mirrored or third-party content.
 */

export interface PageAnchor {
  canonicalKey: string;
  url: string;
  title: string;
  image?: string;
  siteName?: string;
}

const TRACKING_PARAM_PREFIXES = ["utm_", "ref", "fbclid", "gclid", "igshid"];

interface SiteExtractor {
  test: (url: URL) => boolean;
  extract: (url: URL) => string | null;
  siteName: string;
}

const SITE_EXTRACTORS: SiteExtractor[] = [
  {
    siteName: "Airbnb",
    test: (u) => /(^|\.)airbnb\./.test(u.hostname),
    extract: (u) => {
      const match = u.pathname.match(/\/rooms\/(\d+)/);
      return match ? `airbnb:${match[1]}` : null;
    },
  },
  {
    siteName: "Amazon",
    test: (u) => /(^|\.)amazon\./.test(u.hostname),
    extract: (u) => {
      const match = u.pathname.match(/\/dp\/([A-Z0-9]{10})/i);
      return match ? `amazon:${match[1].toUpperCase()}` : null;
    },
  },
  {
    siteName: "Zillow",
    test: (u) => /(^|\.)zillow\.com$/.test(u.hostname),
    extract: (u) => {
      const match = u.pathname.match(/\/(\d+)_zpid/);
      return match ? `zillow:${match[1]}` : null;
    },
  },
  {
    siteName: "Booking.com",
    test: (u) => /(^|\.)booking\.com$/.test(u.hostname),
    extract: (u) => {
      const match = u.pathname.match(/\/hotel\/[a-z]{2}\/([a-z0-9-]+)\.html/i);
      return match ? `booking:${match[1].toLowerCase()}` : null;
    },
  },
  {
    siteName: "Etsy",
    test: (u) => /(^|\.)etsy\.com$/.test(u.hostname),
    extract: (u) => {
      const match = u.pathname.match(/\/listing\/(\d+)/);
      return match ? `etsy:${match[1]}` : null;
    },
  },
];

function stripTrackingParams(url: URL): URL {
  const clean = new URL(url.toString());
  const toDelete: string[] = [];

  for (const key of clean.searchParams.keys()) {
    if (TRACKING_PARAM_PREFIXES.some((prefix) => key.toLowerCase().startsWith(prefix))) {
      toDelete.push(key);
    }
  }
  for (const key of toDelete) clean.searchParams.delete(key);

  return clean;
}

function metaContent(name: string): string | undefined {
  const el =
    document.querySelector(`meta[property="${name}"]`) ??
    document.querySelector(`meta[name="${name}"]`);
  return el?.getAttribute("content")?.trim() || undefined;
}

/** Read the current page's stable anchor. Call from a content script context. */
export function readPageAnchor(): PageAnchor {
  const url = new URL(window.location.href);

  let canonicalKey: string | null = null;
  let siteName: string | undefined;

  for (const extractor of SITE_EXTRACTORS) {
    if (!extractor.test(url)) continue;
    const key = extractor.extract(url);
    if (key) {
      canonicalKey = key;
      siteName = extractor.siteName;
      break;
    }
  }

  if (!canonicalKey) {
    const canonicalLink = document
      .querySelector('link[rel="canonical"]')
      ?.getAttribute("href");

    if (canonicalLink) {
      try {
        canonicalKey = new URL(canonicalLink, url).toString();
      } catch {
        canonicalKey = null;
      }
    }
  }

  if (!canonicalKey) {
    const stripped = stripTrackingParams(url);
    canonicalKey = `${stripped.origin}${stripped.pathname}`;
  }

  const title =
    metaContent("og:title") ||
    document.title ||
    url.hostname;

  const image = metaContent("og:image");
  siteName = siteName || metaContent("og:site_name") || url.hostname;

  return {
    canonicalKey,
    url: url.toString(),
    title: title.slice(0, 200),
    image,
    siteName,
  };
}
