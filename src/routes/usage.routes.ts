import { recordUsage, rollupUsage } from '../controllers/usage.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { asyncErrorHandler } from '../middleware/error.middleware';
import { Router } from "express";

export const usageRouter = Router();

usageRouter.post("/", authMiddleware, asyncErrorHandler(recordUsage));
usageRouter.get("/", authMiddleware, asyncErrorHandler(rollupUsage));