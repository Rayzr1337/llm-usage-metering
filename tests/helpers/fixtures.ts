import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/prisma";
import type { Tenant, Plan } from "../../src/generated/prisma/client";

export interface CreateTestTenantOptions {
  plan?: Plan;
  subscriptionStatus?: string | null;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}

export interface TestTenant {
  tenant: Tenant;
  apiKey: string;
}

/**
 * Create a tenant with sensible defaults. Each call produces a unique
 * apiKey so tests can have multiple tenants without collisions.
 */
export async function createTestTenant(
  opts: CreateTestTenantOptions = {},
): Promise<TestTenant> {
  const apiKey = `test-key-${randomUUID()}`;
  const tenant = await prisma.tenant.create({
    data: {
      name: `Test Tenant ${randomUUID()}`,
      apiKey,
      plan: opts.plan ?? "FREE",
      subscriptionStatus: opts.subscriptionStatus ?? null,
      stripeCustomerId: opts.stripeCustomerId ?? null,
      stripeSubscriptionId: opts.stripeSubscriptionId ?? null,
    },
  });
  return { tenant, apiKey };
}

/**
 * Inject usage events directly via Prisma, bypassing the HTTP layer.
 * Useful for setting up rollup assertions without dozens of requests.
 */
export interface SeedEvent {
  type: "API_CALL" | "AI_TOKENS";
  quantity: number;
  idempotencyKey: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
}

export async function seedUsageEvents(
  tenantId: string,
  events: SeedEvent[],
): Promise<void> {
  for (const e of events) {
    await prisma.usageEvent.create({
      data: {
        tenantId,
        type: e.type,
        quantity: e.quantity,
        idempotencyKey: e.idempotencyKey,
        inputTokens: e.inputTokens ?? null,
        cachedInputTokens: e.cachedInputTokens ?? null,
        outputTokens: e.outputTokens ?? null,
        reasoningTokens: e.reasoningTokens ?? null,
      },
    });
  }
}