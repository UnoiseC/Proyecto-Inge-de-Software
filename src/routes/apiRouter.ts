import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { env } from '../config/env.ts';
import type { JsspRepository } from '../db/repository.ts';
import { SUPABASE_COMPLEMENT_SQL } from '../db/supabaseScripts.ts';
import { createAuthMiddleware, requireRole } from '../middleware/auth.ts';
import { ApiError, asyncHandler } from '../middleware/errorHandler.ts';
import {
  buildAdminReportEmailHtml,
  buildAttendanceEmailHtml,
  dispatchEmail,
} from '../services/emailService.ts';
import {
  buildArt22CommissionsPdfBuffer,
  buildPunctualityPdfBuffer,
} from '../services/pdfService.ts';
import { generateWorkerQrPng, parseAndVerifyQrInput } from '../services/qrService.ts';
import { getChileDateParts, summarizeWorkerPunctuality } from '../services/timeService.ts';
import type { TipoMarca } from '../types/database.ts';
import { buildPostmanCollection } from '../utils/postmanCollection.ts';

function parsePeriodQuery(req: Request): { mes: number; anio: number } {
  const now = getChileDateParts(new Date());
  const mes = Number(req.query.mes) || now.month;
  const anio = Number(req.query.anio) || now.year;
  if (mes < 1 || mes > 12 || anio < 2000 || anio > 2100) {
    throw new ApiError(400, 'Parámetros de período mes/anio inválidos.');
  }
  return { mes, anio };
}

export function createApiRouter(
  repo: JsspRepository,
  broadcastSse: (event: string, data: unknown) => void
): Router {
  const router = Router();
  const authenticate = createAuthMiddleware(repo);

  // ==================== PUBLIC / SYSTEM ====================
  router.get('/', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: 'JSSP Control Backend REST API',
      schema_source: 'public/assets/aistudio/estructura_7b0b2863.sql',
      database_mode: repo.mode,
      auth_required: env.requireAuth,
      timezone: 'America/Santiago',
      endpoints: {
        health: 'GET /api/health',
        realtime_sse: 'GET /api/realtime/stream',
        postman: 'GET /api/postman-collection',
        supabase_sql: 'GET /api/supabase/complement-sql',
        auth: ['POST /api/auth/login', 'GET /api/auth/me'],
        sucursales: ['GET|POST /api/sucursales', 'GET|PUT|DELETE /api/sucursales/:id'],
        trabajadores: ['GET|POST /api/trabajadores', 'GET|PUT|DELETE /api/trabajadores/:id'],
        asistencia: [
          'GET /api/asistencia/qr/:id',
          'POST /api/asistencia/marcar',
          'GET /api/asistencia/marcas',
          'GET /api/asistencia/puntualidad',
        ],
        actas: [
          'GET /api/actas',
          'GET /api/actas/admin',
          'PATCH /api/actas/:idActa/firmar',
        ],
        comercial: [
          'GET|POST /api/productos',
          'PUT|DELETE /api/productos/:codigo',
          'GET|POST /api/metas',
          'GET|PUT /api/metas/:id',
          'GET|POST /api/ventas',
          'GET /api/ventas/:codigo',
          'GET /api/comisiones/art22',
        ],
        reportes_y_correos: [
          'GET /api/reportes/puntualidad/pdf',
          'GET /api/reportes/comisiones-art22/pdf',
          'POST /api/reportes/puntualidad/enviar',
          'GET|PUT /api/reportes/programacion',
          'GET /api/correos/logs',
          'POST /api/correos/reenviar/:idMarca',
        ],
      },
    });
  });

  router.get(
    '/health',
    asyncHandler(async (_req: Request, res: Response) => {
      const db = await repo.checkDatabaseHealth();
      const now = getChileDateParts(new Date());
      res.status(db.connected ? 200 : 503).json({
        ok: db.connected,
        database_mode: repo.mode,
        db_connected: db.connected,
        db_latency_ms: db.latencyMs,
        db_detail: db.detail,
        auth_required: env.requireAuth,
        chile_time: now.displayStr,
        scheduler: repo.getSchedule(),
      });
    })
  );

  router.get('/postman-collection', (req: Request, res: Response) => {
    const proto = req.header('x-forwarded-proto') || req.protocol || 'http';
    const host = req.header('host') || `localhost:${env.port}`;
    const collection = buildPostmanCollection(`${proto}://${host}`);
    res.setHeader('Content-Disposition', 'attachment; filename="JSSP_Control_API.postman_collection.json"');
    res.json(collection);
  });

  router.get('/supabase/complement-sql', (req: Request, res: Response) => {
    if (req.query.format === 'sql') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(SUPABASE_COMPLEMENT_SQL);
      return;
    }
    res.json({ ok: true, sql: SUPABASE_COMPLEMENT_SQL });
  });

  // ==================== SUPABASE AUTH ====================
  router.post(
    '/auth/login',
    asyncHandler(async (req: Request, res: Response) => {
      const { email, password } = req.body as { email?: string; password?: string };
      if (!email || !password) {
        throw new ApiError(400, 'Debe enviar email y password.');
      }
      const authClient = repo.getSupabaseAuthClient();
      if (!authClient) {
        throw new ApiError(
          503,
          'Supabase Auth no está configurado (defina SUPABASE_URL y SUPABASE_ANON_KEY).'
        );
      }
      const { data, error } = await authClient.auth.signInWithPassword({ email, password });
      if (error || !data.session) {
        throw new ApiError(401, error?.message || 'Credenciales inválidas.', 'AUTH_FAILED');
      }

      let worker = await repo.getTrabajadorByAuthUserId(data.user.id);
      if (!worker && data.user.email) {
        const all = await repo.getTrabajadores();
        worker =
          all.find((w) => w.email_trabajador.toLowerCase() === data.user.email!.toLowerCase()) || null;
      }

      res.json({
        ok: true,
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_in: data.session.expires_in,
        user: {
          auth_user_id: data.user.id,
          email: data.user.email,
          rol_sistema: worker?.rol_sistema || 'TRABAJADOR',
          trabajador: worker,
        },
      });
    })
  );

  // Apply authentication middleware to all business endpoints below
  router.use(authenticate);

  router.get(
    '/auth/me',
    asyncHandler(async (req: Request, res: Response) => {
      const trabajador = req.authUser?.id_trabajador
        ? await repo.getTrabajadorById(req.authUser.id_trabajador)
        : null;
      res.json({
        ok: true,
        auth: req.authUser,
        trabajador,
      });
    })
  );

  // ==================== SUCURSALES ====================
  router.get(
    '/sucursales',
    asyncHandler(async (_req: Request, res: Response) => {
      const sucursales = await repo.getSucursales();
      res.json({ ok: true, count: sucursales.length, data: sucursales });
    })
  );

  router.get(
    '/sucursales/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const sucursal = await repo.getSucursalById(Number(req.params.id));
      res.json({ ok: true, data: sucursal });
    })
  );

  router.post(
    '/sucursales',
    requireRole('ADMIN'),
    asyncHandler(async (req: Request, res: Response) => {
      const created = await repo.createSucursal(req.body);
      broadcastSse('jssp_sync', { table: 'JSSP_SUCURSAL', eventType: 'INSERT' });
      res.status(201).json({ ok: true, data: created });
    })
  );

  router.put(
    '/sucursales/:id',
    requireRole('ADMIN'),
    asyncHandler(async (req: Request, res: Response) => {
      const updated = await repo.updateSucursal(Number(req.params.id), req.body);
      broadcastSse('jssp_sync', { table: 'JSSP_SUCURSAL', eventType: 'UPDATE' });
      res.json({ ok: true, data: updated });
    })
  );

  router.delete(
    '/sucursales/:id',
    requireRole('ADMIN'),
    asyncHandler(async (req: Request, res: Response) => {
      const result = await repo.deleteSucursal(Number(req.params.id));
      broadcastSse('jssp_sync', { table: 'JSSP_SUCURSAL', eventType: 'DELETE' });
      res.json({ ok: true, ...result });
    })
  );

  // ==================== TRABAJADORES ====================
  router.get(
    '/trabajadores',
    asyncHandler(async (req: Request, res: Response) => {
      const list = await repo.getTrabajadores({
        modalidad: req.query.modalidad ? String(req.query.modalidad) : undefined,
        id_sucursal: req.query.id_sucursal ? Number(req.query.id_sucursal) : undefined,
        search: req.query.search ? String(req.query.search) : undefined,
      });
      res.json({ ok: true, count: list.length, data: list });
    })
  );

  router.get(
    '/trabajadores/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const worker = await repo.getTrabajadorById(String(req.params.id).trim().toUpperCase());
      res.json({ ok: true, data: worker });
    })
  );

  router.post(
    '/trabajadores',
    requireRole('ADMIN'),
    asyncHandler(async (req: Request, res: Response) => {
      const created = await repo.createTrabajador(req.body);
      broadcastSse('jssp_sync', { table: 'JSSP_TRABAJADOR', eventType: 'INSERT' });
      res.status(201).json({ ok: true, data: created });
    })
  );

  router.put(
    '/trabajadores/:id',
    requireRole('ADMIN'),
    asyncHandler(async (req: Request, res: Response) => {
      const updated = await repo.updateTrabajador(
        String(req.params.id).trim().toUpperCase(),
        req.body
      );
      broadcastSse('jssp_sync', { table: 'JSSP_TRABAJADOR', eventType: 'UPDATE' });
      res.json({ ok: true, data: updated });
    })
  );

  router.delete(
    '/trabajadores/:id',
    requireRole('ADMIN'),
    asyncHandler(async (req: Request, res: Response) => {
      const result = await repo.deleteTrabajador(String(req.params.id).trim().toUpperCase());
      broadcastSse('jssp_sync', { table: 'JSSP_TRABAJADOR', eventType: 'DELETE' });
      res.json({ ok: true, ...result });
    })
  );

  // ==================== ASISTENCIA QR & PUNTUALIDAD ====================
  router.get(
    '/asistencia/qr/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const idTrabajador = String(req.params.id).trim().toUpperCase();
      const worker = await repo.getTrabajadorById(idTrabajador);
      if (worker.modalidad === 'ART22') {
        throw new ApiError(
          400,
          `El trabajador ${idTrabajador} está bajo Artículo 22 y no utiliza credencial QR de marcación.`
        );
      }

      const qr = await generateWorkerQrPng(worker.id_trabajador, worker.rut);
      if (req.query.format === 'json') {
        res.json({
          ok: true,
          id_trabajador: worker.id_trabajador,
          nombre_completo: `${worker.nombre_trabajador} ${worker.apellido_trabajador}`,
          payload: qr.payload,
          qr_payload_raw: JSON.stringify(qr.payload),
          dataUrl: qr.dataUrl,
        });
        return;
      }

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `inline; filename="QR_${worker.id_trabajador}.png"`);
      res.send(qr.pngBuffer);
    })
  );

  router.post(
    '/asistencia/marcar',
    asyncHandler(async (req: Request, res: Response) => {
      const body = req.body as {
        id_trabajador?: string;
        qr_payload?: string;
        tipo_marca?: TipoMarca;
        metodo_biometrico?: string;
      };
      const idTrabajador = parseAndVerifyQrInput({
        id_trabajador: body.id_trabajador,
        qr_payload: body.qr_payload,
      });

      const result = await repo.registrarMarcaAsistencia({
        id_trabajador: idTrabajador,
        tipo_marca: body.tipo_marca || 'ENTRADA',
        metodo_biometrico: body.metodo_biometrico || 'QR',
      });

      broadcastSse('jssp_sync', {
        table: 'JSSP_MARCA_ASISTENCIA',
        eventType: 'INSERT',
        id_trabajador: idTrabajador,
      });

      res.status(201).json({ ok: true, data: result });
    })
  );

  router.get(
    '/asistencia/marcas',
    asyncHandler(async (req: Request, res: Response) => {
      const snap = await repo.getSnapshot();
      let marcas = snap.marcas;

      if (req.query.id_trabajador) {
        const id = String(req.query.id_trabajador).trim().toUpperCase();
        marcas = marcas.filter((m) => m.id_trabajador_presencial === id);
      }
      if (req.query.tipo_marca) {
        const tipo = String(req.query.tipo_marca).trim().toUpperCase();
        marcas = marcas.filter((m) => m.tipo_marca === tipo);
      }
      if (req.query.mes && req.query.anio) {
        const mes = Number(req.query.mes);
        const anio = Number(req.query.anio);
        const actaIds = new Set(
          snap.actas.filter((a) => a.mes === mes && a.año === anio).map((a) => a.id_acta)
        );
        marcas = marcas.filter((m) => actaIds.has(m.id_acta));
      }

      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
      res.json({ ok: true, count: marcas.slice(0, limit).length, data: marcas.slice(0, limit) });
    })
  );

  router.get(
    '/asistencia/puntualidad',
    asyncHandler(async (req: Request, res: Response) => {
      const { mes, anio } = parsePeriodQuery(req);
      const tolerancia = Math.max(0, Math.min(60, Number(req.query.tolerancia) || 5));
      const sucursal = req.query.sucursal ? String(req.query.sucursal) : 'TODAS';

      const acta = await repo.getActaMensualAdmin(mes, anio);
      const rows =
        sucursal === 'TODAS'
          ? acta.asistencia_presencial
          : acta.asistencia_presencial.filter((r) => r.nombre_sucursal === sucursal);

      const trabajadores = rows.map((row) => ({
        id_trabajador: row.id_trabajador,
        rut: row.rut,
        nombre_completo: row.nombre_completo,
        sucursal: row.nombre_sucursal,
        turno_asignado: row.turno_asignado,
        total_dias_trabajados: row.total_dias_trabajados,
        estado_firma: row.estado_firma,
        ...summarizeWorkerPunctuality(row, tolerancia),
      }));

      const entradasTotales = trabajadores.reduce((s, w) => s + w.entradasTotales, 0);
      const entradasPuntuales = trabajadores.reduce((s, w) => s + w.entradasPuntuales, 0);
      const entradasConAtraso = trabajadores.reduce((s, w) => s + w.entradasConAtraso, 0);
      const minutosAtrasoTotal = trabajadores.reduce((s, w) => s + w.minutosAtrasoTotal, 0);

      res.json({
        ok: true,
        periodo: { mes, anio },
        tolerancia_minutos: tolerancia,
        sucursal,
        resumen_global: {
          trabajadores_presenciales: trabajadores.length,
          entradas_totales: entradasTotales,
          entradas_puntuales: entradasPuntuales,
          entradas_con_atraso: entradasConAtraso,
          minutos_atraso_total: minutosAtrasoTotal,
          tasa_puntualidad_global:
            entradasTotales > 0 ? Math.round((entradasPuntuales / entradasTotales) * 100) : 100,
        },
        trabajadores,
      });
    })
  );

  // ==================== ACTAS MENSUALES ====================
  router.get(
    '/actas',
    asyncHandler(async (req: Request, res: Response) => {
      const snap = await repo.getSnapshot();
      let actas = snap.actas;
      if (req.query.mes) actas = actas.filter((a) => Number(a.mes) === Number(req.query.mes));
      if (req.query.anio) actas = actas.filter((a) => Number(a.año) === Number(req.query.anio));
      if (req.query.id_trabajador) {
        const id = String(req.query.id_trabajador).trim().toUpperCase();
        actas = actas.filter((a) => a.id_trabajador === id);
      }
      if (req.query.estado_firma) {
        const est = String(req.query.estado_firma).trim().toUpperCase();
        actas = actas.filter((a) => a.estado_firma.toUpperCase() === est);
      }
      res.json({ ok: true, count: actas.length, data: actas });
    })
  );

  router.get(
    '/actas/admin',
    requireRole('ADMIN'),
    asyncHandler(async (req: Request, res: Response) => {
      const { mes, anio } = parsePeriodQuery(req);
      const data = await repo.getActaMensualAdmin(mes, anio);
      res.json({ ok: true, data });
    })
  );

  router.patch(
    '/actas/:idActa/firmar',
    asyncHandler(async (req: Request, res: Response) => {
      const idActa = String(req.params.idActa).trim();
      const estado = String(req.body?.estado_firma || 'FIRMADA').trim().toUpperCase();
      if (!['FIRMADA', 'PENDIENTE', 'OBSERVADA'].includes(estado)) {
        throw new ApiError(400, 'estado_firma debe ser FIRMADA, PENDIENTE u OBSERVADA.');
      }

      if (
        env.requireAuth &&
        req.authUser?.rol_sistema !== 'ADMIN' &&
        req.authUser?.id_trabajador
      ) {
        const snap = await repo.getSnapshot();
        const target = snap.actas.find((a) => a.id_acta === idActa);
        if (!target) throw new ApiError(404, 'Acta mensual no encontrada.');
        if (target.id_trabajador !== req.authUser.id_trabajador) {
          throw new ApiError(403, 'Solo puede firmar su propia acta mensual.');
        }
      }

      const updated = await repo.signActa(idActa, estado);
      broadcastSse('jssp_sync', { table: 'JSSP_ACTA_ASISTENCIA_MENSUAL', eventType: 'UPDATE' });
      res.json({ ok: true, data: updated });
    })
  );

  // ==================== PRODUCTOS, METAS, VENTAS & COMISIONES ART. 22 ====================
  router.get(
    '/productos',
    asyncHandler(async (_req: Request, res: Response) => {
      const snap = await repo.getSnapshot();
      res.json({ ok: true, count: snap.productos.length, data: snap.productos });
    })
  );

  router.post(
    '/productos',
    requireRole('ADMIN'),
    asyncHandler(async (req: Request, res: Response) => {
      const created = await repo.createProducto(req.body);
      res.status(201).json({ ok: true, data: created });
    })
  );

  router.put(
    '/productos/:codigo',
    requireRole('ADMIN'),
    asyncHandler(async (req: Request, res: Response) => {
      const updated = await repo.updateProducto(Number(req.params.codigo), req.body);
      res.json({ ok: true, data: updated });
    })
  );

  router.delete(
    '/productos/:codigo',
    requireRole('ADMIN'),
    asyncHandler(async (req: Request, res: Response) => {
      const result = await repo.deleteProducto(Number(req.params.codigo));
      res.json({ ok: true, ...result });
    })
  );

  router.get(
    '/metas',
    asyncHandler(async (_req: Request, res: Response) => {
      const snap = await repo.getSnapshot();
      res.json({ ok: true, count: snap.metas.length, data: snap.metas });
    })
  );

  router.get(
    '/metas/:id',
    asyncHandler(async (req: Request, res: Response) => {
      const snap = await repo.getSnapshot();
      const idMeta = Number(req.params.id);
      const meta = snap.metas.find((m) => Number(m.id_meta) === idMeta);
      if (!meta) throw new ApiError(404, `Meta ${idMeta} no encontrada.`);
      const detalles = snap.detallesVenta.filter((d) => Number(d.id_meta) === idMeta);
      res.json({ ok: true, data: { ...meta, detalles } });
    })
  );

  router.post(
    '/metas',
    requireRole('ADMIN'),
    asyncHandler(async (req: Request, res: Response) => {
      const created = await repo.createMeta(req.body);
      broadcastSse('jssp_sync', { table: 'JSSP_META_VENTA', eventType: 'INSERT' });
      res.status(201).json({ ok: true, data: created });
    })
  );

  router.put(
    '/metas/:id',
    requireRole('ADMIN'),
    asyncHandler(async (req: Request, res: Response) => {
      const updated = await repo.updateMeta(Number(req.params.id), req.body);
      broadcastSse('jssp_sync', { table: 'JSSP_META_VENTA', eventType: 'UPDATE' });
      res.json({ ok: true, data: updated });
    })
  );

  router.get(
    '/ventas',
    asyncHandler(async (_req: Request, res: Response) => {
      const snap = await repo.getSnapshot();
      const data = snap.ventas.map((v) => ({
        ...v,
        detalles: snap.detallesVenta.filter((d) => d.id_venta === v.codigo_venta),
      }));
      res.json({ ok: true, count: data.length, data });
    })
  );

  router.get(
    '/ventas/:codigo',
    asyncHandler(async (req: Request, res: Response) => {
      const venta = await repo.getVentaByCodigo(Number(req.params.codigo));
      res.json({ ok: true, data: venta });
    })
  );

  router.post(
    '/ventas',
    asyncHandler(async (req: Request, res: Response) => {
      const created = await repo.registrarVenta(req.body);
      broadcastSse('jssp_sync', { table: 'JSSP_VENTA', eventType: 'INSERT' });
      res.status(201).json({ ok: true, data: created });
    })
  );

  router.get(
    '/comisiones/art22',
    asyncHandler(async (_req: Request, res: Response) => {
      const comisiones = await repo.getComisionesArt22();
      res.json({ ok: true, count: comisiones.length, data: comisiones });
    })
  );

  // ==================== REPORTES PDF, PROGRAMACIÓN & CORREOS ====================
  router.get(
    '/reportes/puntualidad/pdf',
    asyncHandler(async (req: Request, res: Response) => {
      const { mes, anio } = parsePeriodQuery(req);
      const tolerancia = Math.max(0, Math.min(60, Number(req.query.tolerancia) || 5));
      const sucursalFiltro = req.query.sucursal ? String(req.query.sucursal) : 'TODAS';

      const acta = await repo.getActaMensualAdmin(mes, anio);
      const pdf = buildPunctualityPdfBuffer(acta, {
        toleranciaMinutos: tolerancia,
        sucursalFiltro,
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${pdf.fileName}"`);
      res.send(pdf.buffer);
    })
  );

  router.get(
    '/reportes/comisiones-art22/pdf',
    asyncHandler(async (_req: Request, res: Response) => {
      const comisiones = await repo.getComisionesArt22();
      const pdf = buildArt22CommissionsPdfBuffer(comisiones);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${pdf.fileName}"`);
      res.send(pdf.buffer);
    })
  );

  router.post(
    '/reportes/puntualidad/enviar',
    requireRole('ADMIN'),
    asyncHandler(async (req: Request, res: Response) => {
      const { mes, anio } = parsePeriodQuery(req);
      const sched = repo.getSchedule();
      const emailAdmin = String(req.body?.email_admin || sched.emailAdmin || '').trim();
      if (!emailAdmin) {
        throw new ApiError(400, 'Debe especificar email_admin para enviar el reporte.');
      }

      const tolerancia = Math.max(
        0,
        Math.min(60, Number(req.body?.tolerancia ?? sched.toleranciaMinutos ?? 5))
      );
      const sucursalFiltro = req.body?.sucursal ? String(req.body.sucursal) : 'TODAS';

      const acta = await repo.getActaMensualAdmin(mes, anio);
      const pdf = buildPunctualityPdfBuffer(acta, {
        toleranciaMinutos: tolerancia,
        sucursalFiltro,
      });
      const now = getChileDateParts(new Date());
      const html = buildAdminReportEmailHtml({
        mes,
        anio,
        fileName: pdf.fileName,
        tasaPuntualidad: pdf.tasaPuntualidadGlobal,
        totalAtrasos: pdf.totalAtrasos,
        fechaEmision: now.displayStr,
      });

      const delivery = await dispatchEmail({
        to: emailAdmin,
        subject: `Reporte de Puntualidad JSSP (${mes}/${anio})`,
        html,
        attachment: { filename: pdf.fileName, content: pdf.buffer },
      });

      repo.updateSchedule({ ultimoEnvio: new Date().toISOString() });
      res.json({
        ok: true,
        data: {
          to: emailAdmin,
          fileName: pdf.fileName,
          tasaPuntualidadGlobal: pdf.tasaPuntualidadGlobal,
          totalAtrasos: pdf.totalAtrasos,
          delivery,
        },
      });
    })
  );

  router.get('/reportes/programacion', (_req: Request, res: Response) => {
    res.json({ ok: true, data: repo.getSchedule() });
  });

  router.put(
    '/reportes/programacion',
    requireRole('ADMIN'),
    (req: Request, res: Response) => {
      const body = req.body as Partial<{
        activo: boolean;
        frecuencia: 'DIARIO' | 'SEMANAL' | 'MENSUAL';
        horaEjecucion: string;
        emailAdmin: string;
        toleranciaMinutos: number;
      }>;
      if (body.frecuencia && !['DIARIO', 'SEMANAL', 'MENSUAL'].includes(body.frecuencia)) {
        throw new ApiError(400, 'frecuencia debe ser DIARIO, SEMANAL o MENSUAL.');
      }
      if (body.horaEjecucion && !/^\d{2}:\d{2}$/.test(body.horaEjecucion)) {
        throw new ApiError(400, 'horaEjecucion debe tener formato HH:MM.');
      }
      const updated = repo.updateSchedule(body);
      res.json({ ok: true, data: updated });
    }
  );

  router.get('/correos/logs', (_req: Request, res: Response) => {
    const logs = repo.getEmailLogs();
    res.json({ ok: true, count: logs.length, data: logs });
  });

  router.post(
    '/correos/reenviar/:idMarca',
    requireRole('ADMIN'),
    asyncHandler(async (req: Request, res: Response) => {
      const idMarca = Number(req.params.idMarca);
      const snap = await repo.getSnapshot();
      const marca = snap.marcas.find((m) => Number(m.id_marca) === idMarca);
      if (!marca) throw new ApiError(404, `Marca ${idMarca} no encontrada.`);

      const trab = snap.trabajadores.find(
        (t) => t.id_trabajador === marca.id_trabajador_presencial
      );
      if (!trab?.email_trabajador) {
        throw new ApiError(400, 'El trabajador no tiene email_trabajador configurado.');
      }
      const suc = snap.sucursales.find((s) => Number(s.id_sucursal) === Number(trab.id_sucursal));
      const clock = getChileDateParts(new Date(marca.fecha_hora));
      const nombreCompleto = `${trab.nombre_trabajador} ${trab.apellido_trabajador}`;

      const html = buildAttendanceEmailHtml({
        nombreCompleto,
        rut: trab.rut,
        tipoMarca: marca.tipo_marca,
        fechaHoraLocal: clock.displayStr,
        sucursal: suc?.nombre_sucursal || 'Sucursal Principal',
        metodoBiometrico: marca.metodo_biometrico,
        idActa: marca.id_acta,
        idMarca: marca.id_marca,
      });

      const delivery = await dispatchEmail({
        to: trab.email_trabajador,
        subject: `Reenvío Comprobante Marcación (${marca.tipo_marca}) — ${clock.displayStr}`,
        html,
      });

      if (delivery.sent) {
        await repo.markEmailBackupSent(marca.id_marca);
      }

      const logRow = {
        id: crypto.randomUUID(),
        id_marca: marca.id_marca,
        id_trabajador: trab.id_trabajador,
        nombre_completo: nombreCompleto,
        email_trabajador: trab.email_trabajador,
        tipo_marca: marca.tipo_marca,
        fecha_hora_local: clock.displayStr,
        id_acta: marca.id_acta,
        sent: delivery.sent,
        mode: delivery.mode,
        messageId: delivery.messageId,
        previewHtml: html,
        timestamp: new Date().toISOString(),
      };
      repo.recordEmailLog(logRow);

      res.json({ ok: true, data: logRow });
    })
  );

  return router;
}
