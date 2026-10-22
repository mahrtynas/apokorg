/**
 * Error codes a probe can end with. `login-required` maps to status `unsupported`; the rest map
 * to `failed`. The code is always the start of `ProbeResult.message`, e.g. `timeout: …`.
 */
export type ProbeErrorCode =
  | 'edge-not-found'
  | 'login-required'
  | 'timeout'
  | 'layout-changed'
  | 'forbidden-action'
  | 'invalid-result'
  | 'probe-error';

/**
 * Thrown by the framework, and by probe scripts for `login-required` and `layout-changed`.
 * Scripts that don't want to depend on this package can throw any error with a matching
 * `code` property instead.
 */
export class ProbeError extends Error {
  override name = 'ProbeError';
  constructor(
    readonly code: ProbeErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type GuardedAction = 'goto' | 'click' | 'fill' | 'evaluateJson';

/** The guard refused an action. A probe that hit one is always reported as failed. */
export class ForbiddenActionError extends Error {
  override name = 'ForbiddenActionError';
  constructor(
    readonly action: GuardedAction,
    readonly target: string,
    readonly reason: string,
  ) {
    super(`refused ${action} on ${target}: ${reason}`);
  }
}

const CODES = new Set<string>([
  'edge-not-found',
  'login-required',
  'timeout',
  'layout-changed',
  'forbidden-action',
  'invalid-result',
  'probe-error',
]);

/** Reads the error code of anything a probe threw. */
export function errorCode(err: unknown): ProbeErrorCode {
  if (err instanceof ForbiddenActionError) return 'forbidden-action';
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && CODES.has(code)) return code as ProbeErrorCode;
  return 'probe-error';
}
