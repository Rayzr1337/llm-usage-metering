import request from "supertest";
import Stripe from "stripe";
import { createApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";
import { resetDatabase, disconnectPrisma } from "../helpers/db";
import { createTestTenant } from "../helpers/fixtures";

const app = createApp();

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;
if (!WEBHOOK_SECRET) {
  throw new Error("STRIPE_WEBHOOK_SECRET must be set in .env.test for webhook tests");
}

afterAll(async () => {
  await disconnectPrisma();
});

describe("POST /billing/webhooks/stripe — signature + dedup", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("garbage stripe-signature header → 400, no WebhookEvent row, no Tenant change", async () => {
    const { tenant } = await createTestTenant({ plan: "FREE", subscriptionStatus: null });

    const payload = JSON.stringify({ id: "evt_garbage", type: "checkout.session.completed" });
    const garbageSignature = "t=1234567890,v1=deadbeefdeadbeefdeadbeef";

    const res = await request(app)
      .post("/billing/webhooks/stripe")
      .set("Stripe-Signature", garbageSignature)
      .set("Content-Type", "application/json")
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_signature");

    const webhookRows = await prisma.webhookEvent.count();
    expect(webhookRows).toBe(0);

    const tenantAfter = await prisma.tenant.findUnique({ where: { id: tenant.id } });
    expect(tenantAfter?.plan).toBe("FREE");
    expect(tenantAfter?.subscriptionStatus).toBeNull();
  });

  test("validly-signed checkout.session.completed → tenant upgraded to PRO, subscriptionStatus='active'", async () => {
    const { tenant } = await createTestTenant({ plan: "FREE", subscriptionStatus: null });
    const eventId = `evt_test_${Date.now()}`;

    const stripeEvent = {
      id: eventId,
      object: "event",
      api_version: "2024-06-20",
      created: Math.floor(Date.now() / 1000),
      type: "checkout.session.completed",
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      data: {
        object: {
          id: "cs_test_session",
          object: "checkout.session",
          client_reference_id: tenant.id,
          subscription: "sub_test_subscription",
          customer: "cus_test_customer",
        },
      },
    };

    const payload = JSON.stringify(stripeEvent);
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    });

    const res = await request(app)
      .post("/billing/webhooks/stripe")
      .set("Stripe-Signature", signature)
      .set("Content-Type", "application/json")
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    const tenantAfter = await prisma.tenant.findUnique({ where: { id: tenant.id } });
    expect(tenantAfter?.plan).toBe("PRO");
    expect(tenantAfter?.subscriptionStatus).toBe("active");
    expect(tenantAfter?.stripeSubscriptionId).toBe("sub_test_subscription");

    const webhookRow = await prisma.webhookEvent.findUnique({
      where: { stripeEventId: eventId },
    });
    expect(webhookRow).not.toBeNull();
    expect(webhookRow?.type).toBe("checkout.session.completed");
  });

  test("delivering the same valid event twice → second is a no-op; only one WebhookEvent row exists", async () => {
    const { tenant } = await createTestTenant({ plan: "FREE", subscriptionStatus: null });
    const eventId = `evt_dedup_${Date.now()}`;

    const stripeEvent = {
      id: eventId,
      object: "event",
      api_version: "2024-06-20",
      created: Math.floor(Date.now() / 1000),
      type: "checkout.session.completed",
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      data: {
        object: {
          id: "cs_test_session_dedup",
          object: "checkout.session",
          client_reference_id: tenant.id,
          subscription: "sub_test_subscription_dedup",
          customer: "cus_test_customer_dedup",
        },
      },
    };

    const payload = JSON.stringify(stripeEvent);
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    });

    const first = await request(app)
      .post("/billing/webhooks/stripe")
      .set("Stripe-Signature", signature)
      .set("Content-Type", "application/json")
      .send(payload);

    const second = await request(app)
      .post("/billing/webhooks/stripe")
      .set("Stripe-Signature", signature)
      .set("Content-Type", "application/json")
      .send(payload);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const rows = await prisma.webhookEvent.findMany({ where: { stripeEventId: eventId } });
    expect(rows).toHaveLength(1);

    const tenantAfter = await prisma.tenant.findUnique({ where: { id: tenant.id } });
    expect(tenantAfter?.plan).toBe("PRO");
    expect(tenantAfter?.stripeSubscriptionId).toBe("sub_test_subscription_dedup");
  });
});