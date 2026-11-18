import type { GuardedPage } from '@apokorg/core';
import {
  errors,
  type BrowserContext,
  type ElementHandle,
  type Page,
  type Route,
} from 'playwright-core';
import { ForbiddenActionError, ProbeError, type GuardedAction } from './errors';
import {
  blockedRequest,
  forbiddenField,
  isQuantityField,
  matchDenylist,
  paymentProvider,
  urlWords,
  type FieldInfo,
} from './rules';

export interface GuardOptions {
  /** The only two text values `fill` accepts. A cart fill passes neither. */
  postcode?: string;
  email?: string;
  /** Also accept a quantity (1 to 999) in a quantity field. For cart fills only. */
  allowQuantity?: boolean;
  /** Called for every refused action, even when the probe script catches the error. */
  onViolation?: (err: ForbiddenActionError) => void;
  /** Timeout for resolving a selector. Default 10 s. */
  actionTimeoutMs?: number;
}

/**
 * In-page code is kept as source text so bundlers (tsx, vitest) can't inject helpers into it
 * that don't exist in the browser.
 */
function pageFn<A, R>(src: string): (arg: A) => R {
  return new Function(`return (${src});`)() as (arg: A) => R;
}

interface ClickInfo {
  texts: string[];
  urls: string[];
  submitLike: boolean;
}

const inspectClick = pageFn<unknown, ClickInfo>(`(el) => {
  const texts = [];
  const urls = [];
  const add = (s) => { if (typeof s === 'string' && s.trim()) texts.push(s); };
  const control = el.closest('button, a, input, summary, label, [role=button], [role=link], [role=menuitem], [onclick]') || el;
  const nodes = control === el ? [el] : [el, control];
  if (control.tagName === 'LABEL' && control.control) nodes.push(control.control);
  let submitLike = false;
  for (const n of nodes) {
    add(n.innerText);
    add(n.textContent);
    for (const a of ['value', 'aria-label', 'title', 'alt', 'data-action']) add(n.getAttribute(a));
    for (const id of (n.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean)) {
      add(document.getElementById(id)?.textContent);
    }
    for (const c of n.querySelectorAll('img[alt], [aria-label], [title]')) {
      add(c.getAttribute('alt'));
      add(c.getAttribute('aria-label'));
      add(c.getAttribute('title'));
    }
    const tag = n.tagName;
    const type = (n.getAttribute('type') || '').toLowerCase();
    if (tag === 'BUTTON' && type !== 'reset') submitLike = true;
    if (tag === 'INPUT' && ['submit', 'image', 'button'].includes(type)) submitLike = true;
    if (n.getAttribute('role') === 'button') submitLike = true;
    if (tag === 'INPUT' && ['submit', 'image', 'button'].includes(type)) add(n.value);
    const form = n.form || n.closest('form');
    if (form) urls.push(form.getAttribute('action') || '');
    if (n.getAttribute('formaction')) urls.push(n.getAttribute('formaction'));
    if (tag === 'A' && n.getAttribute('href')) urls.push(n.getAttribute('href'));
  }
  return { texts, urls, submitLike };
}`);

const inspectField = pageFn<unknown, FieldInfo>(`(el) => {
  const target = el.tagName === 'LABEL' && el.control ? el.control : el;
  const descriptors = [];
  const add = (s) => { if (typeof s === 'string' && s.trim()) descriptors.push(s); };
  for (const n of target === el ? [el] : [el, target]) {
    for (const a of ['name', 'id', 'autocomplete', 'placeholder', 'aria-label', 'title', 'data-testid']) {
      add(n.getAttribute(a));
    }
    for (const id of (n.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean)) {
      add(document.getElementById(id)?.textContent);
    }
    if (n.labels) for (const l of n.labels) add(l.textContent);
    add(n.closest('label')?.textContent);
  }
  return {
    tag: target.tagName.toLowerCase(),
    type: (target.getAttribute('type') || '').toLowerCase(),
    descriptors,
  };
}`);

const frameHints = pageFn<unknown, string[]>(`(el) =>
  ['src', 'id', 'name', 'title', 'class'].map((a) => el.getAttribute(a) || '')`);

/** evaluateJson is for reading the page. Anything that looks like it acts on it is refused. */
const SIDE_EFFECT_RE =
  /\.click\s*\(|\.submit\s*\(|requestSubmit|dispatchEvent|\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|\.value\s*=(?!=)|\.checked\s*=(?!=)|location\s*=(?!=)|location\.(?:assign|replace|reload|href\s*=(?!=))|window\.open|innerHTML\s*=(?!=)|postMessage|\beval\s*\(|Function\s*\(|import\s*\(|localStorage|sessionStorage|document\.cookie\s*=(?!=)/;

/** Returns the payment provider whose frame holds `el`, or null. */
async function paymentFrameOf(el: ElementHandle): Promise<string | null> {
  let frame = await el.ownerFrame();
  while (frame) {
    const parent = frame.parentFrame();
    if (!parent) {
      // A top-level page on a provider's own host (hosted payment page).
      let host = '';
      try {
        host = new URL(frame.url()).hostname;
      } catch {
        // about:blank and the like
      }
      return paymentProvider(host);
    }
    const owner = await frame.frameElement();
    const hints = await owner.evaluate(frameHints).finally(() => owner.dispose());
    const provider = paymentProvider(frame.url(), frame.name(), ...hints);
    if (provider) return provider;
    frame = parent;
  }
  return null;
}

/** Playwright's selector timeouts and strict-mode errors mean the page isn't what the script expects. */
function asLayoutChanged(err: unknown, selector: string): unknown {
  if (err instanceof errors.TimeoutError) {
    return new ProbeError('layout-changed', `selector not found: ${selector}`);
  }
  if (err instanceof Error && /strict mode violation/i.test(err.message)) {
    return new ProbeError('layout-changed', `selector is ambiguous: ${selector}`);
  }
  return err;
}

/**
 * Wraps a Playwright page in the only surface probe scripts get. Every click is checked
 * against the denylist and payment iframes, every fill against the allowed values and the
 * forbidden field types.
 */
export function createGuardedPage(page: Page, opts: GuardOptions): GuardedPage {
  const timeout = opts.actionTimeoutMs ?? 10_000;
  const allowed = new Set(
    [opts.postcode && compact(opts.postcode), opts.email?.trim().toLowerCase()].filter(Boolean),
  );

  const refuse = (action: GuardedAction, target: string, reason: string): never => {
    const err = new ForbiddenActionError(action, target, reason);
    opts.onViolation?.(err);
    throw err;
  };

  const resolve = async (selector: string): Promise<ElementHandle> => {
    try {
      return await page.locator(selector).elementHandle({ timeout });
    } catch (err) {
      throw asLayoutChanged(err, selector);
    }
  };

  return {
    async goto(url) {
      let u: URL;
      try {
        u = new URL(url);
      } catch {
        return refuse('goto', url, 'not an absolute URL');
      }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        refuse('goto', url, `protocol ${u.protocol} is not allowed`);
      }
      const reason = blockedRequest(url, 'GET');
      if (reason) refuse('goto', url, reason);
      const matched = matchDenylist(urlWords(url));
      if (matched) refuse('goto', url, `URL matches "${matched}"`);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    },

    async click(selector) {
      const el = await resolve(selector);
      try {
        const info = await el.evaluate(inspectClick);
        for (const text of info.texts) {
          const matched = matchDenylist(text);
          if (matched) refuse('click', selector, `text matches "${matched}"`);
        }
        for (const url of info.urls) {
          const matched = matchDenylist(urlWords(url));
          if (matched) refuse('click', selector, `form or link target matches "${matched}"`);
          const reason = blockedRequest(absolute(url, page.url()), 'POST');
          if (reason) refuse('click', selector, `form or link target is ${reason}`);
        }
        const provider = await paymentFrameOf(el);
        if (provider && info.submitLike) {
          refuse('click', selector, `button inside a ${provider} payment frame`);
        }
        await el.click({ timeout }).catch((err) => {
          throw asLayoutChanged(err, selector);
        });
      } finally {
        await el.dispose().catch(() => {});
      }
    },

    async fill(selector, value) {
      const v = value.includes('@') ? value.trim().toLowerCase() : compact(value);
      const quantity = opts.allowQuantity === true && /^[1-9]\d{0,2}$/.test(v);
      if (!quantity && !allowed.has(v)) {
        refuse('fill', selector, 'value is neither the probe postcode nor the probe email');
      }
      const el = await resolve(selector);
      try {
        const info = await el.evaluate(inspectField);
        const reason = forbiddenField(info);
        if (reason) refuse('fill', selector, reason);
        if (quantity && !allowed.has(v) && !isQuantityField(info)) {
          refuse('fill', selector, 'a number may only go in a quantity field');
        }
        await el.fill(value, { timeout }).catch((err) => {
          throw asLayoutChanged(err, selector);
        });
      } finally {
        await el.dispose().catch(() => {});
      }
    },

    async textContent(selector) {
      try {
        return await page.locator(selector).textContent({ timeout });
      } catch (err) {
        throw asLayoutChanged(err, selector);
      }
    },

    async waitFor(selector, timeoutMs = timeout) {
      try {
        await page.locator(selector).first().waitFor({ timeout: timeoutMs });
      } catch (err) {
        throw asLayoutChanged(err, selector);
      }
    },

    async evaluateJson<T>(fn: string): Promise<T> {
      const m = SIDE_EFFECT_RE.exec(fn);
      if (m) refuse('evaluateJson', fn.slice(0, 80), `"${m[0]}" is not read-only`);
      // `fn` is a function source or an expression; functions are called, promises awaited.
      const json = await page.evaluate<string>(
        `(async () => { const v = (${fn}); const r = typeof v === 'function' ? await v() : await v; return JSON.stringify(r === undefined ? null : r); })()`,
      );
      return JSON.parse(json) as T;
    },
  };
}

function absolute(url: string, base: string): string {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

function compact(s: string): string {
  return s.replace(/\s+/g, '');
}

export interface BlockedRequest {
  url: string;
  method: string;
  reason: string;
}

/**
 * The second safety net: aborts every request to an order or payment endpoint. Resolves with a
 * function that removes it again, for when a cart fill hands the browser to the user.
 */
export async function installRequestGuard(
  context: BrowserContext,
  onBlocked: (req: BlockedRequest) => void,
): Promise<() => Promise<void>> {
  const handler = (route: Route) => {
    const req = route.request();
    const reason = blockedRequest(req.url(), req.method());
    if (reason) {
      onBlocked({ url: req.url(), method: req.method(), reason });
      return route.abort('blockedbyclient');
    }
    return route.fallback();
  };
  await context.route('**/*', handler);
  return () => context.unroute('**/*', handler);
}
