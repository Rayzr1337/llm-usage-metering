import { prisma } from "../lib/prisma";
import type { UsageEvent, Prisma, UsageType } from "../generated/prisma/client";

type Client = typeof prisma | Prisma.TransactionClient;

export class UsageEventRepository {
  async create(data: Prisma.UsageEventCreateInput, client: Client = prisma): Promise<UsageEvent> {
    return client.usageEvent.create({ data });
  }

  async findByIdempotencyKey(tenantId: string, idempotencyKey: string, client: Client = prisma): Promise<UsageEvent | null> {
    return client.usageEvent.findUnique({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
    });
  }

  async sumQuantitySince(tenantId: string, type: UsageType, since: Date, client: Client = prisma): Promise<number> {
    const result = await client.usageEvent.aggregate({
      where: { tenantId, type, createdAt: { gte: since } },
      _sum: { quantity: true },
    });
    return result._sum.quantity ?? 0;
  }

  async sumTokenBreakdownSince(tenantId: string, since: Date, client: Client = prisma) {
    const result = await client.usageEvent.aggregate({
      where: { tenantId, type: "AI_TOKENS", createdAt: { gte: since } },
      _sum: {
        inputTokens: true,
        cachedInputTokens: true,
        outputTokens: true,
        reasoningTokens: true,
      },
    });
    return {
      inputTokens: result._sum.inputTokens ?? 0,
      cachedInputTokens: result._sum.cachedInputTokens ?? 0,
      outputTokens: result._sum.outputTokens ?? 0,
      reasoningTokens: result._sum.reasoningTokens ?? 0,
    };
  }
}

export const usageEventRepository = new UsageEventRepository();