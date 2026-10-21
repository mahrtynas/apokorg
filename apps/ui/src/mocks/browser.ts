import { setupWorker } from 'msw/browser';
import { createHandlers } from './handlers';

/** Starts the in-browser mock API (dev:mock). Unhandled requests (Vite assets) pass through. */
export async function startMockApi(): Promise<void> {
  const worker = setupWorker(...createHandlers(undefined, { latencyMs: 250 }));
  await worker.start({ onUnhandledRequest: 'bypass', quiet: false });
}
