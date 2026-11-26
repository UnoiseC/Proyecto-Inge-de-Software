import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import { env } from './src/config/env.ts';
import { JsspRepository } from './src/db/repository.ts';
import { errorHandler } from './src/middleware/errorHandler.ts';
import { createApiRouter } from './src/routes/apiRouter.ts';
import { startReportScheduler } from './src/services/schedulerService.ts';

const repo = new JsspRepository();
const sseClients = new Set<Response>();

function broadcastSse(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

async function startBackend() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  // Scoped CORS policy: only allow explicitly configured CORS_ORIGIN (never wildcard '*')
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.header('origin');
    if (origin && env.corsOrigin) {
      const allowedOrigins = env.corsOrigin
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
      if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-API-Key'
        );
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      }
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // Real-time SSE stream bridged to Supabase Realtime postgres_changes
  const sseHandler = (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, mode: repo.mode })}\n\n`);
    sseClients.add(res);
    req.on('close', () => {
      sseClients.delete(res);
    });
  };
  app.get('/api/realtime/stream', sseHandler);
  app.get('/api/stream', sseHandler);

  repo.subscribeToSupabaseRealtime((table, eventType) => {
    broadcastSse('jssp_sync', { table, eventType, source: 'supabase_realtime' });
  });

  // Pure JSON API root index
  app.get('/', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: 'JSSP Control — Backend Node.js + TypeScript (Supabase / PostgreSQL)',
      database_mode: repo.mode,
      auth_required: env.requireAuth,
      api_catalog: '/api',
      healthcheck: '/api/health',
      realtime_sse: '/api/realtime/stream',
      postman_collection: '/api/postman-collection',
      supabase_complement_sql: '/api/supabase/complement-sql',
    });
  });

  // Mount REST API
  app.use('/api', createApiRouter(repo, broadcastSse));

  // 404 JSON fallback
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      ok: false,
      error: 'Endpoint no encontrado en el backend JSSP.',
      code: 'NOT_FOUND',
    });
  });

  // Global error handler
  app.use(errorHandler);

  // Start automated scheduled report dispatcher (America/Santiago)
  startReportScheduler(repo, broadcastSse);

  app.listen(env.port, '0.0.0.0', () => {
    console.log(
      `JSSP Control Pure Backend API (DB mode: ${repo.mode} | Auth: ${env.requireAuth ? 'REQUIRED' : 'SANDBOX'}) listening on http://0.0.0.0:${env.port}`
    );
  });
}

startBackend();
