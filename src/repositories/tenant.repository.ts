import type { Tenant, Prisma } from "../generated/prisma/client";
import { prisma } from "../lib/prisma";

type Client = typeof prisma | Prisma.TransactionClient;

export class TenantRepository {
  async findByApiKey(apiKey: string, client: Client = prisma): Promise<Tenant | null> {
    return client.tenant.findUnique({ where: { apiKey } });
  }

  async findById(id: string, client: Client = prisma): Promise<Tenant | null> {
    return client.tenant.findUnique({ where: { id } });
  }

  async findByStripeCustomerId(stripeCustomerId: string, client: Client = prisma): Promise<Tenant | null> {
    return client.tenant.findUnique({ where: { stripeCustomerId } });
  }

  async createTenant(data: Prisma.TenantCreateInput, client: Client = prisma): Promise<Tenant> {
    return client.tenant.create({ data });
  }

  async updateTenant(id: string, data: Prisma.TenantUpdateInput, client: Client = prisma): Promise<Tenant> {
    return client.tenant.update({ where: { id }, data });
  }
}

export const tenantRepository = new TenantRepository();