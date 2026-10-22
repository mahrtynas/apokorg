/**
 * Readable titles from product URL slugs:
 * `/alvedon-500-mg-filmdragerad-tablett-20-st` → "alvedon 500 mg filmdragerad tablett 20 st".
 */

function words(segment: string): string[] {
  let s = segment;
  try {
    s = decodeURIComponent(s);
  } catch {
    // keep the raw segment
  }
  return s
    .replace(/\.(html?|aspx?|php)$/i, '')
    .toLowerCase()
    .split(/[-_+\s]+/)
    .filter(Boolean);
}

const letterWords = (segment: string) => words(segment).filter((w) => /[a-zåäöéü]/.test(w)).length;

/**
 * Default slug-to-title: the path segment with the most words containing a letter (so SKU
 * segments such as `6004052-001R.html` lose to the name), split on dashes and underscores.
 */
export function slugToTitle(url: string | URL): string {
  const segments = new URL(url).pathname.split('/').filter(Boolean);
  let best = '';
  let bestScore = -1;
  for (const seg of segments) {
    const score = letterWords(seg);
    if (score > bestScore) {
      best = seg;
      bestScore = score;
    }
  }
  return words(best).join(' ');
}

/** Title from one fixed path segment (0-based), for stores with a known URL shape. */
export function segmentTitle(index: number): (url: string | URL) => string {
  return (url) => words(new URL(url).pathname.split('/').filter(Boolean)[index] ?? '').join(' ');
}
