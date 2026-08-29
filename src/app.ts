import express, { type Application, type Request, type Response, type NextFunction } from "express";

import { errorHandler } from "./middleware/error.middleware";
import { billingRouter } from "./routes/billing.routes";
import { tenantsRouter } from "./routes/tenants.routes";
import { usageRouter } from "./routes/usage.routes";

export function createApp(): Application {
  const app = express();

  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (req: Request, res: Response) => {
    res.status(200).json({ status: "ok" });
  });

  app.use("/tenants", tenantsRouter);
  app.use("/usage", usageRouter);
  app.use("/billing", billingRouter);

  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: "Not found", path: req.originalUrl });
  });

  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => errorHandler(err, res));

  return app;
}
