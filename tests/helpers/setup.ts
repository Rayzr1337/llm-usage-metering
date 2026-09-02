import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.test") });

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set in .env.test (point it at a dedicated test database, e.g. metering_test).",
  );
}

if (!process.env.STRIPE_WEBHOOK_SECRET) {
  throw new Error("STRIPE_WEBHOOK_SECRET must be set in .env.test");
}