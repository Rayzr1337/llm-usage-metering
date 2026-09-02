import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";
import { resetDatabase, disconnectPrisma } from "../helpers/db";
import { createTestTenant } from "../helpers/fixtures";

const app = createApp();

afterAll(async () => {
  await disconnectPrisma();
});

describe("POST /usage — idempotent metering", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("sequential: same key returns same id; first 201 (replayed:false), second 200 (replayed:true)", async () => {
    const { apiKey } = await createTestTenant({ plan: "PRO", subscriptionStatus: "active" });
    const idemKey = "seq-test-1";

    const body = {
      type: "API_CALL" as const,
      quantity: 1,
    };

    const first = await request(app)
      .post("/usage")
      .set("X-API-Key", apiKey)
      .set("Idempotency-Key", idemKey)
      .send(body);

    const second = await request(app)
      .post("/usage")
      .set("X-API-Key", apiKey)
      .set("Idempotency-Key", idemKey)
      .send(body);

    expect(first.status).toBe(201);
    expect(first.body.replayed).toBe(false);
    expect(typeof first.body.id).toBe("string");

    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
    expect(second.body.id).toBe(first.body.id);

    const rows = await prisma.usageEvent.findMany({ where: { idempotencyKey: idemKey } });
    expect(rows).toHaveLength(1);
  });

  test("concurrent: two identical requests with the same idempotency key produce exactly one DB row", async () => {
    const { apiKey } = await createTestTenant({ plan: "PRO", subscriptionStatus: "active" });
    const idemKey = `concurrent-${Date.now()}`;

    const body = {
      type: "API_CALL" as const,
      quantity: 1,
    };

    const fire = () =>
      request(app)
        .post("/usage")
        .set("X-API-Key", apiKey)
        .set("Idempotency-Key", idemKey)
        .send(body);

    const results = await Promise.all([fire(), fire()]);

    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 201]);

    const ids = results.map((r) => r.body.id);
    expect(ids[0]).toBe(ids[1]);

    const replayed = results.map((r) => r.body.replayed).sort();
    expect(replayed).toEqual([false, true]);

    const rows = await prisma.usageEvent.findMany({ where: { idempotencyKey: idemKey } });
    expect(rows).toHaveLength(1);
  });
});