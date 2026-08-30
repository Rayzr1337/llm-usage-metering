import { prisma } from "../lib/prisma";
import { usageEventRepository } from "../repositories/usageEvent.repository";
import { AppError } from "../middleware/error.middleware";
import { PLAN_QUOTAS } from "../config/plans";
import type { UsageType, UsageEvent, Tenant } from "../generated/prisma/client";

interface ProcessUsageEventInput {
  tenant: Tenant;
  type: UsageType;
  quantity: number;
  idempotencyKey: string;
}

interface ProcessUsageEventResult {
  event: UsageEvent;
  wasNew: boolean;
}

export class MeteringService {
  async processUsageEvent(input: ProcessUsageEventInput): Promise<ProcessUsageEventResult> {
    const { tenant, type, quantity, idempotencyKey } = input;

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
        { tenant: { connect: { id: tenant.id } }, type, quantity, idempotencyKey },
        tx,
      );

      return { event, wasNew: true };
    });
  }
}

export const meteringService = new MeteringService();