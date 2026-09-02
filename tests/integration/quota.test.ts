import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";
import { resetDatabase, disconnectPrisma } from "../helpers/db";
import { createTestTenant, seedUsageEvents } from "../helpers/fixtures";

const app = createApp();

afterAll(async () => {
  await disconnectPrisma();
});

describe("POST /usage — quota enforcement boundary", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("FREE plan API_CALL limit (1000): request reaching the limit succeeds, the next one returns 429 with quota_exceeded", async () => {
    const { tenant, apiKey } = await createTestTenant({ plan: "FREE" });

    // Pre-fill usage so the tenant sits at exactly 999 of the 1000 limit.
    await seedUsageEvents(tenant.id, [
      { type: "API_CALL", quantity: 999, idempotencyKey: "prefill-1" },
    ]);

    // 1-unit request brings them to 1000 → should succeed.
    const atLimit = await request(app)
      .post("/usage")
      .set("X-API-Key", apiKey)
      .set("Idempotency-Key", "at-limit")
      .send({ type: "API_CALL", quantity: 1 });

    expect(atLimit.status).toBe(201);

    // Next request beyond the limit → 429 with quota_exceeded.
    const overLimit = await request(app)
      .post("/usage")
      .set("X-API-Key", apiKey)
      .set("Idempotency-Key", "over-limit")
      .send({ type: "API_CALL", quantity: 1 });

    expect(overLimit.status).toBe(429);
    expect(overLimit.body.error).toBe("quota_exceeded");
    expect(typeof overLimit.body.message).toBe("string");

    // Message should reflect accurate used/limit figures.
    expect(overLimit.body.message).toMatch(/API_CALL/);
    expect(overLimit.body.message).toMatch(/1000\/1000|1000\s*\/\s*1000/);

    // Verify the over-limit request did not create a row.
    const eventCount = await prisma.usageEvent.count({
      where: { tenantId: tenant.id, idempotencyKey: "over-limit" },
    });
    expect(eventCount).toBe(0);
  });
});