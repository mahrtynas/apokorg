import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { Settings } from '@apokorg/core';
import { z } from 'zod';

export const LLM_MODEL = 'claude-haiku-5-5';

export interface JudgeCandidate {
  /** The offer's merchantProductId. */
  id: string;
  title: string;
  brand?: string;
  size?: string;
  packCount?: number;
}

export interface JudgeRequest {
  query: string;
  merchantId: string;
  candidates: JudgeCandidate[];
}

export interface JudgeDecision {
  /** The chosen candidate id, or null when none of them is the product the user means. */
  choice: string | null;
  /** 0..1 */
  confidence: number;
  reason: string;
}

/**
 * Decides between near-tied candidates at one store. Injected into `matchOffers` so tests can
 * use a fake; the real one is {@link createClaudeJudge}.
 */
export interface LlmJudge {
  pick(request: JudgeRequest): Promise<JudgeDecision>;
}

const Decision = z.object({
  choice: z.string().nullable(),
  confidence: z.number(),
  reason: z.string(),
});

const SYSTEM = `You match products in Swedish online pharmacies, beauty and sport stores.
The user typed a rough product query. You get a few listings from one store that look equally good.
Pick the id of the listing that is the same product the user means (same brand, product line,
variant, strength, size and pack count where the query states them). If the query leaves size or
pack count open, prefer the most common standard size. If none of the listings is that product,
answer with choice null. Give a confidence between 0 and 1 and a short reason in English.`;

/** The parts of the Anthropic client the judge uses, so tests can pass a fake. */
export type MessagesClient = Pick<Anthropic, 'messages'>;

export interface ClaudeJudgeOptions {
  /** Defaults to a client built from `apiKey`. */
  client?: MessagesClient;
  model?: string;
  /** Per-request timeout in ms. Default 10 s. */
  timeoutMs?: number;
}

/**
 * Builds the Claude-backed judge from settings. Returns undefined when no API key is set, which
 * makes the matcher skip the LLM step.
 */
export function createClaudeJudge(
  settings: Pick<Settings, 'anthropicApiKey'>,
  opts: ClaudeJudgeOptions = {},
): LlmJudge | undefined {
  const apiKey = settings.anthropicApiKey?.trim();
  if (!apiKey && !opts.client) return undefined;
  const client = opts.client ?? new Anthropic({ apiKey, maxRetries: 1 });
  const model = opts.model ?? LLM_MODEL;
  return {
    async pick(request) {
      const ids = new Set(request.candidates.map((c) => c.id));
      const response = await client.messages.parse(
        {
          model,
          max_tokens: 1024,
          output_config: { effort: 'low', format: zodOutputFormat(Decision) },
          system: SYSTEM,
          messages: [
            {
              role: 'user',
              content: JSON.stringify({
                query: request.query,
                store: request.merchantId,
                listings: request.candidates,
              }),
            },
          ],
        },
        { timeout: opts.timeoutMs ?? 10_000 },
      );
      const out = response.parsed_output;
      if (!out)
        throw new Error(`Claude returned no decision (stop_reason ${response.stop_reason})`);
      const choice = out.choice !== null && ids.has(out.choice) ? out.choice : null;
      return {
        choice,
        confidence: Math.min(1, Math.max(0, out.confidence)),
        reason: out.reason,
      };
    },
  };
}
