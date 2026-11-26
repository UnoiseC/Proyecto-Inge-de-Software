import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.ts';
import type { JsspRepository } from '../db/repository.ts';
import { ApiError } from './errorHandler.ts';

export interface AuthContext {
  mode: 'api_key' | 'supabase_jwt' | 'sandbox';
  rol_sistema: string;
  auth_user_id?: string;
  email?: string;
  id_trabajador?: string;
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthContext;
    }
  }
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function createAuthMiddleware(repo: JsspRepository) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const apiKeyHeader = req.header('x-api-key')?.trim();
      const authHeader = req.header('authorization')?.trim();

      if (apiKeyHeader && env.apiAdminKey) {
        if (!safeEqual(apiKeyHeader, env.apiAdminKey)) {
          throw new ApiError(401, 'X-API-Key inválida.', 'INVALID_API_KEY');
        }
        req.authUser = {
          mode: 'api_key',
          rol_sistema: 'ADMIN',
        };
        return next();
      }

      if (authHeader?.toLowerCase().startsWith('bearer ')) {
        const token = authHeader.slice(7).trim();
        const authClient = repo.getSupabaseAuthClient();
        if (!authClient) {
          throw new ApiError(
            503,
            'Autenticación Bearer requiere configurar SUPABASE_URL y SUPABASE_ANON_KEY.',
            'AUTH_NOT_CONFIGURED'
          );
        }
        const { data, error } = await authClient.auth.getUser(token);
        if (error || !data.user) {
          throw new ApiError(401, 'Token JWT de Supabase inválido o expirado.', 'INVALID_JWT');
        }

        let worker = await repo.getTrabajadorByAuthUserId(data.user.id);
        if (!worker && data.user.email) {
          const all = await repo.getTrabajadores();
          worker =
            all.find((w) => w.email_trabajador.toLowerCase() === data.user.email!.toLowerCase()) ||
            null;
        }

        req.authUser = {
          mode: 'supabase_jwt',
          rol_sistema: (worker?.rol_sistema || 'TRABAJADOR').toUpperCase(),
          auth_user_id: data.user.id,
          email: data.user.email || worker?.email_trabajador,
          id_trabajador: worker?.id_trabajador,
        };
        return next();
      }

      if (env.requireAuth) {
        throw new ApiError(
          401,
          'Autenticación requerida. Envíe Authorization: Bearer <jwt> o X-API-Key.',
          'UNAUTHORIZED'
        );
      }

      req.authUser = {
        mode: 'sandbox',
        rol_sistema: 'ADMIN',
      };
      return next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireRole(...roles: string[]) {
  const allowed = roles.map((r) => r.toUpperCase());
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = req.authUser;
    if (!user) {
      return next(new ApiError(401, 'No autenticado.', 'UNAUTHORIZED'));
    }
    if (user.mode === 'sandbox' && !env.requireAuth) {
      return next();
    }
    if (!allowed.includes(user.rol_sistema.toUpperCase())) {
      return next(
        new ApiError(
          403,
          `Acceso denegado. Se requiere rol: ${allowed.join(' o ')}.`,
          'FORBIDDEN'
        )
      );
    }
    next();
  };
}
