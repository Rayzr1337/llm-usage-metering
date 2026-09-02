import request from "supertest";
import { createApp } from "../../src/app";
import { resetDatabase, disconnectPrisma } from "../helpers/db";
import { createTestTenant, seedUsageEvents } from "../helpers/fixtures";

const app = createApp();

afterAll(async () => {
  await disconnectPrisma();
});

describe("GET /usage — rollup accuracy", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("mix of API_CALL and AI_TOKENS events: used counts and costCents match hand-calculated values", async () => {
    const { tenant, apiKey } = await createTestTenant({ plan: "PRO", subscriptionStatus: "active" });

    // Seed a known mix:
    //   - 1000 API_CALLs (quantity 1000)
    //   - AI_TOKENS events that sum to:
    //       input=10_000, cached=5_000, output=2_000, reasoning=1_000
    await seedUsageEvents(tenant.id, [
      { type: "API_CALL", quantity: 1000, idempotencyKey: "api-1" },
      {
        type: "AI_TOKENS",
        quantity: 18000,
        idempotencyKey: "ai-1",
        inputTokens: 10_000,
        cachedInputTokens: 5_000,
        outputTokens: 2_000,
        reasoningTokens: 1_000,
      },
    ]);

    // Hand-calculated expected values from pricing constants:
    //   input       = 10000 * 15  = 150_000
    //   cached      = 5000  * 5   =  25_000
    //   output+reasoning = 3000 * 60 = 180_000
    //   apiCalls    = 1000  * 10  =  10_000
    //   total microcents = 365_000
    //   cents (rounded) = Math.round(365_000 / 10_000) = 37 (boundary rounds .5 up)
    const expectedMicrocents =
      10000 * 15 + 5000 * 5 + 3000 * 60 + 1000 * 10;
    const expectedCostCents = Math.round(expectedMicrocents / 10_000);

    const res = await request(app)
      .get("/usage")
      .set("X-API-Key", apiKey);

    expect(res.status).toBe(200);

    expect(res.body.usage.apiCalls.used).toBe(1000);
    expect(res.body.usage.apiCalls.limit).toBe(10_000);

    expect(res.body.usage.aiTokens.used).toBe(18000);
    expect(res.body.usage.aiTokens.limit).toBe(2_000_000);

    expect(res.body.costCents).toBe(expectedCostCents);
    expect(expectedCostCents).toBe(37);
  });
});