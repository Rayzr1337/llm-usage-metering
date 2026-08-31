import type { Tenant } from "../generated/prisma/client";

declare global {
  namespace Express {
    interface Request {
      tenant: Tenant;
    }
  }
}

export {};