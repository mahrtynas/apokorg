/**
 * Polite HTTP for adapters: one queue per host with a minimum gap between requests,
 * a timeout, and retries with backoff on 429/5xx. Personal-use volumes only.
 */

export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';

export interface PoliteFetchOptions extends RequestInit {
  /** Minimum ms between requests to the same host. Default 1000. */
  minIntervalMs?: number;
  timeoutMs?: number;
  retries?: number;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

const nextSlot = new Map<string, number>();

async function waitForSlot(host: string, minIntervalMs: number, signal?: AbortSignal | null) {
  const now = Date.now();
  const slot = Math.max(now, nextSlot.get(host) ?? 0);
  nextSlot.set(host, slot + minIntervalMs);
  const wait = slot - now;
  if (wait > 0) await sleep(wait, signal);
}

function sleep(ms: number, signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason);
    });
  });
}

export async function politeFetch(url: string, opts: PoliteFetchOptions = {}): Promise<Response> {
  const { minIntervalMs = 1000, timeoutMs = 15000, retries = 2, signal, headers, ...init } = opts;
  const host = new URL(url).host;
  let attempt = 0;
  for (;;) {
    await waitForSlot(host, minIntervalMs, signal);
    const timeout = AbortSignal.timeout(timeoutMs);
    const res = await fetch(url, {
      ...init,
      headers: {
        'user-agent': BROWSER_USER_AGENT,
        'accept-language': 'sv-SE,sv;q=0.9,en;q=0.5',
        ...headers,
      },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (res.ok) return res;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= retries) throw new HttpError(res.status, url);
    attempt++;
    const retryAfter = Number(res.headers.get('retry-after'));
    await sleep(
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt,
      signal,
    );
  }
}

export async function fetchText(url: string, opts?: PoliteFetchOptions): Promise<string> {
  return (await politeFetch(url, opts)).text();
}

export async function fetchJson<T = unknown>(url: string, opts?: PoliteFetchOptions): Promise<T> {
  const res = await politeFetch(url, {
    ...opts,
    headers: { accept: 'application/json', ...opts?.headers },
  });
  return (await res.json()) as T;
}
