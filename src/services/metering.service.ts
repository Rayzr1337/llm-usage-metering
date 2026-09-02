import { prisma } from "../lib/prisma";
import { redisClient as redis } from "../lib/redis";
import { usageEventRepository } from "../repositories/usageEvent.repository";
import { AppError } from "../middleware/error.middleware";
import { PLAN_QUOTAS } from "../config/plans";
import type { UsageType, UsageEvent, Tenant } from "../generated/prisma/client";
import { pricingService } from "./pricing.service";

interface ProcessUsageEventInput {
  tenant: Tenant;
  type: UsageType;
  quantity: number;
  idempotencyKey: string;
  tokens?: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
  };
}

interface ProcessUsageEventResult {
  event: UsageEvent;
  wasNew: boolean;
}

interface UsageSummary {
  period: { start: Date };
  plan: Tenant["plan"];
  subscriptionStatus: Tenant["subscriptionStatus"];
  usage: {
    apiCalls: { used: number; limit: number };
    aiTokens: { used: number; limit: number };
  };
  costCents: number;
}

interface CachedAggregate {
  apiCallsUsed: number;
  tokenBreakdown: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
  };
}

const ACTIVE_STATUSES = ["active", "trialing"];
const DEFAULT_TTL_SECONDS = 60;

function usageCacheKey(tenantId: string, periodStart: Date): string {
  return `usage-agg:${tenantId}:${periodStart.toISOString()}`;
}

export class MeteringService {
  async processUsageEvent(input: ProcessUsageEventInput): Promise<ProcessUsageEventResult> {
    const { tenant, type, quantity, idempotencyKey, tokens } = input;
    const startOfMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));

    const existing = await usageEventRepository.findByIdempotencyKey(tenant.id, idempotencyKey);
    if (existing) {
      return { event: existing, wasNew: false };
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenant.id}))`;

      const existingInLock = await usageEventRepository.findByIdempotencyKey(tenant.id, idempotencyKey, tx);
      if (existingInLock) {
        return { event: existingInLock, wasNew: false };
      }

      if (tenant.plan === "PRO" && !ACTIVE_STATUSES.includes(tenant.subscriptionStatus ?? "")) {
          throw new AppError(402, "subscription_inactive", 
            "Your Pro subscription is not active. Please update your payment method or resubscribe.");
      }

      const quota = PLAN_QUOTAS[tenant.plan][type];

      const currentUsage = await usageEventRepository.sumQuantitySince(tenant.id, type, startOfMonth, tx);

      if (currentUsage + quantity > quota) {
        throw new AppError(429, "quota_exceeded", `Monthly ${type} limit reached (${currentUsage}/${quota}).`);
      }

      const event = await usageEventRepository.create(
        {
            tenant: { connect: { id: tenant.id } },
            type,
            quantity,
            idempotencyKey,
            ...(tokens && {
            inputTokens: tokens.inputTokens,
            cachedInputTokens: tokens.cachedInputTokens,
            outputTokens: tokens.outputTokens,
            reasoningTokens: tokens.reasoningTokens,
            }),
        },
        tx
      );

      return { event, wasNew: true };
    });

    if (result.wasNew) {
      await this.invalidateUsageCache(tenant.id, startOfMonth);
    }

    return result;
  }

  async getUsageSummary(tenant: Tenant): Promise<UsageSummary> {
    const startOfMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const cached = await this.readUsageCache(tenant.id, startOfMonth);

    const { apiCallsUsed, tokenBreakdown } = 
    cached ??  (await (async () => {
      const [apiCallsUsed, tokenBreakdown] = await Promise.all([
        usageEventRepository.sumQuantitySince(tenant.id, "API_CALL", startOfMonth),
        usageEventRepository.sumTokenBreakdownSince(tenant.id, startOfMonth),
      ]);

      await this.writeUsageCache(tenant.id, startOfMonth, { apiCallsUsed, tokenBreakdown });
      return { apiCallsUsed, tokenBreakdown };
    })());

    const aiTokensUsed =
      tokenBreakdown.inputTokens +
      tokenBreakdown.cachedInputTokens +
      tokenBreakdown.outputTokens +
      tokenBreakdown.reasoningTokens;

    const quota = PLAN_QUOTAS[tenant.plan];

    const tokenCostMicroCents = pricingService.calculateTokenCostMicroCents(tokenBreakdown);
    const apiCallCostMicroCents = pricingService.calculateApiCallCostMicroCents(apiCallsUsed);
    const costCents = pricingService.microCentsToCents(tokenCostMicroCents + apiCallCostMicroCents);

    return {
      period: { start: startOfMonth },
      plan: tenant.plan,
      subscriptionStatus: tenant.subscriptionStatus,
      usage: {
        apiCalls: { used: apiCallsUsed, limit: quota.API_CALL },
        aiTokens: { used: aiTokensUsed, limit: quota.AI_TOKENS },
      },
      costCents,
    };
  }

  private async readUsageCache(tenantId: string, periodStart: Date): Promise<CachedAggregate | null> {
    if (!redis.isOpen) return null;

    try {
      const raw = await redis.get(usageCacheKey(tenantId, periodStart));
      return raw ? (JSON.parse(raw) as CachedAggregate) : null;
    } catch (err) {
      console.warn("Redis read failed, falling back to database:", err);
      return null;
    }
  }

  private async writeUsageCache(tenantId: string, periodStart: Date, value: CachedAggregate): Promise<void> {
    if (!redis.isOpen) return;

    try {
      await redis.set(usageCacheKey(tenantId, periodStart), JSON.stringify(value), {
        EX: DEFAULT_TTL_SECONDS,
      });
    } catch (err) {
      console.warn("Redis write failed, continuing without cache:", err);
    }
  }

  private async invalidateUsageCache(tenantId: string, periodStart: Date): Promise<void> {
    if (!redis.isOpen) return;

    try {
      await redis.del(usageCacheKey(tenantId, periodStart));
    } catch (err) {
      console.warn("Redis invalidation failed:", err);
    }
  }
}

export const meteringService = new MeteringService();