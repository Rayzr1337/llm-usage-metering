import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const freeTenant = await prisma.tenant.upsert({
    where: { apiKey: "demo_free_key" },
    update: {},
    create: {
      name: "Demo Free Tenant",
      apiKey: "demo_free_key",
      plan: "FREE",
    },
  });

  const proTenant = await prisma.tenant.upsert({
    where: { apiKey: "demo_pro_key" },
    update: {},
    create: {
      name: "Demo Pro Tenant",
      apiKey: "demo_pro_key",
      plan: "PRO",
      subscriptionStatus: "active",
    },
  });

  console.log("Seeded tenants:", { freeTenant, proTenant });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error("Seed failed:", err);
    await prisma.$disconnect();
    process.exit(1);
  });