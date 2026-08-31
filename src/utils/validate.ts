import type { ZodSchema } from "zod";
import { AppError } from "../middleware/error.middleware";

export function validate<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);

  if (!result.success) {
    throw new AppError(
      400,
      "validation_error",
      "Invalid request",
      result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  return result.data;
}