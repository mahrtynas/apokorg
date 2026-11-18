import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProbeResult, type MerchantAdapter, type ProbeRequest } from '@apokorg/core';
import { chromium, type BrowserContext } from 'playwright-core';
import { ProbeError, errorCode } from './errors';
import { createGuardedPage, installRequestGuard } from './guard';

export const PROBE_TIMEOUT_MS = 60_000;

export interface BrowserLaunch {
  /** Default 'msedge'. Tests may pass 'chrome' or undefined (bundled Chromium). */
  channel?: string;
  executablePath?: string;
}

export interface RunProbeOptions {
  /** Order value the probe is run for; used in failure results. Default 0. */
  orderValue?: number;
  /** Global timeout for the whole probe, browser start included. Default 60 s. */
  timeoutMs?: number;
  /** Timeout per guarded action. Default 10 s. */
  actionTimeoutMs?: number;
  launch?: BrowserLaunch;
  /** Where the temporary profile directory is created. Default the OS temp dir. */
  profileRoot?: string;
  now?: () => Date;
}

/**
 * Runs `adapter.probe` in a headless Edge with a fresh profile and returns its result. Never
 * throws: errors become a `failed` result (or `unsupported` for login-required) whose message
 * starts with the error code. The browser is closed and the profile deleted in every case.
 */
export async function runProbe(
  adapter: MerchantAdapter,
  request: ProbeRequest,
  opts: RunProbeOptions = {},
): Promise<ProbeResult> {
  const now = opts.now ?? (() => new Date());
  const result = (status: ProbeResult['status'], message: string): ProbeResult => ({
    merchantId: adapter.info.id,
    orderValue: opts.orderValue ?? 0,
    postcode: request.postcode,
    options: [],
    probedAt: now().toISOString(),
    status,
    message,
  });

  const probe = adapter.probe;
  if (!probe) return result('unsupported', 'no probe script for this store');

  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new ProbeError('timeout', `probe took longer than ${timeoutMs} ms`)),
    timeoutMs,
  );
  const onAbort = () => controller.abort(request.signal?.reason);
  request.signal?.addEventListener('abort', onAbort, { once: true });
  if (request.signal?.aborted) onAbort();

  // Kept even when the script catches the error: a probe that tried something forbidden fails.
  const violations: string[] = [];
  const profileDir = await mkdtemp(join(opts.profileRoot ?? tmpdir(), 'apokorg-probe-'));
  let launching: Promise<BrowserContext> | undefined;

  try {
    const raw = await untilAborted(controller.signal, async () => {
      launching = launch(profileDir, opts.launch, timeoutMs);
      const context = await launching;
      await installRequestGuard(context, (req) =>
        violations.push(`blocked ${req.method} ${req.url} (${req.reason})`),
      );
      const page = context.pages()[0] ?? (await context.newPage());
      const guarded = createGuardedPage(page, {
        postcode: request.postcode,
        email: request.email,
        actionTimeoutMs: opts.actionTimeoutMs,
        onViolation: (err) => violations.push(err.message),
      });
      return probe({ ...request, signal: controller.signal }, guarded);
    });
    if (violations.length > 0) return result('failed', `forbidden-action: ${violations[0]}`);
    const parsed = ProbeResult.safeParse({
      ...raw,
      merchantId: adapter.info.id,
      postcode: request.postcode,
      probedAt: now().toISOString(),
    });
    if (!parsed.success) {
      return result('failed', `invalid-result: ${parsed.error.issues[0]?.message ?? 'bad shape'}`);
    }
    return parsed.data;
  } catch (err) {
    if (violations.length > 0) return result('failed', `forbidden-action: ${violations[0]}`);
    const code = errorCode(err);
    const detail = err instanceof Error ? err.message : String(err);
    return result(code === 'login-required' ? 'unsupported' : 'failed', `${code}: ${detail}`);
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener('abort', onAbort);
    const context = await launching?.catch(() => undefined);
    await context?.close().catch(() => {});
    await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

export async function launch(
  profileDir: string,
  opts: BrowserLaunch = { channel: 'msedge' },
  timeout: number,
  headless = true,
): Promise<BrowserContext> {
  try {
    return await chromium.launchPersistentContext(profileDir, {
      channel: opts.channel,
      executablePath: opts.executablePath,
      headless,
      // A visible window keeps the size the user gives it.
      ...(headless ? {} : { viewport: null }),
      // Requests from service workers would bypass the route interceptor.
      serviceWorkers: 'block',
      acceptDownloads: false,
      locale: 'sv-SE',
      timeout,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message.split('\n')[0] : String(err);
    throw new ProbeError('edge-not-found', `could not start the browser: ${detail}`);
  }
}

/** Resolves with `fn`, or rejects with the signal's reason as soon as it aborts. */
export function untilAborted<T>(signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  const work = fn();
  // Once aborted, closing the browser makes `work` reject; nobody is listening by then.
  work.catch(() => {});
  return new Promise<T>((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    work.then(resolve, reject);
  });
}
