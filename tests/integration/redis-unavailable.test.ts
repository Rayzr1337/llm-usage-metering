import request from "supertest";
import { createApp } from "../../src/app";
import { redisClient as redis } from "../../src/lib/redis";
import { resetDatabase, disconnectPrisma } from "../helpers/db";
import { createTestTenant } from "../helpers/fixtures";

const app = createApp();

afterAll(async () => {
  await disconnectPrisma();
  // Defensive: never leave a connection dangling even if a stray test connects.
  if (redis.isOpen) {
    await redis.close();
  }
});

describe("App behavior with Redis unavailable", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("redisClient.isOpen is false (no real Redis required) and requests still succeed end-to-end", async () => {
    // We never call redis.connect() in the test bootstrap, so this confirms
    // the soft-dependency contract: every cache call in metering.service.ts
    // is guarded by `redis.isOpen` and try/catch.
    expect(redis.isOpen).toBe(false);

    const { apiKey } = await createTestTenant({ plan: "PRO", subscriptionStatus: "active" });

    // Write path: POST /usage must succeed without touching Redis.
    const write = await request(app)
      .post("/usage")
      .set("X-API-Key", apiKey)
      .set("Idempotency-Key", "no-redis-1")
      .send({ type: "API_CALL", quantity: 3 });

    expect(write.status).toBe(201);
    expect(write.body.quantity).toBe(3);

    // Read path: GET /usage must succeed and compute the rollup from the DB
    // because the cache layer must be a no-op when Redis is closed.
    const read = await request(app)
      .get("/usage")
      .set("X-API-Key", apiKey);

    expect(read.status).toBe(200);
    expect(read.body.usage.apiCalls.used).toBe(3);
    expect(read.body.costCents).toBe(Math.round((3 * 10) / 10_000));
  });
});