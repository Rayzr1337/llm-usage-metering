import type { Request, Response } from "express";
import { recordUsageSchema } from "../validation/usage.schema";
import { meteringService } from "../services/metering.service";
import { AppError } from "../middleware/error.middleware";
import { validate } from "../utils/validate";

export async function recordUsage(req: Request, res: Response): Promise<void> {
  const idempotencyKey = req.header("Idempotency-Key");

  if (!idempotencyKey) {
    throw new AppError(400, "missing_idempotency_key", "Idempotency-Key header is required");
  }

  const input = validate(recordUsageSchema, req.body);

  const quantity =
    input.type === "AI_TOKENS"
      ? input.tokens!.inputTokens +
        input.tokens!.cachedInputTokens +
        input.tokens!.outputTokens +
        input.tokens!.reasoningTokens
      : input.quantity!;

  const { event, wasNew } = await meteringService.processUsageEvent({
    tenant: req.tenant,
    type: input.type,
    quantity,
    idempotencyKey,
    tokens: input.type === "AI_TOKENS" ? input.tokens : undefined,
  });

  res.status(wasNew ? 201 : 200).json({
    id: event.id,
    type: event.type,
    quantity: event.quantity,
    idempotencyKey: event.idempotencyKey,
    createdAt: event.createdAt,
    replayed: !wasNew,
  });
}

export async function rollupUsage(req: Request, res: Response): Promise<void> {
  const summary = await meteringService.getUsageSummary(req.tenant); 
  res.status(200).json(summary);
}