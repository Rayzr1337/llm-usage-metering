import { prisma } from "../../src/lib/prisma";

/**
 * Truncate the three application tables in FK-safe order using
 * TRUNCATE ... RESTART IDENTITY CASCADE. We deliberately do NOT use
 * transaction-rollback tricks: the metering service uses
 * pg_advisory_xact_lock + interactive $transaction, and rolling back
 * an outer transaction would leave the advisory lock in a confusing
 * state across tests. Per-test truncation is the simplest reliable
 * isolation strategy here, and combined with `--runInBand` it gives us
 * deterministic state between cases.
 */
export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "UsageEvent", "WebhookEvent", "Tenant" RESTART IDENTITY CASCADE',
  );
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}