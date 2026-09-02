import request from "supertest";
import { createApp } from "../../src/app";
import { resetDatabase, disconnectPrisma } from "../helpers/db";
import { createTestTenant, seedUsageEvents } from "../helpers/fixtures";

const app = createApp();

afterAll(async () => {
  await disconnectPrisma();
});

describe("POST /usage — subscription status gating (402 vs 429)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("PRO tenant with subscriptionStatus='past_due' returns 402 even with quota available", async () => {
    const { apiKey } = await createTestTenant({
      plan: "PRO",
      subscriptionStatus: "past_due",
    });

    const res = await request(app)
      .post("/usage")
      .set("X-API-Key", apiKey)
      .set("Idempotency-Key", "k1")
      .send({ type: "API_CALL", quantity: 1 });

    expect(res.status).toBe(402);
    expect(res.body.error).toBe("subscription_inactive");
  });

  test("PRO tenant with subscriptionStatus='active' is allowed through normally", async () => {
    const { apiKey } = await createTestTenant({
      plan: "PRO",
      subscriptionStatus: "active",
    });

    const res = await request(app)
      .post("/usage")
      .set("X-API-Key", apiKey)
      .set("Idempotency-Key", "k-active")
      .send({ type: "API_CALL", quantity: 1 });

    expect(res.status).toBe(201);
  });

  test("PRO tenant with subscriptionStatus='trialing' is allowed through normally", async () => {
    const { apiKey } = await createTestTenant({
      plan: "PRO",
      subscriptionStatus: "trialing",
    });

    const res = await request(app)
      .post("/usage")
      .set("X-API-Key", apiKey)
      .set("Idempotency-Key", "k-trialing")
      .send({ type: "API_CALL", quantity: 1 });

    expect(res.status).toBe(201);
  });

  test("FREE tenant with subscriptionStatus=null is unaffected by subscription gating (still 429 on quota, not 402)", async () => {
    const { tenant, apiKey } = await createTestTenant({
      plan: "FREE",
      subscriptionStatus: null,
    });

    // Pre-fill FREE tenant to exactly the API_CALL limit.
    await seedUsageEvents(tenant.id, [
      { type: "API_CALL", quantity: 1000, idempotencyKey: "prefill-free" },
    ]);

    const res = await request(app)
      .post("/usage")
      .set("X-API-Key", apiKey)
      .set("Idempotency-Key", "free-over")
      .send({ type: "API_CALL", quantity: 1 });

    expect(res.status).toBe(429);
    expect(res.body.error).toBe("quota_exceeded");
  });
});