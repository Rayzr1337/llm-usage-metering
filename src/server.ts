import "dotenv/config";

import { createApp } from "./app";
import { prisma } from "./lib/prisma";
import { redisClient as redis } from "./lib/redis";

const PORT = Number(process.env.PORT ?? 3000);

async function main(){
  const app = createApp();

  await prisma.$connect();

  try {
    await redis.connect();
  } catch (err) {
    console.warn("Redis unavailable at startup, continuing without cache:", err);
  }


  const server = app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });

  const shutdown = async (signal: NodeJS.Signals) => {
    console.log(`Received ${signal}, shutting down`);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    console.log("HTTP server closed");
    await prisma.$disconnect();
    
    if (redis.isOpen) {
      await redis.close();
    }

    console.log("Prisma and Redis disconnected");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  console.error("Fatal startup error", err);
  process.exit(1);
});
