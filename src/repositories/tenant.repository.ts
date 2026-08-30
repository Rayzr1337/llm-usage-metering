import { prisma } from "../lib/prisma";
import type { Tenant, Prisma } from "../generated/prisma/client";

export class TenantRepository {
    async createTenant(data: Prisma.TenantCreateInput): Promise<Tenant> {
        return prisma.tenant.create({ data });
    }

    async findById(id: string): Promise<Tenant | null> {
        return prisma.tenant.findUnique({ where: { id } });
    }

    async findByApiKey(key: string): Promise<Tenant | null> {
        return prisma.tenant.findUnique({ where: { apiKey: key } });
    }

    async updateTenant(id: string, data: Prisma.TenantUpdateInput): Promise<Tenant> {
        return prisma.tenant.update({ where: { id }, data });
    }
}

export const tenantRepository = new TenantRepository();

