import { z } from "zod";

const tokenBreakdownSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
});

export const recordUsageSchema = z
  .object({
    type: z.enum(["API_CALL", "AI_TOKENS"]),
    quantity: z.number().int().positive().optional(),
    tokens: tokenBreakdownSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === "API_CALL") {
      if (data.quantity === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["quantity"],
          message: "quantity is required when type is API_CALL",
        });
      }
      if (data.tokens !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tokens"],
          message: "tokens should not be provided when type is API_CALL",
        });
      }
    }

    if (data.type === "AI_TOKENS" && data.tokens === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tokens"],
        message: "tokens is required when type is AI_TOKENS",
      });
    }
  });

export type RecordUsageInput = z.infer<typeof recordUsageSchema>;