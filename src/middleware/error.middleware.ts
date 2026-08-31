import type { Request, Response, NextFunction } from "express";

type controllerFunc = (req: Request<any, any, any, any>, res: Response, next: NextFunction) => Promise<any>;

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorHandler(err: unknown, res: Response): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.code,
      message: err.message,
      ...(err.details !== undefined && { details: err.details }),
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