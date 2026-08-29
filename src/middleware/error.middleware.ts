import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

type controllerFunc = (req: Request<any, any, any, any>, res: Response, next: NextFunction) => Promise<any>;

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorHandler(err: unknown, res: Response): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.code, message: err.message });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: "validation_error",
      message: "Invalid request",
      issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
    return;
  }

  console.error("Unhandled error:", err);
  res.status(500).json({ error: "internal_error", message: "Something went wrong" });
}

export function asyncErrorHandler(f: controllerFunc) {
    return (req: Request, res: Response, next: NextFunction) => {
        f(req, res, next).catch(next);
    }
};