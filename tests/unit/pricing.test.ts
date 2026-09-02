import { pricingService } from "../../src/services/pricing.service";

describe("pricingService — calculateTokenCostMicroCents", () => {
  test("cached input is priced cheaper than plain input", () => {
    const plain = {
      inputTokens: 1000,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
    };
    const cached = {
      inputTokens: 0,
      cachedInputTokens: 1000,
      outputTokens: 0,
      reasoningTokens: 0,
    };
    const plainCost = pricingService.calculateTokenCostMicroCents(plain);
    const cachedCost = pricingService.calculateTokenCostMicroCents(cached);

    // input rate = 15 microcents, cached rate = 5 microcents
    expect(plainCost).toBe(1000 * 15);
    expect(cachedCost).toBe(1000 * 5);
    expect(plainCost).toBeGreaterThan(cachedCost);
  });

  test("reasoning tokens are billed at the output rate", () => {
    const usage = {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 1000,
      reasoningTokens: 1000,
    };
    // output rate = 60 microcents; reasoning tokens billed as output
    const expected = (1000 + 1000) * 60;
    expect(pricingService.calculateTokenCostMicroCents(usage)).toBe(expected);

    // Sanity: reasoning-only at the same rate as output-only.
    const reasoningOnly = {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 1000,
    };
    const outputOnly = {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 1000,
      reasoningTokens: 0,
    };
    expect(pricingService.calculateTokenCostMicroCents(reasoningOnly)).toBe(
      pricingService.calculateTokenCostMicroCents(outputOnly),
    );
  });

  test("produces exact integer output for a known mixed input", () => {
    const usage = {
      inputTokens: 10_000,
      cachedInputTokens: 5_000,
      outputTokens: 2_000,
      reasoningTokens: 1_000,
    };
    // 10000*15 + 5000*5 + (2000+1000)*60 = 150000 + 25000 + 180000 = 355000
    expect(pricingService.calculateTokenCostMicroCents(usage)).toBe(355_000);
  });
});

describe("pricingService — microCentsToCents", () => {
  test("rounds correctly at the .5 boundary (not truncates)", () => {
    // 36.5 cents in microcents is 365_000; JS Math.round rounds .5 up.
    expect(pricingService.microCentsToCents(365_000)).toBe(37);

    // The mirror: 5_000 microcents = 0.5 cents → 1
    expect(pricingService.microCentsToCents(5_000)).toBe(1);

    // And the negative-boundary case, to lock in the rounding behavior.
    // -4.5 cents → -45_000 microcents → Math.round(-4.5) === -4 (banker's would be -4 too,
    // but Math.round in JS uses "round half toward +Infinity", so -4.5 → -4).
    expect(pricingService.microCentsToCents(-45_000)).toBe(-4);
  });

  test("plain division without rounding component is exact", () => {
    expect(pricingService.microCentsToCents(100_000)).toBe(10);
    expect(pricingService.microCentsToCents(0)).toBe(0);
  });
});

describe("pricingService — calculateApiCallCostMicroCents", () => {
  test("straightforward per-call multiplication", () => {
    // API_CALL_PRICE_MICROCENTS = 10
    expect(pricingService.calculateApiCallCostMicroCents(0)).toBe(0);
    expect(pricingService.calculateApiCallCostMicroCents(1)).toBe(10);
    expect(pricingService.calculateApiCallCostMicroCents(1234)).toBe(12_340);
  });
});