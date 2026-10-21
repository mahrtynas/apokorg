import type { ProductOffer } from '@apokorg/core';
import { describe, expect, it, vi } from 'vitest';
import { createClaudeJudge, type JudgeDecision, type LlmJudge, type MessagesClient } from './llm';
import { matchOffers, matchOffersSync, needsConfirmation } from './match';
import { forgetChoice, queryKey, recallPinned, rememberChoice } from './memory';
import { kinds, mockCatalogOffers, offer } from './test-helpers';

const twins: ProductOffer[] = [
  offer('gymgrossisten', 'n1', 'Nocco BCAA Caribbean 330 ml'),
  offer('gymgrossisten', 'n2', 'NOCCO BCAA Caribbean 330ml burk'),
  offer('apotea', 'n3', 'Nocco BCAA Caribbean 330 ml', { ean: '7340001802127' }),
];

function fakeJudge(decision: JudgeDecision | Error): LlmJudge & { pick: ReturnType<typeof vi.fn> } {
  return {
    pick: vi.fn(async () => {
      if (decision instanceof Error) throw decision;
      return decision;
    }),
  };
}

describe('matchOffers with an LLM judge', () => {
  it('asks the judge only for near-ties and follows its pick', async () => {
    const llm = fakeJudge({ choice: 'n2', confidence: 0.9, reason: 'same can' });
    const results = await matchOffers('nocco bcaa caribbean', twins, {
      llm,
      acceptSubstitutes: true,
    });
    expect(llm.pick).toHaveBeenCalledTimes(1);
    const req = llm.pick.mock.calls[0]![0];
    expect(req.merchantId).toBe('gymgrossisten');
    expect(req.candidates.map((c: { id: string }) => c.id).sort()).toEqual(['n1', 'n2']);
    expect(kinds(results)).toMatchObject({ n2: 'equivalent', n1: 'substitute', n3: 'equivalent' });
    const n2 = results.find((r) => r.offer.merchantProductId === 'n2')!;
    expect(n2.confidence).toBeGreaterThanOrEqual(0.9);
    expect(n2.reasons.join(' ')).toContain('claude-haiku-5-5');
  });

  it('demotes all tied listings when the judge rejects them', async () => {
    const llm = fakeJudge({ choice: null, confidence: 0.8, reason: 'none is the drink' });
    const results = await matchOffers('nocco bcaa caribbean', twins, { llm });
    expect(results.map((r) => r.offer.merchantProductId)).toEqual(['n3']);
  });

  it('falls back to the heuristic when the judge fails', async () => {
    const llm = fakeJudge(new Error('network down'));
    const withLlm = await matchOffers('nocco bcaa caribbean', twins, { llm });
    expect(withLlm).toEqual(matchOffersSync('nocco bcaa caribbean', twins));
  });

  it('does not call the judge when nothing is ambiguous', async () => {
    const llm = fakeJudge({ choice: null, confidence: 1, reason: '' });
    await matchOffers('alvedon 500 20st', await mockCatalogOffers(), { llm });
    expect(llm.pick).not.toHaveBeenCalled();
  });
});

describe('createClaudeJudge', () => {
  it('is skipped without an API key', () => {
    expect(createClaudeJudge({})).toBeUndefined();
    expect(createClaudeJudge({ anthropicApiKey: '  ' })).toBeUndefined();
  });

  it('sends a structured-output request to claude-haiku-5-5 and validates the choice', async () => {
    const parse = vi.fn(async () => ({
      stop_reason: 'end_turn',
      parsed_output: { choice: 'x2', confidence: 1.4, reason: 'same size' },
    }));
    const client = { messages: { parse } } as unknown as MessagesClient;
    const judge = createClaudeJudge({ anthropicApiKey: 'sk-test' }, { client })!;
    const decision = await judge.pick({
      query: 'nivea creme',
      merchantId: 'apotea',
      candidates: [
        { id: 'x1', title: 'Nivea Creme 30 ml' },
        { id: 'x2', title: 'Nivea Creme 150 ml' },
      ],
    });
    expect(decision).toEqual({ choice: 'x2', confidence: 1, reason: 'same size' });
    const [params] = parse.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(params.model).toBe('claude-haiku-5-5');
    expect(params).toHaveProperty('output_config.format');
  });

  it('treats an unknown id as a rejection', async () => {
    const parse = vi.fn(async () => ({
      stop_reason: 'end_turn',
      parsed_output: { choice: 'made-up', confidence: 0.9, reason: '?' },
    }));
    const client = { messages: { parse } } as unknown as MessagesClient;
    const judge = createClaudeJudge({}, { client })!;
    const d = await judge.pick({
      query: 'q',
      merchantId: 'doz',
      candidates: [{ id: 'a', title: 'A' }],
    });
    expect(d.choice).toBeNull();
  });
});

describe('needsConfirmation', () => {
  it('is false when an exact match reaches 0.8', async () => {
    const r = matchOffersSync('alvedon 500 mg 20 st', await mockCatalogOffers());
    expect(needsConfirmation(r)).toBe(false);
  });

  it('is true when nothing matches', () => {
    expect(needsConfirmation(matchOffersSync('voltaren gel', twins))).toBe(true);
  });
});

describe('result shape', () => {
  it('keeps at most one exact/equivalent per merchant', async () => {
    const results = matchOffersSync('nivea', await mockCatalogOffers(), {
      acceptSubstitutes: true,
    });
    const primaries = results.filter((r) => r.kind !== 'substitute').map((r) => r.offer.merchantId);
    expect(new Set(primaries).size).toBe(primaries.length);
  });

  it('explains its decisions', async () => {
    const [first] = matchOffersSync('alvedon 500 20st', await mockCatalogOffers());
    expect(first!.reasons).toEqual(expect.arrayContaining(['brand matches', 'pack count matches']));
  });
});

describe('performance', () => {
  it('matches 100 offers in under 5 ms without the LLM', async () => {
    const mock = await mockCatalogOffers();
    const offers = Array.from({ length: 100 }, (_, i) => ({
      ...mock[i % mock.length]!,
      merchantProductId: `id-${i}`,
    }));
    for (let i = 0; i < 20; i++) matchOffersSync('alvedon 500 20st', offers); // warm up
    const runs = 50;
    const start = performance.now();
    for (let i = 0; i < runs; i++) matchOffersSync('la roche posay anthelios spf50 50 ml', offers);
    const perCall = (performance.now() - start) / runs;
    expect(perCall).toBeLessThan(5);
  });
});

describe('memory', () => {
  it('keys queries independent of order, case and spacing', () => {
    expect(queryKey('Alvedon 500 20 st')).toBe(queryKey('20st alvedon  500'));
  });

  it('remembers, recalls and forgets choices without mutating', () => {
    const empty = {};
    const m1 = rememberChoice(empty, 'alvedon 500 20st', 'apotea', 'a1');
    const m2 = rememberChoice(m1, 'Alvedon 500 20 st', 'doz', 'd1');
    expect(empty).toEqual({});
    expect(recallPinned(m2, 'alvedon 500 20st')).toEqual({ apotea: 'a1', doz: 'd1' });
    expect(recallPinned(m2, 'alvedon 500 20st', { doz: 'mine' })).toEqual({
      apotea: 'a1',
      doz: 'mine',
    });
    const m3 = forgetChoice(m2, 'alvedon 500 20st', 'apotea');
    expect(recallPinned(m3, 'alvedon 500 20st')).toEqual({ doz: 'd1' });
    expect(forgetChoice(forgetChoice(m3, 'alvedon 500 20st', 'doz'), 'x', 'doz')).toEqual({});
  });
});
