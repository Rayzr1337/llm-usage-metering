import { prisma } from "../lib/prisma";
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
  usage: {
    apiCalls: { used: number; limit: number };
    aiTokens: { used: number; limit: number };
  };
  costCents: number;
}

export class MeteringService {
  async processUsageEvent(input: ProcessUsageEventInput): Promise<ProcessUsageEventResult> {
    const { tenant, type, quantity, idempotencyKey, tokens } = input;

    const existing = await usageEventRepository.findByIdempotencyKey(tenant.id, idempotencyKey);
    if (existing) {
      return { event: existing, wasNew: false };
    }

    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenant.id}))`;

      const existingInLock = await usageEventRepository.findByIdempotencyKey(tenant.id, idempotencyKey, tx);
      if (existingInLock) {
        return { event: existingInLock, wasNew: false };
      }

      const quota = PLAN_QUOTAS[tenant.plan][type];
      const now = new Date();
      const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

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
  }

  async getUsageSummary(tenant: Tenant): Promise<UsageSummary> {
    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const [apiCallsUsed, tokenBreakdown] = await Promise.all([
      usageEventRepository.sumQuantitySince(tenant.id, "API_CALL", startOfMonth),
      usageEventRepository.sumTokenBreakdownSince(tenant.id, startOfMonth),
    ]);

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
      usage: {
        apiCalls: { used: apiCallsUsed, limit: quota.API_CALL },
        aiTokens: { used: aiTokensUsed, limit: quota.AI_TOKENS },
      },
      costCents,
    };
  }
}

export const meteringService = new MeteringService();