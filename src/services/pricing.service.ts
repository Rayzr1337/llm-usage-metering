import { TOKEN_PRICING_MICROCENTS, API_CALL_PRICE_MICROCENTS } from "../config/plans";

interface TokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export class PricingService {
  calculateTokenCostMicroCents(usage: TokenUsage): number {
    const { inputTokens, cachedInputTokens, outputTokens, reasoningTokens } = usage;

    const inputCost = inputTokens * TOKEN_PRICING_MICROCENTS.input;
    const cachedInputCost = cachedInputTokens * TOKEN_PRICING_MICROCENTS.cachedInput;
    const outputCost = (outputTokens + reasoningTokens) * TOKEN_PRICING_MICROCENTS.output;

    return inputCost + cachedInputCost + outputCost;
  }

  calculateApiCallCostMicroCents(callCount: number): number {
    return callCount * API_CALL_PRICE_MICROCENTS;
  }

  microCentsToCents(microCents: number): number {
    return Math.round(microCents / 10_000);
  }

  microCentsToDollarsDisplay(microCents: number): string {
    return (microCents / 1_000_000).toFixed(4);
  }
}

export const pricingService = new PricingService();