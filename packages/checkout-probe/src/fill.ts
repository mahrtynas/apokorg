import type { api, CartFillRequest, MerchantAdapter } from '@apokorg/core';
import type { BrowserContext, Page } from 'playwright-core';
import { ProbeError, errorCode } from './errors';
import { createGuardedPage, installRequestGuard } from './guard';
import { launch, untilAborted, type BrowserLaunch } from './run';

export const CART_FILL_TIMEOUT_MS = 120_000;

export interface RunCartFillOptions {
  /** Kept between fills, so the user's logins and the cart survive. */
  profileDir: string;
  /** For the script, browser start included. Default 120 s. */
  timeoutMs?: number;
  /** Timeout per guarded action. Default 10 s. */
  actionTimeoutMs?: number;
  launch?: BrowserLaunch;
  /** Default false: the user finishes the order in this window. Tests run headless. */
  headless?: boolean;
}

export type CartFillOutcome = Omit<api.FillCartResponse, 'merchantId'>;

/** One browser per profile directory, reused while its window is open. */
const browsers = new Map<string, Promise<BrowserContext>>();
/** Fills of one profile run one after another. */
const queues = new Map<string, Promise<unknown>>();

function browserFor(opts: RunCartFillOptions, timeoutMs: number): Promise<BrowserContext> {
  let ctx = browsers.get(opts.profileDir);
  if (!ctx) {
    ctx = launch(opts.profileDir, opts.launch, timeoutMs, opts.headless ?? false);
    browsers.set(opts.profileDir, ctx);
    ctx.then(
      (c) => c.on('close', () => browsers.delete(opts.profileDir)),
      () => browsers.delete(opts.profileDir),
    );
  }
  return ctx;
}

/** A blank start-up tab is reused; otherwise each fill opens its own tab. */
async function tab(context: BrowserContext): Promise<Page> {
  const blank = context.pages().find((p) => p.url() === 'about:blank');
  return blank ?? (await context.newPage());
}

/**
 * Runs `adapter.fillCart` in a visible Edge window and leaves the page it stops on (the
 * checkout) open for the user. The script gets the probe's guarded page, which here also
 * accepts quantities; the request guard is only on while the script runs, so the user can
 * pay afterwards. Never throws: errors become a `failed` outcome whose message starts with the
 * error code. On a timeout the tab is closed so the script can't carry on unguarded.
 */
export function runCartFill(
  adapter: MerchantAdapter,
  request: CartFillRequest,
  opts: RunCartFillOptions,
): Promise<CartFillOutcome> {
  const prev = queues.get(opts.profileDir) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(() => fillOnce(adapter, request, opts));
  queues.set(opts.profileDir, next);
  return next;
}

async function fillOnce(
  adapter: MerchantAdapter,
  request: CartFillRequest,
  opts: RunCartFillOptions,
): Promise<CartFillOutcome> {
  const fill = adapter.fillCart;
  if (!fill)
    return { status: 'unsupported', message: 'no cart script for this store', skipped: [] };

  const timeoutMs = opts.timeoutMs ?? CART_FILL_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new ProbeError('timeout', `cart fill took longer than ${timeoutMs} ms`)),
    timeoutMs,
  );
  const onAbort = () => controller.abort(request.signal?.reason);
  request.signal?.addEventListener('abort', onAbort, { once: true });
  if (request.signal?.aborted) onAbort();

  const violations: string[] = [];
  let removeGuard: (() => Promise<void>) | undefined;
  let page: Page | undefined;
  let settled = false;

  try {
    const result = await untilAborted(controller.signal, async () => {
      const context = await browserFor(opts, timeoutMs);
      removeGuard = await installRequestGuard(context, (req) =>
        violations.push(`blocked ${req.method} ${req.url} (${req.reason})`),
      );
      page = await tab(context);
      const guarded = createGuardedPage(page, {
        allowQuantity: true,
        actionTimeoutMs: opts.actionTimeoutMs,
        onViolation: (err) => violations.push(err.message),
      });
      try {
        return await fill({ items: request.items, signal: controller.signal }, guarded);
      } finally {
        settled = true;
      }
    });
    if (violations.length > 0) {
      return { status: 'failed', message: `forbidden-action: ${violations[0]}`, skipped: [] };
    }
    await page?.bringToFront().catch(() => {});
    return { status: 'ok', url: result.url, skipped: result.skipped };
  } catch (err) {
    if (!settled) await page?.close().catch(() => {});
    if (violations.length > 0) {
      return { status: 'failed', message: `forbidden-action: ${violations[0]}`, skipped: [] };
    }
    const detail = err instanceof Error ? err.message : String(err);
    const code = errorCode(err);
    return {
      status: code === 'login-required' ? 'unsupported' : 'failed',
      message: `${code}: ${detail}`,
      skipped: [],
    };
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener('abort', onAbort);
    await removeGuard?.().catch(() => {});
  }
}

/** Closes every browser a cart fill opened, e.g. when the server shuts down. */
export async function closeCartBrowsers(): Promise<void> {
  const all = [...browsers.values()];
  browsers.clear();
  await Promise.all(all.map((c) => c.then((ctx) => ctx.close()).catch(() => {})));
}
