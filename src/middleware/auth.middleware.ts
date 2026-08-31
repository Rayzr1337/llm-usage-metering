import type { Request, Response, NextFunction } from "express";
import { tenantRepository } from "../repositories/tenant.repository";
import { AppError, asyncErrorHandler } from "./error.middleware";

export const authMiddleware = asyncErrorHandler(async (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.header("X-API-Key");

  if (!apiKey) {
    throw new AppError(401, "missing_api_key", "X-API-Key header is required");
  }

  const tenant = await tenantRepository.findByApiKey(apiKey);

  if (!tenant) {
    throw new AppError(401, "invalid_api_key", "Invalid API key");
  }

  req.tenant = tenant;
  next();
});