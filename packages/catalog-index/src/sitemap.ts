/**
 * Sitemap and robots.txt parsing. Sitemaps are simple enough that a regex over `<loc>` /
 * `<lastmod>` blocks is reliable, so there is no XML dependency.
 */
import { gunzipSync } from 'node:zlib';
import { politeFetch } from '@apokorg/adapter-kit';

export interface SitemapEntry {
  loc: string;
  lastmod?: string;
}

export type SitemapDoc =
  { kind: 'index'; sitemaps: SitemapEntry[] } | { kind: 'urlset'; urls: SitemapEntry[] };

/** Fetches a URL and returns its raw body. Injected in tests; defaults to `politeFetch`. */
export type FetchBytes = (url: string) => Promise<Uint8Array>;

export const politeFetchBytes: FetchBytes = async (url) =>
  new Uint8Array(await (await politeFetch(url, { timeoutMs: 60_000 })).arrayBuffer());

/** Decodes a sitemap body, gunzipping when it is gzip (by magic bytes, not by file name). */
export function decodeBody(body: Uint8Array): string {
  const gz = body.length > 2 && body[0] === 0x1f && body[1] === 0x8b;
  return new TextDecoder().decode(gz ? gunzipSync(body) : body);
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function xmlText(raw: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw);
  const s = cdata ? cdata[1]! : raw;
  return s
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
        return String.fromCodePoint(code);
      }
      return ENTITIES[e] ?? m;
    })
    .trim();
}

function entries(xml: string, tag: 'sitemap' | 'url'): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  const block = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'g');
  for (const m of xml.matchAll(block)) {
    const body = m[1]!;
    const loc = /<(?:\w+:)?loc>([\s\S]*?)<\/(?:\w+:)?loc>/.exec(body);
    if (!loc) continue;
    const lastmod = /<(?:\w+:)?lastmod>([\s\S]*?)<\/(?:\w+:)?lastmod>/.exec(body);
    out.push(
      lastmod
        ? { loc: xmlText(loc[1]!), lastmod: xmlText(lastmod[1]!) }
        : { loc: xmlText(loc[1]!) },
    );
  }
  return out;
}

export function parseSitemap(xml: string): SitemapDoc {
  if (/<(?:\w+:)?sitemapindex\b/.test(xml))
    return { kind: 'index', sitemaps: entries(xml, 'sitemap') };
  if (/<(?:\w+:)?urlset\b/.test(xml)) return { kind: 'urlset', urls: entries(xml, 'url') };
  throw new Error('Not a sitemap: expected <sitemapindex> or <urlset>');
}

/**
 * `Sitemap:` entries from a robots.txt, restricted to the robots file's own host.
 * Some stores list their sister sites' sitemaps too (Gymgrossisten lists .no, .dk and .fi).
 */
export function robotsSitemaps(robotsTxt: string, robotsUrl: string): string[] {
  const host = new URL(robotsUrl).host;
  const out: string[] = [];
  for (const line of robotsTxt.split(/\r?\n/)) {
    const m = /^\s*sitemap\s*:\s*(\S+)/i.exec(line);
    if (!m) continue;
    try {
      const url = new URL(m[1]!, robotsUrl);
      if (url.host === host && !out.includes(url.href)) out.push(url.href);
    } catch {
      // ignore malformed lines
    }
  }
  return out;
}

export const isRobotsUrl = (url: string) => new URL(url).pathname === '/robots.txt';
