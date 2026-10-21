import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { createMockState, type MockState } from '../mocks/data';
import { createHandlers, type HandlerOptions } from '../mocks/handlers';

export const server = setupServer();

/** Fresh mock API state for one test. Returns the state so tests can inspect it. */
export function mockApi(opts: HandlerOptions = {}): MockState {
  const state = createMockState();
  server.resetHandlers(...createHandlers(state, { probeLatencyMs: 50, ...opts }));
  return state;
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  localStorage.clear();
});
afterAll(() => server.close());
