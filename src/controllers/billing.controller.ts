import { stripeService } from "../services/stripe.service";
import { type Request, type Response } from "express";
import { AppError } from "../middleware/error.middleware";
import { Stripe } from "stripe";

export async function createCheckoutSession(req: Request, res: Response): Promise<void> {
  const idempotencyKey = req.header("Idempotency-Key");

  if (!idempotencyKey) {
    throw new AppError(400, "missing_idempotency_key", "Idempotency-Key header is required");
  }

  const result = await stripeService.createCheckoutSession({
    tenant: req.tenant,
    idempotencyKey,
  });

  res.status(200).json(result);
}

export async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  const signature = req.header("Stripe-Signature");
  if (!signature) {
    throw new AppError(400, "missing_stripe_signature", "Stripe-Signature header is required");
  }

  let event: Stripe.Event;
  try {
    event = stripeService.verifyWebhookSignature(req.body as Buffer, signature);
  } catch (err) {
    throw new AppError(400, "invalid_signature", "Webhook signature verification failed");
  }


  await stripeService.handleWebhookEvent(event);

  res.status(200).send({ received: true });
}