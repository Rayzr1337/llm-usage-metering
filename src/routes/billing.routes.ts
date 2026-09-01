import express from "express";
import type { Request, Response } from "express";
import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { asyncErrorHandler } from "../middleware/error.middleware";
import { createCheckoutSession, handleStripeWebhook } from "../controllers/billing.controller";

export const billingRouter = Router();

billingRouter.post("/webhooks/stripe", express.raw({ type: "application/json" }),  
                    asyncErrorHandler(handleStripeWebhook));
billingRouter.post("/checkout", authMiddleware, asyncErrorHandler(createCheckoutSession));
billingRouter.get("/success", (req: Request, res: Response) => {
  res.status(200).json({ message: "Payment successful. You can close this tab." });
});

billingRouter.get("/cancel", (req: Request, res: Response) => {
  res.status(200).json({ message: "Checkout canceled." });
});