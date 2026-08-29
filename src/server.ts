import "dotenv/config";

import { createApp } from "./app";
import { prisma } from "./lib/prisma";

const PORT = Number(process.env.PORT ?? 3000);

async function main(){
  const app = createApp();

  await prisma.$connect();

  const server = app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });

  const shutdown = async (signal: NodeJS.Signals) => {
    console.log(`Received ${signal}, shutting down`);
    server.close(() => {
      console.log("HTTP server closed");
    });
    await prisma.$disconnect();
    console.log("Prisma disconnected");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  console.error("Fatal startup error", err);
  process.exit(1);
});
