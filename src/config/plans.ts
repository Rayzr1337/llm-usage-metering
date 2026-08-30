import type { Plan, UsageType } from "../generated/prisma/client";

export const PLAN_QUOTAS: Record<Plan, Record<UsageType, number>> = {
  FREE: {
    API_CALL: 1_000,
    AI_TOKENS: 100_000,
  },
  PRO: {
    API_CALL: 10_000,
    AI_TOKENS: 2_000_000,
  },
};

export const TOKEN_PRICING_MICOROCENTS = {
    input: 15,
    output: 60,
    cachedInput: 5
} as const;