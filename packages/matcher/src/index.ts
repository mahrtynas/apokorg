export { normalize, normalizeBasic, tokenize, KNOWN_BRANDS } from './normalize';
export {
  parseQuery,
  detectBrand,
  offerFeatures,
  type ParsedQuery,
  type Strength,
  type OfferFeatures,
} from './query';
export { matchOffers, matchOffersSync, needsConfirmation, type MatchOptions } from './match';
export {
  createClaudeJudge,
  LLM_MODEL,
  type LlmJudge,
  type JudgeRequest,
  type JudgeDecision,
  type JudgeCandidate,
  type ClaudeJudgeOptions,
  type MessagesClient,
} from './llm';
export { queryKey, rememberChoice, forgetChoice, recallPinned, type MatchMemory } from './memory';
export { groupProducts, titleKey } from './group';
