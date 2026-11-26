import type { NextFunction, Request, Response } from 'express';

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export function mapDatabaseError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;

  const pgErr = err as { code?: string; message?: string; details?: string };
  const msg = pgErr?.message || 'Error interno en la base de datos';

  if (pgErr?.code === '23505' || msg.includes('duplicate key') || msg.includes('ya existe')) {
    return new ApiError(409, msg, 'CONFLICT');
  }
  if (pgErr?.code === '23503' || msg.includes('foreign key constraint')) {
    return new ApiError(400, `Referencia inválida en clave foránea: ${msg}`, 'FK_VIOLATION');
  }
  if (pgErr?.code === '23502' || msg.includes('null value in column')) {
    return new ApiError(400, `Campo obligatorio faltante: ${msg}`, 'NOT_NULL');
  }
  if (msg.includes('ENTRADA activa') || msg.includes('SALIDA previa')) {
    return new ApiError(409, msg, 'INVALID_MARK_SEQUENCE');
  }
  if (msg.includes('no está registrado como trabajador presencial')) {
    return new ApiError(400, msg, 'NOT_PRESENCIAL');
  }
  return new ApiError(500, msg, 'INTERNAL_ERROR');
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  const mapped = mapDatabaseError(err);
  res.status(mapped.status).json({
    ok: false,
    error: mapped.message,
    code: mapped.code || 'ERROR',
  });
}
