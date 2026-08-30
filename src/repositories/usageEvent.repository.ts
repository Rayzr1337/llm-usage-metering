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
}

export const usageEventRepository = new UsageEventRepository();