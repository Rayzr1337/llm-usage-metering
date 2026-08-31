-- AlterTable
ALTER TABLE "UsageEvent" ADD COLUMN     "cachedInputTokens" INTEGER,
ADD COLUMN     "inputTokens" INTEGER,
ADD COLUMN     "outputTokens" INTEGER,
ADD COLUMN     "reasoningTokens" INTEGER;
