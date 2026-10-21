import { describe, expect, it } from 'vitest';
import { loadAdapters } from './index';

describe('registry', () => {
  it('mock mode returns one adapter per mock merchant', () => {
    const ids = loadAdapters({ mock: true }).map((a) => a.info.id);
    expect(ids).toContain('apotea');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('real adapters have unique ids', () => {
    const ids = loadAdapters().map((a) => a.info.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
