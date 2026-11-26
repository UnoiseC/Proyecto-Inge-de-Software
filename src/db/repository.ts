import crypto from 'node:crypto';
import { Pool } from 'pg';
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env.ts';
import { ApiError } from '../middleware/errorHandler.ts';
import { buildAttendanceEmailHtml, dispatchEmail } from '../services/emailService.ts';
import { getChileDateParts } from '../services/timeService.ts';
import type {
  ActaMensualAdminResponse,
  ComisionArt22Resumen,
  EmailLogRow,
  JsspActaAsistenciaMensual,
  JsspDetalleVenta,
  JsspMarcaAsistencia,
  JsspMetaVenta,
  JsspProducto,
  JsspSnapshot,
  JsspSucursal,
  JsspTrabajador,
  JsspTrabajadorPresencial,
  JsspVendedorTerreno,
  JsspVenta,
  ScheduleConfig,
  TipoMarca,
  TrabajadorCompleto,
} from '../types/database.ts';

export type DbBackendMode = 'supabase' | 'postgres' | 'memory';

function createInitialMemoryStore() {
  const nowParts = getChileDateParts(new Date());
  const anio = nowParts.year;
  const mes = nowParts.month;
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const ym = `${anio}-${pad2(mes)}`;
  const d1 = pad2(Math.max(1, nowParts.day - 2));
  const d2 = pad2(Math.max(1, nowParts.day - 1));
  const lastDay = new Date(anio, mes, 0).getDate();

  const sucursales: JsspSucursal[] = [
    {
      id_sucursal: 1,
      nombre_sucursal: 'Casa Matriz Providencia',
      tipo_sucursal: 'Corporativa',
      dirección_sucursal: 'Av. Providencia 1650, Santiago',
    },
    {
      id_sucursal: 2,
      nombre_sucursal: 'Sucursal Las Condes',
      tipo_sucursal: 'Comercial',
      dirección_sucursal: 'Av. Apoquindo 4499, Las Condes',
    },
    {
      id_sucursal: 3,
      nombre_sucursal: 'Centro Logístico Maipú',
      tipo_sucursal: 'Operaciones',
      dirección_sucursal: 'Camino a Melipilla 7840, Maipú',
    },
  ];

  const trabajadores: JsspTrabajador[] = [
    { id_trabajador: 'TRAB-001', rut: '16.482.910-4', nombre_trabajador: 'Camila', apellido_trabajador: 'Valdivia', email_trabajador: 'camila.valdivia@empresa-jssp.cl', sueldo_base_trabajador: 1150000, id_sucursal: 1, rol_sistema: 'TRABAJADOR' },
    { id_trabajador: 'TRAB-002', rut: '18.219.344-K', nombre_trabajador: 'Matías', apellido_trabajador: 'Riquelme', email_trabajador: 'matias.riquelme@empresa-jssp.cl', sueldo_base_trabajador: 980000, id_sucursal: 1, rol_sistema: 'TRABAJADOR' },
    { id_trabajador: 'TRAB-003', rut: '15.904.112-2', nombre_trabajador: 'Fernanda', apellido_trabajador: 'Castillo', email_trabajador: 'fernanda.castillo@empresa-jssp.cl', sueldo_base_trabajador: 1050000, id_sucursal: 2, rol_sistema: 'TRABAJADOR' },
    { id_trabajador: 'TRAB-004', rut: '19.330.875-1', nombre_trabajador: 'Diego', apellido_trabajador: 'Fuentes', email_trabajador: 'diego.fuentes@empresa-jssp.cl', sueldo_base_trabajador: 890000, id_sucursal: 3, rol_sistema: 'TRABAJADOR' },
    { id_trabajador: 'TRAB-005', rut: '14.772.601-8', nombre_trabajador: 'Valentina', apellido_trabajador: 'Soto', email_trabajador: 'valentina.soto@empresa-jssp.cl', sueldo_base_trabajador: 920000, id_sucursal: 2, rol_sistema: 'ADMIN' },
    { id_trabajador: 'VEND-001', rut: '17.615.409-3', nombre_trabajador: 'Sebastián', apellido_trabajador: 'Mancilla', email_trabajador: 'sebpintomanci@gmail.com', sueldo_base_trabajador: 1200000, id_sucursal: 1, rol_sistema: 'TRABAJADOR' },
    { id_trabajador: 'VEND-002', rut: '16.889.205-6', nombre_trabajador: 'Ignacia', apellido_trabajador: 'Lagos', email_trabajador: 'ignacia.lagos@empresa-jssp.cl', sueldo_base_trabajador: 1100000, id_sucursal: 2, rol_sistema: 'TRABAJADOR' },
    { id_trabajador: 'VEND-003', rut: '18.041.773-9', nombre_trabajador: 'Tomás', apellido_trabajador: 'Herrera', email_trabajador: 'tomas.herrera@empresa-jssp.cl', sueldo_base_trabajador: 950000, id_sucursal: 3, rol_sistema: 'TRABAJADOR' },
  ];

  const presenciales: JsspTrabajadorPresencial[] = [
    { id_trabajador: 'TRAB-001', rol: 'Analista de Operaciones', turno_asignado: '09:00 - 18:00' },
    { id_trabajador: 'TRAB-002', rol: 'Soporte Técnico TI', turno_asignado: '09:00 - 18:00' },
    { id_trabajador: 'TRAB-003', rol: 'Ejecutiva Sucursal', turno_asignado: '08:30 - 17:30' },
    { id_trabajador: 'TRAB-004', rol: 'Coordinador Bodega', turno_asignado: '08:00 - 17:00' },
    { id_trabajador: 'TRAB-005', rol: 'Asistente Administrativa', turno_asignado: '09:00 - 18:00' },
  ];

  const vendedores: JsspVendedorTerreno[] = [
    { id_trabajador: 'VEND-001', es_articulo22: true, zona_cobertura: 'Zona Oriente Corporativa' },
    { id_trabajador: 'VEND-002', es_articulo22: true, zona_cobertura: 'Zona Centro-Norte' },
    { id_trabajador: 'VEND-003', es_articulo22: true, zona_cobertura: 'Zona Industrial Sur' },
  ];

  const actas: JsspActaAsistenciaMensual[] = presenciales.map((p) => ({
    id_acta: `ACTA-${anio}-${pad2(mes)}-${p.id_trabajador}`,
    mes,
    año: anio,
    total_dias_trabajados: p.id_trabajador === 'TRAB-005' ? 1 : 2,
    estado_firma: p.id_trabajador === 'TRAB-003' ? 'FIRMADA' : 'PENDIENTE',
    id_trabajador: p.id_trabajador,
    fecha_generacion: new Date().toISOString(),
  }));

  const marcas: JsspMarcaAsistencia[] = [
    { id_marca: 1, id_trabajador_presencial: 'TRAB-001', fecha_hora: `${ym}-${d1}T08:56:12-03:00`, tipo_marca: 'ENTRADA', metodo_biometrico: 'QR', respaldo_email: true, id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-001` },
    { id_marca: 2, id_trabajador_presencial: 'TRAB-001', fecha_hora: `${ym}-${d1}T18:04:40-03:00`, tipo_marca: 'SALIDA', metodo_biometrico: 'QR', respaldo_email: true, id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-001` },
    { id_marca: 3, id_trabajador_presencial: 'TRAB-001', fecha_hora: `${ym}-${d2}T09:02:18-03:00`, tipo_marca: 'ENTRADA', metodo_biometrico: 'QR', respaldo_email: true, id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-001` },
    { id_marca: 4, id_trabajador_presencial: 'TRAB-001', fecha_hora: `${ym}-${d2}T18:01:05-03:00`, tipo_marca: 'SALIDA', metodo_biometrico: 'QR', respaldo_email: true, id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-001` },
    { id_marca: 5, id_trabajador_presencial: 'TRAB-002', fecha_hora: `${ym}-${d1}T09:14:22-03:00`, tipo_marca: 'ENTRADA', metodo_biometrico: 'QR', respaldo_email: true, id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-002` },
    { id_marca: 6, id_trabajador_presencial: 'TRAB-002', fecha_hora: `${ym}-${d1}T18:10:00-03:00`, tipo_marca: 'SALIDA', metodo_biometrico: 'QR', respaldo_email: true, id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-002` },
    { id_marca: 7, id_trabajador_presencial: 'TRAB-002', fecha_hora: `${ym}-${d2}T09:19:45-03:00`, tipo_marca: 'ENTRADA', metodo_biometrico: 'QR', respaldo_email: true, id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-002` },
    { id_marca: 8, id_trabajador_presencial: 'TRAB-003', fecha_hora: `${ym}-${d1}T08:25:10-03:00`, tipo_marca: 'ENTRADA', metodo_biometrico: 'QR', respaldo_email: true, id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-003` },
    { id_marca: 9, id_trabajador_presencial: 'TRAB-003', fecha_hora: `${ym}-${d1}T17:32:51-03:00`, tipo_marca: 'SALIDA', metodo_biometrico: 'QR', respaldo_email: true, id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-003` },
    { id_marca: 10, id_trabajador_presencial: 'TRAB-003', fecha_hora: `${ym}-${d2}T08:28:04-03:00`, tipo_marca: 'ENTRADA', metodo_biometrico: 'QR', respaldo_email: true, id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-003` },
    { id_marca: 11, id_trabajador_presencial: 'TRAB-003', fecha_hora: `${ym}-${d2}T17:30:12-03:00`, tipo_marca: 'SALIDA', metodo_biometrico: 'QR', respaldo_email: true, id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-003` },
    { id_marca: 12, id_trabajador_presencial: 'TRAB-004', fecha_hora: `${ym}-${d1}T07:55:00-03:00`, tipo_marca: 'ENTRADA', metodo_biometrico: 'HUELLA', respaldo_email: true, id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-004` },
    { id_marca: 13, id_trabajador_presencial: 'TRAB-004', fecha_hora: `${ym}-${d1}T17:05:19-03:00`, tipo_marca: 'SALIDA', metodo_biometrico: 'HUELLA', respaldo_email: true, id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-004` },
    { id_marca: 14, id_trabajador_presencial: 'TRAB-004', fecha_hora: `${ym}-${d2}T08:11:37-03:00`, tipo_marca: 'ENTRADA', metodo_biometrico: 'QR', respaldo_email: true, id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-004` },
    { id_marca: 15, id_trabajador_presencial: 'TRAB-004', fecha_hora: `${ym}-${d2}T17:02:10-03:00`, tipo_marca: 'SALIDA', metodo_biometrico: 'QR', respaldo_email: true, id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-004` },
    { id_marca: 16, id_trabajador_presencial: 'TRAB-005', fecha_hora: `${ym}-${d2}T08:59:14-03:00`, tipo_marca: 'ENTRADA', metodo_biometrico: 'QR', respaldo_email: true, id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-005` },
    { id_marca: 17, id_trabajador_presencial: 'TRAB-005', fecha_hora: `${ym}-${d2}T18:00:44-03:00`, tipo_marca: 'SALIDA', metodo_biometrico: 'QR', respaldo_email: true, id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-005` },
  ];

  const productos: JsspProducto[] = [
    { codigo_producto: 101, nombre_producto: 'Plan Enterprise Control Biométrico (Anual)', categoria_producto: 'Software SaaS', porcentaje_comision_producto: 8.5 },
    { codigo_producto: 102, nombre_producto: 'Tótem Lector QR Industrial Pro', categoria_producto: 'Hardware', porcentaje_comision_producto: 5.0 },
    { codigo_producto: 103, nombre_producto: 'Licencia Módulo Nómina & Art. 22', categoria_producto: 'Software SaaS', porcentaje_comision_producto: 10.0 },
    { codigo_producto: 104, nombre_producto: 'Servicio Implementación Multi-Sucursal', categoria_producto: 'Servicios', porcentaje_comision_producto: 6.5 },
  ];

  const metas: JsspMetaVenta[] = [
    { id_meta: 1, fecha_inicio: `${ym}-01`, fecha_fin: `${ym}-${pad2(lastDay)}`, monto_objetivo: 18000000, monto_actual: 13450000, estado: 'EN_PROGRESO' },
    { id_meta: 2, fecha_inicio: `${ym}-01`, fecha_fin: `${ym}-15`, monto_objetivo: 6500000, monto_actual: 7200000, estado: 'CUMPLIDA' },
  ];

  const ventas: JsspVenta[] = [
    { codigo_venta: 1001, fecha: `${ym}-04T11:20:00-03:00`, monto_total: 5200000 },
    { codigo_venta: 1002, fecha: `${ym}-08T15:45:00-03:00`, monto_total: 4150000 },
    { codigo_venta: 1003, fecha: `${ym}-12T10:15:00-03:00`, monto_total: 4100000 },
    { codigo_venta: 1004, fecha: `${ym}-14T16:30:00-03:00`, monto_total: 7200000 },
  ];

  const detallesVenta: JsspDetalleVenta[] = [
    { id_detalle: 1, id_venta: 1001, id_vendedor: 'VEND-001', codigo_producto: 101, id_meta: 1, cantidad: 2, precio_unitario: 1850000, subtotal: 3700000 },
    { id_detalle: 2, id_venta: 1001, id_vendedor: 'VEND-001', codigo_producto: 102, id_meta: 1, cantidad: 2, precio_unitario: 750000, subtotal: 1500000 },
    { id_detalle: 3, id_venta: 1002, id_vendedor: 'VEND-002', codigo_producto: 103, id_meta: 1, cantidad: 2, precio_unitario: 1450000, subtotal: 2900000 },
    { id_detalle: 4, id_venta: 1002, id_vendedor: 'VEND-002', codigo_producto: 104, id_meta: 1, cantidad: 1, precio_unitario: 1250000, subtotal: 1250000 },
    { id_detalle: 5, id_venta: 1003, id_vendedor: 'VEND-003', codigo_producto: 101, id_meta: 1, cantidad: 2, precio_unitario: 1650000, subtotal: 3300000 },
    { id_detalle: 6, id_venta: 1003, id_vendedor: 'VEND-003', codigo_producto: 102, id_meta: 1, cantidad: 1, precio_unitario: 800000, subtotal: 800000 },
    { id_detalle: 7, id_venta: 1004, id_vendedor: 'VEND-001', codigo_producto: 103, id_meta: 2, cantidad: 4, precio_unitario: 1800000, subtotal: 7200000 },
  ];

  return {
    sucursales,
    trabajadores,
    presenciales,
    vendedores,
    actas,
    marcas,
    productos,
    metas,
    ventas,
    detallesVenta,
    emailLogs: [] as EmailLogRow[],
    schedule: {
      activo: true,
      frecuencia: 'DIARIO',
      horaEjecucion: '18:30',
      emailAdmin: 'rrhh-admin@empresa-jssp.cl',
      toleranciaMinutos: 5,
    } as ScheduleConfig,
    nextSucursalId: 4,
    nextMarcaId: 18,
    nextMetaId: 3,
    nextProductoId: 105,
    nextVentaId: 1005,
    nextDetalleId: 8,
  };
}

export class JsspRepository {
  readonly mode: DbBackendMode;
  private pgPool: Pool | null = null;
  private supabase: SupabaseClient | null = null;
  private supabaseAuthClient: SupabaseClient | null = null;
  private realtimeChannel: RealtimeChannel | null = null;
  private mem = createInitialMemoryStore();

  constructor() {
    const sbUrl = env.supabaseUrl;
    const sbKey = env.supabaseServiceRoleKey || env.supabaseAnonKey;

    if (sbUrl && sbKey) {
      this.mode = 'supabase';
      this.supabase = createClient(sbUrl, sbKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      if (env.supabaseAnonKey || sbKey) {
        this.supabaseAuthClient = createClient(sbUrl, env.supabaseAnonKey || sbKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
      }
    } else if (env.databaseUrl) {
      this.mode = 'postgres';
      this.pgPool = new Pool({
        connectionString: env.databaseUrl,
        ssl:
          env.databaseUrl.includes('localhost') || env.databaseUrl.includes('127.0.0.1')
            ? false
            : { rejectUnauthorized: false },
      });
    } else {
      this.mode = 'memory';
    }
  }

  getSupabaseClient(): SupabaseClient | null {
    return this.supabase;
  }

  getSupabaseAuthClient(): SupabaseClient | null {
    return this.supabaseAuthClient;
  }

  subscribeToSupabaseRealtime(onEvent: (table: string, eventType: string) => void) {
    if (!this.supabase || this.realtimeChannel) return;
    this.realtimeChannel = this.supabase
      .channel('jssp-backend-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'JSSP_MARCA_ASISTENCIA' }, (p) =>
        onEvent('JSSP_MARCA_ASISTENCIA', p.eventType)
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'JSSP_ACTA_ASISTENCIA_MENSUAL' }, (p) =>
        onEvent('JSSP_ACTA_ASISTENCIA_MENSUAL', p.eventType)
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'JSSP_META_VENTA' }, (p) =>
        onEvent('JSSP_META_VENTA', p.eventType)
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'JSSP_DETALLE_VENTA' }, (p) =>
        onEvent('JSSP_DETALLE_VENTA', p.eventType)
      )
      .subscribe();
  }

  getSchedule(): ScheduleConfig {
    return this.mem.schedule;
  }

  updateSchedule(next: Partial<ScheduleConfig>): ScheduleConfig {
    this.mem.schedule = {
      ...this.mem.schedule,
      ...next,
      toleranciaMinutos: Math.max(
        0,
        Math.min(60, Number(next.toleranciaMinutos ?? this.mem.schedule.toleranciaMinutos))
      ),
    };
    return this.mem.schedule;
  }

  getEmailLogs(): EmailLogRow[] {
    return this.mem.emailLogs.slice(0, 100);
  }

  recordEmailLog(log: EmailLogRow) {
    this.mem.emailLogs.unshift(log);
  }

  async checkDatabaseHealth(): Promise<{ connected: boolean; latencyMs: number; detail?: string }> {
    const start = Date.now();
    try {
      if (this.mode === 'supabase' && this.supabase) {
        const { error } = await this.supabase.from('JSSP_SUCURSAL').select('id_sucursal').limit(1);
        if (error) return { connected: false, latencyMs: Date.now() - start, detail: error.message };
        return { connected: true, latencyMs: Date.now() - start };
      }
      if (this.mode === 'postgres' && this.pgPool) {
        await this.pgPool.query('SELECT 1');
        return { connected: true, latencyMs: Date.now() - start };
      }
      return { connected: true, latencyMs: 0, detail: 'In-memory sandbox (sin SUPABASE_URL ni DATABASE_URL)' };
    } catch (err) {
      return {
        connected: false,
        latencyMs: Date.now() - start,
        detail: err instanceof Error ? err.message : 'Error de conexión',
      };
    }
  }

  async getSnapshot(): Promise<JsspSnapshot> {
    if (this.mode === 'supabase' && this.supabase) {
      const [s, t, p, v, a, m, pr, mt, vt, dv] = await Promise.all([
        this.supabase.from('JSSP_SUCURSAL').select('*').order('id_sucursal'),
        this.supabase.from('JSSP_TRABAJADOR').select('*').order('apellido_trabajador'),
        this.supabase.from('JSSP_TRABAJADOR_PRESENCIAL').select('*'),
        this.supabase.from('JSSP_VENDEDOR_TERRENO').select('*'),
        this.supabase.from('JSSP_ACTA_ASISTENCIA_MENSUAL').select('*'),
        this.supabase.from('JSSP_MARCA_ASISTENCIA').select('*').order('fecha_hora', { ascending: false }).limit(500),
        this.supabase.from('JSSP_PRODUCTO').select('*').order('codigo_producto'),
        this.supabase.from('JSSP_META_VENTA').select('*').order('fecha_inicio', { ascending: false }),
        this.supabase.from('JSSP_VENTA').select('*').order('fecha', { ascending: false }).limit(200),
        this.supabase.from('JSSP_DETALLE_VENTA').select('*').order('id_detalle', { ascending: false }).limit(500),
      ]);
      const err = s.error || t.error || p.error || v.error || a.error || m.error || pr.error || mt.error || vt.error || dv.error;
      if (err) throw new ApiError(502, err.message);
      return {
        sucursales: (s.data || []) as JsspSucursal[],
        trabajadores: (t.data || []) as JsspTrabajador[],
        presenciales: (p.data || []) as JsspTrabajadorPresencial[],
        vendedores: (v.data || []) as JsspVendedorTerreno[],
        actas: (a.data || []) as JsspActaAsistenciaMensual[],
        marcas: (m.data || []) as JsspMarcaAsistencia[],
        productos: (pr.data || []) as JsspProducto[],
        metas: (mt.data || []) as JsspMetaVenta[],
        ventas: (vt.data || []) as JsspVenta[],
        detallesVenta: (dv.data || []) as JsspDetalleVenta[],
        emailLogs: this.getEmailLogs(),
        schedule: this.mem.schedule,
      };
    }

    if (this.mode === 'postgres' && this.pgPool) {
      const [s, t, p, v, a, m, pr, mt, vt, dv] = await Promise.all([
        this.pgPool.query<JsspSucursal>('SELECT * FROM public."JSSP_SUCURSAL" ORDER BY id_sucursal'),
        this.pgPool.query<JsspTrabajador>('SELECT * FROM public."JSSP_TRABAJADOR" ORDER BY apellido_trabajador'),
        this.pgPool.query<JsspTrabajadorPresencial>('SELECT * FROM public."JSSP_TRABAJADOR_PRESENCIAL"'),
        this.pgPool.query<JsspVendedorTerreno>('SELECT * FROM public."JSSP_VENDEDOR_TERRENO"'),
        this.pgPool.query<JsspActaAsistenciaMensual>('SELECT * FROM public."JSSP_ACTA_ASISTENCIA_MENSUAL"'),
        this.pgPool.query<JsspMarcaAsistencia>('SELECT * FROM public."JSSP_MARCA_ASISTENCIA" ORDER BY fecha_hora DESC LIMIT 500'),
        this.pgPool.query<JsspProducto>('SELECT * FROM public."JSSP_PRODUCTO" ORDER BY codigo_producto'),
        this.pgPool.query<JsspMetaVenta>('SELECT * FROM public."JSSP_META_VENTA" ORDER BY fecha_inicio DESC'),
        this.pgPool.query<JsspVenta>('SELECT * FROM public."JSSP_VENTA" ORDER BY fecha DESC LIMIT 200'),
        this.pgPool.query<JsspDetalleVenta>('SELECT * FROM public."JSSP_DETALLE_VENTA" ORDER BY id_detalle DESC LIMIT 500'),
      ]);
      return {
        sucursales: s.rows,
        trabajadores: t.rows,
        presenciales: p.rows,
        vendedores: v.rows,
        actas: a.rows,
        marcas: m.rows,
        productos: pr.rows,
        metas: mt.rows,
        ventas: vt.rows,
        detallesVenta: dv.rows,
        emailLogs: this.getEmailLogs(),
        schedule: this.mem.schedule,
      };
    }

    return {
      sucursales: this.mem.sucursales,
      trabajadores: this.mem.trabajadores,
      presenciales: this.mem.presenciales,
      vendedores: this.mem.vendedores,
      actas: this.mem.actas,
      marcas: [...this.mem.marcas].sort(
        (a, b) => new Date(b.fecha_hora).getTime() - new Date(a.fecha_hora).getTime()
      ),
      productos: this.mem.productos,
      metas: this.mem.metas,
      ventas: this.mem.ventas,
      detallesVenta: this.mem.detallesVenta,
      emailLogs: this.getEmailLogs(),
      schedule: this.mem.schedule,
    };
  }

  // ==================== SUCURSALES ====================
  async getSucursales(): Promise<JsspSucursal[]> {
    const snap = await this.getSnapshot();
    return snap.sucursales;
  }

  async getSucursalById(idSucursal: number): Promise<JsspSucursal> {
    const all = await this.getSucursales();
    const found = all.find((s) => Number(s.id_sucursal) === Number(idSucursal));
    if (!found) throw new ApiError(404, `Sucursal ${idSucursal} no encontrada.`);
    return found;
  }

  async createSucursal(payload: {
    id_sucursal?: number;
    nombre_sucursal: string;
    tipo_sucursal?: string;
    dirección_sucursal?: string;
    direccion_sucursal?: string;
  }): Promise<JsspSucursal> {
    const nombre = payload.nombre_sucursal?.trim();
    if (!nombre) throw new ApiError(400, 'nombre_sucursal es obligatorio.');
    const direccion = (payload.dirección_sucursal ?? payload.direccion_sucursal ?? null) || null;
    const tipo = payload.tipo_sucursal?.trim() || null;

    const existing = await this.getSucursales();
    const nextId =
      payload.id_sucursal !== undefined
        ? Number(payload.id_sucursal)
        : existing.reduce((max, s) => Math.max(max, Number(s.id_sucursal)), 0) + 1;

    if (this.mode === 'supabase' && this.supabase) {
      const { data, error } = await this.supabase
        .from('JSSP_SUCURSAL')
        .insert({
          id_sucursal: nextId,
          nombre_sucursal: nombre,
          tipo_sucursal: tipo,
          dirección_sucursal: direccion,
        })
        .select('*')
        .single();
      if (error) throw new ApiError(400, error.message);
      return data as JsspSucursal;
    }

    if (this.mode === 'postgres' && this.pgPool) {
      const res = await this.pgPool.query<JsspSucursal>(
        'INSERT INTO public."JSSP_SUCURSAL" (id_sucursal, nombre_sucursal, tipo_sucursal, "dirección_sucursal") VALUES ($1, $2, $3, $4) RETURNING *',
        [nextId, nombre, tipo, direccion]
      );
      return res.rows[0];
    }

    if (this.mem.sucursales.some((s) => s.id_sucursal === nextId)) {
      throw new ApiError(409, `La sucursal ${nextId} ya existe.`);
    }
    const row: JsspSucursal = {
      id_sucursal: nextId,
      nombre_sucursal: nombre,
      tipo_sucursal: tipo,
      dirección_sucursal: direccion,
    };
    this.mem.sucursales.push(row);
    return row;
  }

  async updateSucursal(
    idSucursal: number,
    patch: Partial<{
      nombre_sucursal: string;
      tipo_sucursal: string;
      dirección_sucursal: string;
      direccion_sucursal: string;
    }>
  ): Promise<JsspSucursal> {
    const dir = patch.dirección_sucursal ?? patch.direccion_sucursal;
    if (this.mode === 'supabase' && this.supabase) {
      const upd: Record<string, unknown> = {};
      if (patch.nombre_sucursal !== undefined) upd.nombre_sucursal = patch.nombre_sucursal;
      if (patch.tipo_sucursal !== undefined) upd.tipo_sucursal = patch.tipo_sucursal;
      if (dir !== undefined) upd['dirección_sucursal'] = dir;
      const { data, error } = await this.supabase
        .from('JSSP_SUCURSAL')
        .update(upd)
        .eq('id_sucursal', idSucursal)
        .select('*')
        .single();
      if (error || !data) throw new ApiError(404, error?.message || 'Sucursal no encontrada');
      return data as JsspSucursal;
    }
    if (this.mode === 'postgres' && this.pgPool) {
      const res = await this.pgPool.query<JsspSucursal>(
        `UPDATE public."JSSP_SUCURSAL"
         SET nombre_sucursal = COALESCE($2, nombre_sucursal),
             tipo_sucursal = COALESCE($3, tipo_sucursal),
             "dirección_sucursal" = COALESCE($4, "dirección_sucursal")
         WHERE id_sucursal = $1 RETURNING *`,
        [idSucursal, patch.nombre_sucursal ?? null, patch.tipo_sucursal ?? null, dir ?? null]
      );
      if (res.rowCount === 0) throw new ApiError(404, 'Sucursal no encontrada.');
      return res.rows[0];
    }
    const row = this.mem.sucursales.find((s) => s.id_sucursal === idSucursal);
    if (!row) throw new ApiError(404, 'Sucursal no encontrada.');
    if (patch.nombre_sucursal !== undefined) row.nombre_sucursal = patch.nombre_sucursal;
    if (patch.tipo_sucursal !== undefined) row.tipo_sucursal = patch.tipo_sucursal;
    if (dir !== undefined) row.dirección_sucursal = dir;
    return row;
  }

  async deleteSucursal(idSucursal: number) {
    if (this.mode === 'supabase' && this.supabase) {
      const { error } = await this.supabase.from('JSSP_SUCURSAL').delete().eq('id_sucursal', idSucursal);
      if (error) throw new ApiError(400, error.message);
      return { deleted: true, id_sucursal: idSucursal };
    }
    if (this.mode === 'postgres' && this.pgPool) {
      const res = await this.pgPool.query('DELETE FROM public."JSSP_SUCURSAL" WHERE id_sucursal = $1', [idSucursal]);
      if (res.rowCount === 0) throw new ApiError(404, 'Sucursal no encontrada.');
      return { deleted: true, id_sucursal: idSucursal };
    }
    const idx = this.mem.sucursales.findIndex((s) => s.id_sucursal === idSucursal);
    if (idx === -1) throw new ApiError(404, 'Sucursal no encontrada.');
    this.mem.sucursales.splice(idx, 1);
    return { deleted: true, id_sucursal: idSucursal };
  }

  // ==================== TRABAJADORES ====================
  async getTrabajadores(filters?: {
    modalidad?: string;
    id_sucursal?: number;
    search?: string;
  }): Promise<TrabajadorCompleto[]> {
    const snap = await this.getSnapshot();
    let list: TrabajadorCompleto[] = snap.trabajadores.map((t) => {
      const presencial = snap.presenciales.find((p) => p.id_trabajador === t.id_trabajador) || null;
      const vendedor = snap.vendedores.find((v) => v.id_trabajador === t.id_trabajador) || null;
      const sucursal = snap.sucursales.find((s) => Number(s.id_sucursal) === Number(t.id_sucursal)) || null;
      return {
        ...t,
        modalidad: vendedor ? 'ART22' : presencial ? 'PRESENCIAL' : 'GENERAL',
        presencial,
        vendedor,
        sucursal,
      };
    });

    if (filters?.modalidad) {
      const mod = filters.modalidad.toUpperCase();
      list = list.filter((w) => w.modalidad === mod);
    }
    if (filters?.id_sucursal) {
      list = list.filter((w) => Number(w.id_sucursal) === Number(filters.id_sucursal));
    }
    if (filters?.search) {
      const q = filters.search.trim().toLowerCase();
      list = list.filter((w) =>
        `${w.id_trabajador} ${w.rut} ${w.nombre_trabajador} ${w.apellido_trabajador} ${w.email_trabajador}`
          .toLowerCase()
          .includes(q)
      );
    }
    return list;
  }

  async getTrabajadorById(idTrabajador: string): Promise<TrabajadorCompleto> {
    const all = await this.getTrabajadores();
    const found = all.find((w) => w.id_trabajador === idTrabajador);
    if (!found) throw new ApiError(404, `Trabajador ${idTrabajador} no encontrado.`);
    return found;
  }

  async getTrabajadorByAuthUserId(authUserId: string): Promise<TrabajadorCompleto | null> {
    const all = await this.getTrabajadores();
    return all.find((w) => w.auth_user_id === authUserId) || null;
  }

  async createTrabajador(body: {
    id_trabajador: string;
    rut: string;
    nombre_trabajador: string;
    apellido_trabajador?: string;
    email_trabajador: string;
    sueldo_base_trabajador?: number;
    id_sucursal?: number;
    rol_sistema?: string;
    modalidad?: 'PRESENCIAL' | 'ART22';
    rol?: string;
    turno_asignado?: string;
    zona_cobertura?: string;
    es_articulo22?: boolean;
  }): Promise<TrabajadorCompleto> {
    if (!body.id_trabajador || !body.rut || !body.nombre_trabajador || !body.email_trabajador) {
      throw new ApiError(400, 'Complete id_trabajador, rut, nombre_trabajador y email_trabajador.');
    }
    const idClean = body.id_trabajador.trim().toUpperCase();
    const sueldo = Number(body.sueldo_base_trabajador) || 850000;
    const idSucursal = Number(body.id_sucursal) || 1;
    const rolSistema = (body.rol_sistema || 'TRABAJADOR').toUpperCase();
    const modalidad = body.modalidad === 'ART22' ? 'ART22' : 'PRESENCIAL';

    if (this.mode === 'supabase' && this.supabase) {
      const { error: e1 } = await this.supabase.from('JSSP_TRABAJADOR').insert({
        id_trabajador: idClean,
        rut: body.rut.trim(),
        nombre_trabajador: body.nombre_trabajador.trim(),
        apellido_trabajador: (body.apellido_trabajador || '').trim(),
        email_trabajador: body.email_trabajador.trim(),
        sueldo_base_trabajador: sueldo,
        id_sucursal: idSucursal,
        rol_sistema: rolSistema,
      });
      if (e1) throw new ApiError(400, e1.message);

      if (modalidad === 'ART22') {
        const { error: e2 } = await this.supabase.from('JSSP_VENDEDOR_TERRENO').insert({
          id_trabajador: idClean,
          es_articulo22: body.es_articulo22 ?? true,
          zona_cobertura: (body.zona_cobertura || 'Región Metropolitana').trim(),
        });
        if (e2) throw new ApiError(400, e2.message);
      } else {
        const { error: e2 } = await this.supabase.from('JSSP_TRABAJADOR_PRESENCIAL').insert({
          id_trabajador: idClean,
          rol: (body.rol || 'Operaciones').trim(),
          turno_asignado: (body.turno_asignado || '09:00 - 18:00').trim(),
        });
        if (e2) throw new ApiError(400, e2.message);
      }
      return this.getTrabajadorById(idClean);
    }

    if (this.mode === 'postgres' && this.pgPool) {
      const client = await this.pgPool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO public."JSSP_TRABAJADOR"
           (id_trabajador, rut, nombre_trabajador, apellido_trabajador, email_trabajador, sueldo_base_trabajador, id_sucursal, rol_sistema)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            idClean,
            body.rut.trim(),
            body.nombre_trabajador.trim(),
            (body.apellido_trabajador || '').trim(),
            body.email_trabajador.trim(),
            sueldo,
            idSucursal,
            rolSistema,
          ]
        );
        if (modalidad === 'ART22') {
          await client.query(
            `INSERT INTO public."JSSP_VENDEDOR_TERRENO" (id_trabajador, es_articulo22, zona_cobertura)
             VALUES ($1, $2, $3)`,
            [idClean, body.es_articulo22 ?? true, (body.zona_cobertura || 'Región Metropolitana').trim()]
          );
        } else {
          await client.query(
            `INSERT INTO public."JSSP_TRABAJADOR_PRESENCIAL" (id_trabajador, rol, turno_asignado)
             VALUES ($1, $2, $3)`,
            [idClean, (body.rol || 'Operaciones').trim(), (body.turno_asignado || '09:00 - 18:00').trim()]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      return this.getTrabajadorById(idClean);
    }

    if (this.mem.trabajadores.some((t) => t.id_trabajador === idClean)) {
      throw new ApiError(409, `El trabajador ${idClean} ya existe.`);
    }
    this.mem.trabajadores.push({
      id_trabajador: idClean,
      rut: body.rut.trim(),
      nombre_trabajador: body.nombre_trabajador.trim(),
      apellido_trabajador: (body.apellido_trabajador || '').trim(),
      email_trabajador: body.email_trabajador.trim(),
      sueldo_base_trabajador: sueldo,
      id_sucursal: idSucursal,
      rol_sistema: rolSistema,
    });
    if (modalidad === 'ART22') {
      this.mem.vendedores.push({
        id_trabajador: idClean,
        es_articulo22: body.es_articulo22 ?? true,
        zona_cobertura: (body.zona_cobertura || 'Región Metropolitana').trim(),
      });
    } else {
      this.mem.presenciales.push({
        id_trabajador: idClean,
        rol: (body.rol || 'Operaciones').trim(),
        turno_asignado: (body.turno_asignado || '09:00 - 18:00').trim(),
      });
    }
    return this.getTrabajadorById(idClean);
  }

  async updateTrabajador(
    idTrabajador: string,
    patch: Partial<{
      nombre_trabajador: string;
      apellido_trabajador: string;
      email_trabajador: string;
      sueldo_base_trabajador: number;
      id_sucursal: number;
      rol_sistema: string;
      turno_asignado: string;
      rol: string;
      zona_cobertura: string;
      es_articulo22: boolean;
    }>
  ): Promise<TrabajadorCompleto> {
    if (this.mode === 'supabase' && this.supabase) {
      const updBase: Record<string, unknown> = {};
      if (patch.nombre_trabajador !== undefined) updBase.nombre_trabajador = patch.nombre_trabajador;
      if (patch.apellido_trabajador !== undefined) updBase.apellido_trabajador = patch.apellido_trabajador;
      if (patch.email_trabajador !== undefined) updBase.email_trabajador = patch.email_trabajador;
      if (patch.sueldo_base_trabajador !== undefined) updBase.sueldo_base_trabajador = patch.sueldo_base_trabajador;
      if (patch.id_sucursal !== undefined) updBase.id_sucursal = patch.id_sucursal;
      if (patch.rol_sistema !== undefined) updBase.rol_sistema = patch.rol_sistema;
      if (Object.keys(updBase).length > 0) {
        const { error } = await this.supabase.from('JSSP_TRABAJADOR').update(updBase).eq('id_trabajador', idTrabajador);
        if (error) throw new ApiError(400, error.message);
      }
      if (patch.turno_asignado !== undefined || patch.rol !== undefined) {
        const updPres: Record<string, unknown> = {};
        if (patch.turno_asignado !== undefined) updPres.turno_asignado = patch.turno_asignado;
        if (patch.rol !== undefined) updPres.rol = patch.rol;
        await this.supabase.from('JSSP_TRABAJADOR_PRESENCIAL').update(updPres).eq('id_trabajador', idTrabajador);
      }
      if (patch.zona_cobertura !== undefined || patch.es_articulo22 !== undefined) {
        const updVend: Record<string, unknown> = {};
        if (patch.zona_cobertura !== undefined) updVend.zona_cobertura = patch.zona_cobertura;
        if (patch.es_articulo22 !== undefined) updVend.es_articulo22 = patch.es_articulo22;
        await this.supabase.from('JSSP_VENDEDOR_TERRENO').update(updVend).eq('id_trabajador', idTrabajador);
      }
      return this.getTrabajadorById(idTrabajador);
    }

    if (this.mode === 'postgres' && this.pgPool) {
      await this.pgPool.query(
        `UPDATE public."JSSP_TRABAJADOR"
         SET nombre_trabajador = COALESCE($2, nombre_trabajador),
             apellido_trabajador = COALESCE($3, apellido_trabajador),
             email_trabajador = COALESCE($4, email_trabajador),
             sueldo_base_trabajador = COALESCE($5, sueldo_base_trabajador),
             id_sucursal = COALESCE($6, id_sucursal),
             rol_sistema = COALESCE($7, rol_sistema)
         WHERE id_trabajador = $1`,
        [
          idTrabajador,
          patch.nombre_trabajador ?? null,
          patch.apellido_trabajador ?? null,
          patch.email_trabajador ?? null,
          patch.sueldo_base_trabajador ?? null,
          patch.id_sucursal ?? null,
          patch.rol_sistema ?? null,
        ]
      );
      if (patch.turno_asignado !== undefined || patch.rol !== undefined) {
        await this.pgPool.query(
          `UPDATE public."JSSP_TRABAJADOR_PRESENCIAL"
           SET turno_asignado = COALESCE($2, turno_asignado), rol = COALESCE($3, rol)
           WHERE id_trabajador = $1`,
          [idTrabajador, patch.turno_asignado ?? null, patch.rol ?? null]
        );
      }
      if (patch.zona_cobertura !== undefined || patch.es_articulo22 !== undefined) {
        await this.pgPool.query(
          `UPDATE public."JSSP_VENDEDOR_TERRENO"
           SET zona_cobertura = COALESCE($2, zona_cobertura), es_articulo22 = COALESCE($3, es_articulo22)
           WHERE id_trabajador = $1`,
          [idTrabajador, patch.zona_cobertura ?? null, patch.es_articulo22 ?? null]
        );
      }
      return this.getTrabajadorById(idTrabajador);
    }

    const t = this.mem.trabajadores.find((w) => w.id_trabajador === idTrabajador);
    if (!t) throw new ApiError(404, `Trabajador ${idTrabajador} no encontrado.`);
    if (patch.nombre_trabajador !== undefined) t.nombre_trabajador = patch.nombre_trabajador;
    if (patch.apellido_trabajador !== undefined) t.apellido_trabajador = patch.apellido_trabajador;
    if (patch.email_trabajador !== undefined) t.email_trabajador = patch.email_trabajador;
    if (patch.sueldo_base_trabajador !== undefined) t.sueldo_base_trabajador = Number(patch.sueldo_base_trabajador);
    if (patch.id_sucursal !== undefined) t.id_sucursal = Number(patch.id_sucursal);
    if (patch.rol_sistema !== undefined) t.rol_sistema = patch.rol_sistema;
    const p = this.mem.presenciales.find((pr) => pr.id_trabajador === idTrabajador);
    if (p) {
      if (patch.turno_asignado !== undefined) p.turno_asignado = patch.turno_asignado;
      if (patch.rol !== undefined) p.rol = patch.rol;
    }
    const v = this.mem.vendedores.find((ve) => ve.id_trabajador === idTrabajador);
    if (v) {
      if (patch.zona_cobertura !== undefined) v.zona_cobertura = patch.zona_cobertura;
      if (patch.es_articulo22 !== undefined) v.es_articulo22 = patch.es_articulo22;
    }
    return this.getTrabajadorById(idTrabajador);
  }

  async deleteTrabajador(idTrabajador: string) {
    if (this.mode === 'supabase' && this.supabase) {
      const { error } = await this.supabase.from('JSSP_TRABAJADOR').delete().eq('id_trabajador', idTrabajador);
      if (error) throw new ApiError(400, error.message);
      return { deleted: true, id_trabajador: idTrabajador };
    }
    if (this.mode === 'postgres' && this.pgPool) {
      const res = await this.pgPool.query('DELETE FROM public."JSSP_TRABAJADOR" WHERE id_trabajador = $1', [idTrabajador]);
      if (res.rowCount === 0) throw new ApiError(404, `Trabajador ${idTrabajador} no encontrado.`);
      return { deleted: true, id_trabajador: idTrabajador };
    }
    const idx = this.mem.trabajadores.findIndex((t) => t.id_trabajador === idTrabajador);
    if (idx === -1) throw new ApiError(404, `Trabajador ${idTrabajador} no encontrado.`);
    this.mem.trabajadores.splice(idx, 1);
    this.mem.presenciales = this.mem.presenciales.filter((p) => p.id_trabajador !== idTrabajador);
    this.mem.vendedores = this.mem.vendedores.filter((v) => v.id_trabajador !== idTrabajador);
    return { deleted: true, id_trabajador: idTrabajador };
  }

  // ==================== ASISTENCIA QR & ACTAS ====================
  async registrarMarcaAsistencia(params: {
    id_trabajador: string;
    tipo_marca: TipoMarca;
    metodo_biometrico?: string;
  }) {
    const idTrabajador = params.id_trabajador.trim().toUpperCase();
    const tipoMarca = params.tipo_marca;
    const metodo = (params.metodo_biometrico || 'QR').trim().toUpperCase();

    if (tipoMarca !== 'ENTRADA' && tipoMarca !== 'SALIDA') {
      throw new ApiError(400, 'tipo_marca debe ser ENTRADA o SALIDA.');
    }

    const snap = await this.getSnapshot();
    const trab = snap.trabajadores.find((t) => t.id_trabajador === idTrabajador);
    const isArt22 = snap.vendedores.some((v) => v.id_trabajador === idTrabajador && v.es_articulo22);
    const isPresencial = snap.presenciales.some((p) => p.id_trabajador === idTrabajador);

    if (!isPresencial && isArt22) {
      throw new ApiError(
        400,
        `El trabajador ${idTrabajador} está contratado bajo Artículo 22 del Código del Trabajo (exento de marcación horaria presencial).`
      );
    }

    let rpcResult: {
      id_marca: number;
      id_acta: string;
      fecha_hora: string;
      tipo_marca: TipoMarca;
      dias_trabajados_mes: number;
    };

    if (this.mode === 'supabase' && this.supabase) {
      const { data, error } = await this.supabase.rpc('jssp_registrar_marca_asistencia', {
        p_id_trabajador: idTrabajador,
        p_tipo_marca: tipoMarca,
        p_metodo_biometrico: metodo,
      });
      if (error) throw new ApiError(error.message.includes('ENTRADA activa') ? 409 : 400, error.message);
      rpcResult = data as typeof rpcResult;
    } else if (this.mode === 'postgres' && this.pgPool) {
      const res = await this.pgPool.query<{ result: typeof rpcResult }>(
        'SELECT public.jssp_registrar_marca_asistencia($1, $2, $3) AS result',
        [idTrabajador, tipoMarca, metodo]
      );
      rpcResult = res.rows[0].result;
    } else {
      if (!isPresencial) {
        throw new ApiError(404, `El trabajador ${idTrabajador} no está registrado como trabajador presencial.`);
      }
      const lastMark = [...this.mem.marcas]
        .filter((m) => m.id_trabajador_presencial === idTrabajador)
        .sort((a, b) => new Date(b.fecha_hora).getTime() - new Date(a.fecha_hora).getTime())[0];

      if (tipoMarca === 'ENTRADA' && lastMark?.tipo_marca === 'ENTRADA') {
        throw new ApiError(409, 'Ya existe una ENTRADA activa sin SALIDA previa.');
      }
      if (tipoMarca === 'SALIDA' && (!lastMark || lastMark.tipo_marca === 'SALIDA')) {
        throw new ApiError(409, 'No existe una ENTRADA activa previa para registrar SALIDA.');
      }

      const now = new Date();
      const chile = getChileDateParts(now);
      const pad2 = (n: number) => String(n).padStart(2, '0');
      const idActa = `ACTA-${chile.year}-${pad2(chile.month)}-${idTrabajador}`;

      let acta = this.mem.actas.find(
        (a) => a.id_trabajador === idTrabajador && a.mes === chile.month && a.año === chile.year
      );
      if (!acta) {
        acta = {
          id_acta: idActa,
          mes: chile.month,
          año: chile.year,
          total_dias_trabajados: 0,
          estado_firma: 'PENDIENTE',
          id_trabajador: idTrabajador,
          fecha_generacion: now.toISOString(),
        };
        this.mem.actas.push(acta);
      }

      const newMarca: JsspMarcaAsistencia = {
        id_marca: this.mem.nextMarcaId++,
        id_trabajador_presencial: idTrabajador,
        fecha_hora: now.toISOString(),
        tipo_marca: tipoMarca,
        metodo_biometrico: metodo,
        respaldo_email: false,
        id_acta: acta.id_acta,
      };
      this.mem.marcas.push(newMarca);

      const uniqueDays = new Set(
        this.mem.marcas
          .filter((m) => m.id_acta === acta!.id_acta && m.tipo_marca === 'ENTRADA')
          .map((m) => getChileDateParts(new Date(m.fecha_hora)).dateStr)
      );
      acta.total_dias_trabajados = uniqueDays.size;

      rpcResult = {
        id_marca: newMarca.id_marca,
        id_acta: acta.id_acta,
        fecha_hora: newMarca.fecha_hora,
        tipo_marca: newMarca.tipo_marca,
        dias_trabajados_mes: acta.total_dias_trabajados,
      };
    }

    let emailStatus: EmailLogRow | undefined;
    if (trab?.email_trabajador) {
      const suc = snap.sucursales.find((s) => Number(s.id_sucursal) === Number(trab.id_sucursal));
      const chileClock = getChileDateParts(new Date(rpcResult.fecha_hora));
      const nombreCompleto = `${trab.nombre_trabajador} ${trab.apellido_trabajador}`;
      const html = buildAttendanceEmailHtml({
        nombreCompleto,
        rut: trab.rut,
        tipoMarca,
        fechaHoraLocal: chileClock.displayStr,
        sucursal: suc?.nombre_sucursal || 'Sucursal Principal',
        metodoBiometrico: metodo,
        idActa: rpcResult.id_acta,
        idMarca: rpcResult.id_marca,
      });

      const delivery = await dispatchEmail({
        to: trab.email_trabajador,
        subject: `Comprobante de Marcación QR (${tipoMarca}) — ${chileClock.displayStr}`,
        html,
      });

      if (delivery.sent) {
        await this.markEmailBackupSent(rpcResult.id_marca);
      }

      emailStatus = {
        id: crypto.randomUUID(),
        id_marca: rpcResult.id_marca,
        id_trabajador: trab.id_trabajador,
        nombre_completo: nombreCompleto,
        email_trabajador: trab.email_trabajador,
        tipo_marca: tipoMarca,
        fecha_hora_local: chileClock.displayStr,
        id_acta: rpcResult.id_acta,
        sent: delivery.sent,
        mode: delivery.mode,
        messageId: delivery.messageId,
        previewHtml: html,
        timestamp: new Date().toISOString(),
      };
      this.recordEmailLog(emailStatus);
    }

    return { ...rpcResult, email_status: emailStatus };
  }

  async markEmailBackupSent(idMarca: number): Promise<void> {
    if (this.mode === 'supabase' && this.supabase) {
      await this.supabase
        .from('JSSP_MARCA_ASISTENCIA')
        .update({ respaldo_email: true })
        .eq('id_marca', idMarca);
      return;
    }
    if (this.mode === 'postgres' && this.pgPool) {
      await this.pgPool.query(
        'UPDATE public."JSSP_MARCA_ASISTENCIA" SET respaldo_email = true WHERE id_marca = $1',
        [idMarca]
      );
      return;
    }
    const m = this.mem.marcas.find((x) => x.id_marca === idMarca);
    if (m) m.respaldo_email = true;
  }

  async getActaMensualAdmin(mes: number, anio: number): Promise<ActaMensualAdminResponse> {
    if (this.mode === 'supabase' && this.supabase) {
      const { data, error } = await this.supabase.rpc('jssp_obtener_acta_mensual_admin', {
        p_mes: mes,
        p_anio: anio,
      });
      if (error) throw new ApiError(502, error.message);
      return data as ActaMensualAdminResponse;
    }

    if (this.mode === 'postgres' && this.pgPool) {
      const res = await this.pgPool.query<{ result: ActaMensualAdminResponse }>(
        'SELECT public.jssp_obtener_acta_mensual_admin($1, $2) AS result',
        [mes, anio]
      );
      return res.rows[0].result;
    }

    const pad2 = (n: number) => String(n).padStart(2, '0');
    const inicioMes = `${anio}-${pad2(mes)}-01`;
    const lastDay = new Date(anio, mes, 0).getDate();
    const finMes = `${anio}-${pad2(mes)}-${pad2(lastDay)}`;

    const asistencia_presencial = this.mem.presenciales
      .map((tp) => {
        const t = this.mem.trabajadores.find((w) => w.id_trabajador === tp.id_trabajador);
        if (!t) return null;
        const suc = this.mem.sucursales.find((s) => s.id_sucursal === t.id_sucursal);
        const acta = this.mem.actas.find(
          (a) => a.id_trabajador === tp.id_trabajador && a.mes === mes && a.año === anio
        );
        const marcasActa = acta
          ? this.mem.marcas
              .filter((m) => m.id_acta === acta.id_acta)
              .sort((a, b) => new Date(a.fecha_hora).getTime() - new Date(b.fecha_hora).getTime())
              .map((m) => ({
                id_marca: m.id_marca,
                fecha_hora_local: m.fecha_hora,
                tipo_marca: m.tipo_marca,
                metodo_biometrico: m.metodo_biometrico,
                respaldo_email: m.respaldo_email,
              }))
          : [];

        return {
          id_trabajador: t.id_trabajador,
          rut: t.rut,
          nombre_completo: `${t.nombre_trabajador} ${t.apellido_trabajador}`,
          email_trabajador: t.email_trabajador,
          nombre_sucursal: suc?.nombre_sucursal || 'Sin Sucursal',
          rol: tp.rol,
          turno_asignado: tp.turno_asignado || '09:00 - 18:00',
          id_acta: acta?.id_acta || 'SIN_ACTA',
          total_dias_trabajados: acta?.total_dias_trabajados || 0,
          estado_firma: acta?.estado_firma || 'SIN_MARCAS',
          marcas: marcasActa,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.nombre_completo.localeCompare(b.nombre_completo));

    const metas_venta = this.mem.metas
      .filter((m) => m.fecha_inicio <= finMes && (!m.fecha_fin || m.fecha_fin >= inicioMes))
      .map((m) => {
        const montoObj = m.monto_objetivo || 0;
        const montoAct = m.monto_actual || 0;
        const pct = montoObj > 0 ? Math.round((montoAct / montoObj) * 10000) / 100 : 0;

        const bySeller = new Map<
          string,
          {
            id_trabajador: string;
            vendedor: string;
            zona_cobertura: string;
            es_articulo22: boolean;
            sueldo_base_trabajador: number;
            ventasIds: Set<number>;
            total_vendido_meta: number;
            comision_estimada: number;
          }
        >();

        for (const dv of this.mem.detallesVenta) {
          if (dv.id_meta !== m.id_meta) continue;
          const vt = this.mem.vendedores.find((v) => v.id_trabajador === dv.id_vendedor);
          const t = this.mem.trabajadores.find((w) => w.id_trabajador === dv.id_vendedor);
          if (!vt || !t) continue;
          const prod = this.mem.productos.find((p) => p.codigo_producto === dv.codigo_producto);
          const pctCom = prod?.porcentaje_comision_producto || 0;

          let entry = bySeller.get(vt.id_trabajador);
          if (!entry) {
            entry = {
              id_trabajador: vt.id_trabajador,
              vendedor: `${t.nombre_trabajador} ${t.apellido_trabajador}`,
              zona_cobertura: vt.zona_cobertura || 'General',
              es_articulo22: vt.es_articulo22,
              sueldo_base_trabajador: t.sueldo_base_trabajador,
              ventasIds: new Set<number>(),
              total_vendido_meta: 0,
              comision_estimada: 0,
            };
            bySeller.set(vt.id_trabajador, entry);
          }
          entry.ventasIds.add(dv.id_venta);
          entry.total_vendido_meta += dv.subtotal;
          entry.comision_estimada += dv.subtotal * (pctCom / 100);
        }

        return {
          id_meta: m.id_meta,
          fecha_inicio: m.fecha_inicio,
          fecha_fin: m.fecha_fin,
          monto_objetivo: montoObj,
          monto_actual: montoAct,
          porcentaje_cumplimiento: pct,
          estado: m.estado,
          detalle_vendedores: Array.from(bySeller.values()).map((e) => ({
            id_trabajador: e.id_trabajador,
            vendedor: e.vendedor,
            zona_cobertura: e.zona_cobertura,
            es_articulo22: e.es_articulo22,
            sueldo_base_trabajador: e.sueldo_base_trabajador,
            cantidad_ventas: e.ventasIds.size,
            total_vendido_meta: e.total_vendido_meta,
            comision_estimada: Math.round(e.comision_estimada),
          })),
        };
      });

    return {
      periodo: { mes, anio },
      fecha_emision: getChileDateParts(new Date()).localTimestamp,
      asistencia_presencial,
      metas_venta,
    };
  }

  async signActa(idActa: string, estadoFirma = 'FIRMADA'): Promise<JsspActaAsistenciaMensual> {
    if (this.mode === 'supabase' && this.supabase) {
      const { data, error } = await this.supabase
        .from('JSSP_ACTA_ASISTENCIA_MENSUAL')
        .update({ estado_firma: estadoFirma })
        .eq('id_acta', idActa)
        .select('*')
        .single();
      if (error || !data) throw new ApiError(404, error?.message || 'Acta mensual no encontrada.');
      return data as JsspActaAsistenciaMensual;
    }
    if (this.mode === 'postgres' && this.pgPool) {
      const res = await this.pgPool.query<JsspActaAsistenciaMensual>(
        'UPDATE public."JSSP_ACTA_ASISTENCIA_MENSUAL" SET estado_firma = $2 WHERE id_acta = $1 RETURNING *',
        [idActa, estadoFirma]
      );
      if (res.rowCount === 0) throw new ApiError(404, 'Acta mensual no encontrada.');
      return res.rows[0];
    }
    const acta = this.mem.actas.find((a) => a.id_acta === idActa);
    if (!acta) throw new ApiError(404, 'Acta mensual no encontrada.');
    acta.estado_firma = estadoFirma;
    return acta;
  }

  // ==================== PRODUCTOS, METAS, VENTAS & COMISIONES ====================
  async createProducto(payload: {
    codigo_producto?: number;
    nombre_producto: string;
    categoria_producto?: string;
    porcentaje_comision_producto: number;
  }): Promise<JsspProducto> {
    const pct = Number(payload.porcentaje_comision_producto);
    if (!payload.nombre_producto?.trim() || Number.isNaN(pct) || pct < 0 || pct > 100) {
      throw new ApiError(400, 'nombre_producto y porcentaje_comision_producto (0-100) son obligatorios.');
    }
    const nombre = payload.nombre_producto.trim();
    const cat = (payload.categoria_producto || 'General').trim();

    if (this.mode === 'supabase' && this.supabase) {
      const row: Record<string, unknown> = {
        nombre_producto: nombre,
        categoria_producto: cat,
        porcentaje_comision_producto: pct,
      };
      if (payload.codigo_producto !== undefined) row.codigo_producto = Number(payload.codigo_producto);
      const { data, error } = await this.supabase.from('JSSP_PRODUCTO').insert(row).select('*').single();
      if (error) throw new ApiError(400, error.message);
      return data as JsspProducto;
    }

    if (this.mode === 'postgres' && this.pgPool) {
      const res = await this.pgPool.query<JsspProducto>(
        `INSERT INTO public."JSSP_PRODUCTO" (nombre_producto, categoria_producto, porcentaje_comision_producto)
         VALUES ($1, $2, $3) RETURNING *`,
        [nombre, cat, pct]
      );
      return res.rows[0];
    }

    const prod: JsspProducto = {
      codigo_producto: payload.codigo_producto ? Number(payload.codigo_producto) : this.mem.nextProductoId++,
      nombre_producto: nombre,
      categoria_producto: cat,
      porcentaje_comision_producto: pct,
    };
    this.mem.productos.push(prod);
    return prod;
  }

  async updateProducto(
    codigoProducto: number,
    patch: Partial<{ nombre_producto: string; categoria_producto: string; porcentaje_comision_producto: number }>
  ): Promise<JsspProducto> {
    if (patch.porcentaje_comision_producto !== undefined) {
      const pct = Number(patch.porcentaje_comision_producto);
      if (Number.isNaN(pct) || pct < 0 || pct > 100) {
        throw new ApiError(400, 'La comisión debe estar entre 0 y 100.');
      }
    }
    if (this.mode === 'supabase' && this.supabase) {
      const { data, error } = await this.supabase
        .from('JSSP_PRODUCTO')
        .update(patch)
        .eq('codigo_producto', codigoProducto)
        .select('*')
        .single();
      if (error || !data) throw new ApiError(404, error?.message || 'Producto no encontrado.');
      return data as JsspProducto;
    }
    if (this.mode === 'postgres' && this.pgPool) {
      const res = await this.pgPool.query<JsspProducto>(
        `UPDATE public."JSSP_PRODUCTO"
         SET nombre_producto = COALESCE($2, nombre_producto),
             categoria_producto = COALESCE($3, categoria_producto),
             porcentaje_comision_producto = COALESCE($4, porcentaje_comision_producto)
         WHERE codigo_producto = $1 RETURNING *`,
        [
          codigoProducto,
          patch.nombre_producto ?? null,
          patch.categoria_producto ?? null,
          patch.porcentaje_comision_producto ?? null,
        ]
      );
      if (res.rowCount === 0) throw new ApiError(404, 'Producto no encontrado.');
      return res.rows[0];
    }
    const p = this.mem.productos.find((x) => x.codigo_producto === codigoProducto);
    if (!p) throw new ApiError(404, 'Producto no encontrado.');
    if (patch.nombre_producto !== undefined) p.nombre_producto = patch.nombre_producto;
    if (patch.categoria_producto !== undefined) p.categoria_producto = patch.categoria_producto;
    if (patch.porcentaje_comision_producto !== undefined) {
      p.porcentaje_comision_producto = Number(patch.porcentaje_comision_producto);
    }
    return p;
  }

  async deleteProducto(codigoProducto: number) {
    if (this.mode === 'supabase' && this.supabase) {
      const { error } = await this.supabase.from('JSSP_PRODUCTO').delete().eq('codigo_producto', codigoProducto);
      if (error) throw new ApiError(400, error.message);
      return { deleted: true, codigo_producto: codigoProducto };
    }
    if (this.mode === 'postgres' && this.pgPool) {
      const res = await this.pgPool.query('DELETE FROM public."JSSP_PRODUCTO" WHERE codigo_producto = $1', [codigoProducto]);
      if (res.rowCount === 0) throw new ApiError(404, 'Producto no encontrado.');
      return { deleted: true, codigo_producto: codigoProducto };
    }
    const idx = this.mem.productos.findIndex((p) => p.codigo_producto === codigoProducto);
    if (idx === -1) throw new ApiError(404, 'Producto no encontrado.');
    this.mem.productos.splice(idx, 1);
    return { deleted: true, codigo_producto: codigoProducto };
  }

  async createMeta(payload: {
    fecha_inicio: string;
    fecha_fin?: string | null;
    monto_objetivo: number;
  }): Promise<JsspMetaVenta> {
    const obj = Number(payload.monto_objetivo);
    if (!payload.fecha_inicio || Number.isNaN(obj) || obj <= 0) {
      throw new ApiError(400, 'fecha_inicio y monto_objetivo > 0 son obligatorios.');
    }

    if (this.mode === 'supabase' && this.supabase) {
      const { data, error } = await this.supabase
        .from('JSSP_META_VENTA')
        .insert({
          fecha_inicio: payload.fecha_inicio,
          fecha_fin: payload.fecha_fin || null,
          monto_objetivo: obj,
          monto_actual: 0,
          estado: 'EN_PROGRESO',
        })
        .select('*')
        .single();
      if (error) throw new ApiError(400, error.message);
      return data as JsspMetaVenta;
    }

    if (this.mode === 'postgres' && this.pgPool) {
      const res = await this.pgPool.query<JsspMetaVenta>(
        `INSERT INTO public."JSSP_META_VENTA" (fecha_inicio, fecha_fin, monto_objetivo, monto_actual, estado)
         VALUES ($1, $2, $3, 0, 'EN_PROGRESO') RETURNING *`,
        [payload.fecha_inicio, payload.fecha_fin || null, obj]
      );
      return res.rows[0];
    }

    const meta: JsspMetaVenta = {
      id_meta: this.mem.nextMetaId++,
      fecha_inicio: payload.fecha_inicio,
      fecha_fin: payload.fecha_fin || null,
      monto_objetivo: obj,
      monto_actual: 0,
      estado: 'EN_PROGRESO',
    };
    this.mem.metas.push(meta);
    return meta;
  }

  async updateMeta(
    idMeta: number,
    patch: Partial<{ fecha_inicio: string; fecha_fin: string | null; monto_objetivo: number; estado: string }>
  ): Promise<JsspMetaVenta> {
    if (this.mode === 'supabase' && this.supabase) {
      const { data, error } = await this.supabase
        .from('JSSP_META_VENTA')
        .update(patch)
        .eq('id_meta', idMeta)
        .select('*')
        .single();
      if (error || !data) throw new ApiError(404, error?.message || 'Meta no encontrada.');
      return data as JsspMetaVenta;
    }
    if (this.mode === 'postgres' && this.pgPool) {
      const res = await this.pgPool.query<JsspMetaVenta>(
        `UPDATE public."JSSP_META_VENTA"
         SET fecha_inicio = COALESCE($2, fecha_inicio),
             fecha_fin = COALESCE($3, fecha_fin),
             monto_objetivo = COALESCE($4, monto_objetivo),
             estado = COALESCE($5, estado)
         WHERE id_meta = $1 RETURNING *`,
        [
          idMeta,
          patch.fecha_inicio ?? null,
          patch.fecha_fin ?? null,
          patch.monto_objetivo ?? null,
          patch.estado ?? null,
        ]
      );
      if (res.rowCount === 0) throw new ApiError(404, 'Meta no encontrada.');
      return res.rows[0];
    }
    const m = this.mem.metas.find((x) => x.id_meta === idMeta);
    if (!m) throw new ApiError(404, 'Meta no encontrada.');
    if (patch.fecha_inicio !== undefined) m.fecha_inicio = patch.fecha_inicio;
    if (patch.fecha_fin !== undefined) m.fecha_fin = patch.fecha_fin;
    if (patch.monto_objetivo !== undefined) m.monto_objetivo = Number(patch.monto_objetivo);
    if (patch.estado !== undefined) m.estado = patch.estado;
    return m;
  }

  async registrarVenta(payload: {
    id_vendedor: string;
    id_meta: number;
    items: Array<{ codigo_producto: number; cantidad: number; precio_unitario: number }>;
  }) {
    const idVendedor = payload.id_vendedor?.trim().toUpperCase();
    const idMeta = Number(payload.id_meta);
    if (!idVendedor || !idMeta || !Array.isArray(payload.items) || payload.items.length === 0) {
      throw new ApiError(400, 'Debe especificar id_vendedor, id_meta e items de venta.');
    }
    const validItems = payload.items
      .map((i) => ({
        codigo_producto: Number(i.codigo_producto),
        cantidad: Number(i.cantidad),
        precio_unitario: Number(i.precio_unitario),
      }))
      .filter((i) => i.cantidad > 0 && i.precio_unitario > 0 && !Number.isNaN(i.codigo_producto));

    if (validItems.length === 0) {
      throw new ApiError(400, 'Los items deben tener cantidad y precio_unitario positivos.');
    }

    const montoTotal = validItems.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0);

    if (this.mode === 'supabase' && this.supabase) {
      const { data: venta, error: vErr } = await this.supabase
        .from('JSSP_VENTA')
        .insert({ fecha: new Date().toISOString(), monto_total: montoTotal })
        .select('codigo_venta')
        .single();
      if (vErr || !venta) throw new ApiError(400, vErr?.message || 'Error creando venta');

      const { error: dErr } = await this.supabase.from('JSSP_DETALLE_VENTA').insert(
        validItems.map((item) => ({
          id_venta: venta.codigo_venta,
          id_vendedor: idVendedor,
          codigo_producto: item.codigo_producto,
          id_meta: idMeta,
          cantidad: item.cantidad,
          precio_unitario: item.precio_unitario,
          subtotal: item.cantidad * item.precio_unitario,
        }))
      );
      if (dErr) throw new ApiError(400, dErr.message);

      const { data: metaRow } = await this.supabase
        .from('JSSP_META_VENTA')
        .select('*')
        .eq('id_meta', idMeta)
        .single();
      if (metaRow) {
        const { data: metaDets } = await this.supabase
          .from('JSSP_DETALLE_VENTA')
          .select('subtotal')
          .eq('id_meta', idMeta);
        const sumMeta = (metaDets || []).reduce((s, r) => s + Number(r.subtotal || 0), 0);
        const estado =
          sumMeta >= Number(metaRow.monto_objetivo)
            ? 'CUMPLIDA'
            : metaRow.fecha_fin && getChileDateParts().dateStr > metaRow.fecha_fin
              ? 'NO_CUMPLIDA'
              : 'EN_PROGRESO';
        await this.supabase
          .from('JSSP_META_VENTA')
          .update({ monto_actual: sumMeta, estado })
          .eq('id_meta', idMeta);
      }
      return { codigo_venta: venta.codigo_venta, monto_total: montoTotal };
    }

    if (this.mode === 'postgres' && this.pgPool) {
      const client = await this.pgPool.connect();
      try {
        await client.query('BEGIN');
        const vRes = await client.query<{ codigo_venta: number }>(
          'INSERT INTO public."JSSP_VENTA" (fecha, monto_total) VALUES (NOW(), $1) RETURNING codigo_venta',
          [montoTotal]
        );
        const codigoVenta = vRes.rows[0].codigo_venta;
        for (const item of validItems) {
          await client.query(
            `INSERT INTO public."JSSP_DETALLE_VENTA"
             (id_venta, id_vendedor, codigo_producto, id_meta, cantidad, precio_unitario, subtotal)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              codigoVenta,
              idVendedor,
              item.codigo_producto,
              idMeta,
              item.cantidad,
              item.precio_unitario,
              item.cantidad * item.precio_unitario,
            ]
          );
        }
        await client.query(
          `UPDATE public."JSSP_META_VENTA" m
           SET monto_actual = COALESCE((SELECT SUM(subtotal) FROM public."JSSP_DETALLE_VENTA" WHERE id_meta = m.id_meta), 0),
               estado = CASE
                 WHEN COALESCE((SELECT SUM(subtotal) FROM public."JSSP_DETALLE_VENTA" WHERE id_meta = m.id_meta), 0) >= m.monto_objetivo THEN 'CUMPLIDA'
                 WHEN m.fecha_fin IS NOT NULL AND CURRENT_DATE > m.fecha_fin THEN 'NO_CUMPLIDA'
                 ELSE 'EN_PROGRESO'
               END
           WHERE m.id_meta = $1`,
          [idMeta]
        );
        await client.query('COMMIT');
        return { codigo_venta: codigoVenta, monto_total: montoTotal };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    const seller = this.mem.vendedores.find((v) => v.id_trabajador === idVendedor);
    if (!seller) throw new ApiError(404, `Vendedor ${idVendedor} no encontrado en JSSP_VENDEDOR_TERRENO.`);

    const codigoVenta = this.mem.nextVentaId++;
    this.mem.ventas.push({
      codigo_venta: codigoVenta,
      fecha: new Date().toISOString(),
      monto_total: montoTotal,
    });

    for (const item of validItems) {
      this.mem.detallesVenta.push({
        id_detalle: this.mem.nextDetalleId++,
        id_venta: codigoVenta,
        id_vendedor: idVendedor,
        codigo_producto: item.codigo_producto,
        id_meta: idMeta,
        cantidad: item.cantidad,
        precio_unitario: item.precio_unitario,
        subtotal: item.cantidad * item.precio_unitario,
      });
    }

    const meta = this.mem.metas.find((m) => m.id_meta === idMeta);
    if (meta) {
      const sumMeta = this.mem.detallesVenta
        .filter((d) => d.id_meta === meta.id_meta)
        .reduce((s, d) => s + d.subtotal, 0);
      meta.monto_actual = sumMeta;
      const todayChile = getChileDateParts(new Date()).dateStr;
      meta.estado =
        sumMeta >= meta.monto_objetivo
          ? 'CUMPLIDA'
          : meta.fecha_fin && todayChile > meta.fecha_fin
            ? 'NO_CUMPLIDA'
            : 'EN_PROGRESO';
    }

    return { codigo_venta: codigoVenta, monto_total: montoTotal };
  }

  async getVentaByCodigo(codigoVenta: number) {
    const snap = await this.getSnapshot();
    const venta = snap.ventas.find((v) => v.codigo_venta === codigoVenta);
    if (!venta) throw new ApiError(404, `Venta ${codigoVenta} no encontrada.`);
    const detalles = snap.detallesVenta.filter((d) => d.id_venta === codigoVenta);
    return { ...venta, detalles };
  }

  async getComisionesArt22(): Promise<ComisionArt22Resumen[]> {
    const snap = await this.getSnapshot();
    return snap.vendedores.map((v) => {
      const t = snap.trabajadores.find((w) => w.id_trabajador === v.id_trabajador);
      const detalles = snap.detallesVenta.filter((d) => d.id_vendedor === v.id_trabajador);
      const ventasSet = new Set(detalles.map((d) => d.id_venta));
      let totalVendido = 0;
      let comision = 0;

      for (const dv of detalles) {
        const prod = snap.productos.find((p) => p.codigo_producto === dv.codigo_producto);
        const pct = prod?.porcentaje_comision_producto || 0;
        totalVendido += dv.subtotal;
        comision += dv.subtotal * (pct / 100);
      }

      const sueldoBase = Number(t?.sueldo_base_trabajador || 0);
      const comisionRedondeada = Math.round(comision);

      return {
        id_trabajador: v.id_trabajador,
        rut: t?.rut || '—',
        nombre_completo: t ? `${t.nombre_trabajador} ${t.apellido_trabajador}` : v.id_trabajador,
        email_trabajador: t?.email_trabajador || '—',
        zona_cobertura: v.zona_cobertura || 'General',
        es_articulo22: v.es_articulo22,
        sueldo_base_trabajador: sueldoBase,
        cantidad_ventas: ventasSet.size,
        total_vendido: totalVendido,
        comision_calculada: comisionRedondeada,
        remuneracion_total_estimada: sueldoBase + comisionRedondeada,
      };
    });
  }
}
