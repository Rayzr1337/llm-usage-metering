import request from "supertest";
import { createApp } from "../../src/app";
import { resetDatabase, disconnectPrisma } from "../helpers/db";
import { createTestTenant } from "../helpers/fixtures";

const app = createApp();

afterAll(async () => {
  await disconnectPrisma();
});

describe("Request validation on POST /usage and auth", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("API_CALL type with tokens field present → 400 with details pointing at tokens", async () => {
    const { apiKey } = await createTestTenant({ plan: "PRO", subscriptionStatus: "active" });

    const res = await request(app)
      .post("/usage")
      .set("X-API-Key", apiKey)
      .set("Idempotency-Key", "v1")
      .send({
        type: "API_CALL",
        quantity: 1,
        tokens: {
          inputTokens: 1,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
    expect(Array.isArray(res.body.details)).toBe(true);
    const tokensIssue = (res.body.details as Array<{ path: string }>).find(
      (d) => d.path === "tokens",
    );
    expect(tokensIssue).toBeDefined();
  });

  test("AI_TOKENS type with no tokens field → 400", async () => {
    const { apiKey } = await createTestTenant({ plan: "PRO", subscriptionStatus: "active" });

    const res = await request(app)
      .post("/usage")
      .set("X-API-Key", apiKey)
      .set("Idempotency-Key", "v2")
      .send({ type: "AI_TOKENS" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
    const tokensIssue = (res.body.details as Array<{ path: string }>).find(
      (d) => d.path === "tokens",
    );
    expect(tokensIssue).toBeDefined();
  });

  test("Missing Idempotency-Key header → 400", async () => {
    const { apiKey } = await createTestTenant({ plan: "PRO", subscriptionStatus: "active" });

    const res = await request(app)
      .post("/usage")
      .set("X-API-Key", apiKey)
      .send({ type: "API_CALL", quantity: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("missing_idempotency_key");
  });

  test("Missing X-API-Key header → 401", async () => {
    const res = await request(app)
      .post("/usage")
      .set("Idempotency-Key", "no-key")
      .send({ type: "API_CALL", quantity: 1 });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("missing_api_key");
  });

  test("Invalid X-API-Key → 401", async () => {
    const res = await request(app)
      .post("/usage")
      .set("X-API-Key", "definitely-not-a-real-key")
      .set("Idempotency-Key", "bad-key")
      .send({ type: "API_CALL", quantity: 1 });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_api_key");
  });
});