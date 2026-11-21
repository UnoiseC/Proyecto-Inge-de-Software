import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import nodemailer from 'nodemailer';
import { createServer as createViteServer } from 'vite';

type TipoMarca = 'ENTRADA' | 'SALIDA';

interface SucursalRow {
  id_sucursal: number;
  nombre_sucursal: string;
  tipo_sucursal: string;
  dirección_sucursal: string;
}

interface TrabajadorRow {
  id_trabajador: string;
  rut: string;
  nombre_trabajador: string;
  apellido_trabajador: string;
  email_trabajador: string;
  sueldo_base_trabajador: number;
  id_sucursal: number;
  rol_sistema: string;
}

interface PresencialRow {
  id_trabajador: string;
  rol: string;
  turno_asignado: string;
}

interface VendedorRow {
  id_trabajador: string;
  es_articulo22: boolean;
  zona_cobertura: string;
}

interface ActaRow {
  id_acta: string;
  mes: number;
  año: number;
  total_dias_trabajados: number;
  estado_firma: string;
  id_trabajador: string;
  fecha_generacion: string;
}

interface MarcaRow {
  id_marca: number;
  id_trabajador_presencial: string;
  fecha_hora: string;
  tipo_marca: TipoMarca;
  metodo_biometrico: string;
  respaldo_email: boolean;
  id_acta: string;
}

interface ProductoRow {
  codigo_producto: number;
  nombre_producto: string;
  categoria_producto: string;
  porcentaje_comision_producto: number;
}

interface MetaVentaRow {
  id_meta: number;
  fecha_inicio: string;
  fecha_fin: string | null;
  monto_objetivo: number;
  monto_actual: number;
  estado: string;
}

interface VentaRow {
  codigo_venta: number;
  fecha: string;
  monto_total: number;
}

interface DetalleVentaRow {
  id_detalle: number;
  id_venta: number;
  id_vendedor: string;
  codigo_producto: number;
  id_meta: number;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
}

interface EmailLogRow {
  id: string;
  id_marca: number;
  id_trabajador: string;
  nombre_completo: string;
  email_trabajador: string;
  tipo_marca: TipoMarca;
  fecha_hora_local: string;
  id_acta: string;
  sent: boolean;
  mode: 'resend' | 'smtp' | 'preview';
  messageId: string;
  previewHtml: string;
  timestamp: string;
}

interface ScheduleConfig {
  activo: boolean;
  frecuencia: 'DIARIO' | 'SEMANAL' | 'MENSUAL';
  horaEjecucion: string;
  emailAdmin: string;
  toleranciaMinutos: number;
  ultimoEnvio?: string;
}

const CHILE_TZ = 'America/Santiago';

function escapeHtml(unsafe: string): string {
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getChileDateParts(date: Date = new Date()): {
  year: number;
  month: number;
  day: number;
  dateStr: string;
  localTimestamp: string;
  displayStr: string;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CHILE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const hour = map.hour === '24' ? '00' : map.hour;
  const dateStr = `${map.year}-${map.month}-${map.day}`;
  const timeStr = `${hour}:${map.minute}:${map.second}`;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    dateStr,
    localTimestamp: `${dateStr}T${timeStr}`,
    displayStr: `${map.day}/${map.month}/${map.year} ${timeStr}`,
  };
}

function createInitialStore() {
  const nowParts = getChileDateParts(new Date());
  const anio = nowParts.year;
  const mes = nowParts.month;
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const ym = `${anio}-${pad2(mes)}`;

  const sucursales: SucursalRow[] = [
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

  const trabajadores: TrabajadorRow[] = [
    {
      id_trabajador: 'TRAB-001',
      rut: '16.482.910-4',
      nombre_trabajador: 'Camila',
      apellido_trabajador: 'Valdivia',
      email_trabajador: 'camila.valdivia@empresa-jssp.cl',
      sueldo_base_trabajador: 1150000,
      id_sucursal: 1,
      rol_sistema: 'TRABAJADOR',
    },
    {
      id_trabajador: 'TRAB-002',
      rut: '18.219.344-K',
      nombre_trabajador: 'Matías',
      apellido_trabajador: 'Riquelme',
      email_trabajador: 'matias.riquelme@empresa-jssp.cl',
      sueldo_base_trabajador: 980000,
      id_sucursal: 1,
      rol_sistema: 'TRABAJADOR',
    },
    {
      id_trabajador: 'TRAB-003',
      rut: '15.904.112-2',
      nombre_trabajador: 'Fernanda',
      apellido_trabajador: 'Castillo',
      email_trabajador: 'fernanda.castillo@empresa-jssp.cl',
      sueldo_base_trabajador: 1050000,
      id_sucursal: 2,
      rol_sistema: 'TRABAJADOR',
    },
    {
      id_trabajador: 'TRAB-004',
      rut: '19.330.875-1',
      nombre_trabajador: 'Diego',
      apellido_trabajador: 'Fuentes',
      email_trabajador: 'diego.fuentes@empresa-jssp.cl',
      sueldo_base_trabajador: 890000,
      id_sucursal: 3,
      rol_sistema: 'TRABAJADOR',
    },
    {
      id_trabajador: 'TRAB-005',
      rut: '14.772.601-8',
      nombre_trabajador: 'Valentina',
      apellido_trabajador: 'Soto',
      email_trabajador: 'valentina.soto@empresa-jssp.cl',
      sueldo_base_trabajador: 920000,
      id_sucursal: 2,
      rol_sistema: 'TRABAJADOR',
    },
    {
      id_trabajador: 'VEND-001',
      rut: '17.615.409-3',
      nombre_trabajador: 'Sebastián',
      apellido_trabajador: 'Mancilla',
      email_trabajador: 'sebpintomanci@gmail.com',
      sueldo_base_trabajador: 1200000,
      id_sucursal: 1,
      rol_sistema: 'TRABAJADOR',
    },
    {
      id_trabajador: 'VEND-002',
      rut: '16.889.205-6',
      nombre_trabajador: 'Ignacia',
      apellido_trabajador: 'Lagos',
      email_trabajador: 'ignacia.lagos@empresa-jssp.cl',
      sueldo_base_trabajador: 1100000,
      id_sucursal: 2,
      rol_sistema: 'TRABAJADOR',
    },
    {
      id_trabajador: 'VEND-003',
      rut: '18.041.773-9',
      nombre_trabajador: 'Tomás',
      apellido_trabajador: 'Herrera',
      email_trabajador: 'tomas.herrera@empresa-jssp.cl',
      sueldo_base_trabajador: 950000,
      id_sucursal: 3,
      rol_sistema: 'TRABAJADOR',
    },
  ];

  const presenciales: PresencialRow[] = [
    { id_trabajador: 'TRAB-001', rol: 'Analista de Operaciones', turno_asignado: '09:00 - 18:00' },
    { id_trabajador: 'TRAB-002', rol: 'Soporte Técnico TI', turno_asignado: '09:00 - 18:00' },
    { id_trabajador: 'TRAB-003', rol: 'Ejecutiva Sucursal', turno_asignado: '08:30 - 17:30' },
    { id_trabajador: 'TRAB-004', rol: 'Coordinador Bodega', turno_asignado: '08:00 - 17:00' },
    { id_trabajador: 'TRAB-005', rol: 'Asistente Administrativa', turno_asignado: '09:00 - 18:00' },
  ];

  const vendedores: VendedorRow[] = [
    { id_trabajador: 'VEND-001', es_articulo22: true, zona_cobertura: 'Zona Oriente Corporativa' },
    { id_trabajador: 'VEND-002', es_articulo22: true, zona_cobertura: 'Zona Centro-Norte' },
    { id_trabajador: 'VEND-003', es_articulo22: true, zona_cobertura: 'Zona Industrial Sur' },
  ];

  const actas: ActaRow[] = presenciales.map((p) => ({
    id_acta: `ACTA-${anio}-${pad2(mes)}-${p.id_trabajador}`,
    mes,
    año: anio,
    total_dias_trabajados: p.id_trabajador === 'TRAB-005' ? 1 : 2,
    estado_firma: p.id_trabajador === 'TRAB-003' ? 'FIRMADA' : 'PENDIENTE',
    id_trabajador: p.id_trabajador,
    fecha_generacion: new Date().toISOString(),
  }));

  const d1 = pad2(Math.max(1, nowParts.day - 2));
  const d2 = pad2(Math.max(1, nowParts.day - 1));

  const marcas: MarcaRow[] = [
    {
      id_marca: 1,
      id_trabajador_presencial: 'TRAB-001',
      fecha_hora: `${ym}-${d1}T08:56:12-03:00`,
      tipo_marca: 'ENTRADA',
      metodo_biometrico: 'QR',
      respaldo_email: true,
      id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-001`,
    },
    {
      id_marca: 2,
      id_trabajador_presencial: 'TRAB-001',
      fecha_hora: `${ym}-${d1}T18:04:40-03:00`,
      tipo_marca: 'SALIDA',
      metodo_biometrico: 'QR',
      respaldo_email: true,
      id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-001`,
    },
    {
      id_marca: 3,
      id_trabajador_presencial: 'TRAB-001',
      fecha_hora: `${ym}-${d2}T09:02:18-03:00`,
      tipo_marca: 'ENTRADA',
      metodo_biometrico: 'QR',
      respaldo_email: true,
      id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-001`,
    },
    {
      id_marca: 4,
      id_trabajador_presencial: 'TRAB-001',
      fecha_hora: `${ym}-${d2}T18:01:05-03:00`,
      tipo_marca: 'SALIDA',
      metodo_biometrico: 'QR',
      respaldo_email: true,
      id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-001`,
    },
    {
      id_marca: 5,
      id_trabajador_presencial: 'TRAB-002',
      fecha_hora: `${ym}-${d1}T09:14:22-03:00`,
      tipo_marca: 'ENTRADA',
      metodo_biometrico: 'QR',
      respaldo_email: true,
      id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-002`,
    },
    {
      id_marca: 6,
      id_trabajador_presencial: 'TRAB-002',
      fecha_hora: `${ym}-${d1}T18:10:00-03:00`,
      tipo_marca: 'SALIDA',
      metodo_biometrico: 'QR',
      respaldo_email: true,
      id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-002`,
    },
    {
      id_marca: 7,
      id_trabajador_presencial: 'TRAB-002',
      fecha_hora: `${ym}-${d2}T09:19:45-03:00`,
      tipo_marca: 'ENTRADA',
      metodo_biometrico: 'QR',
      respaldo_email: true,
      id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-002`,
    },
    {
      id_marca: 8,
      id_trabajador_presencial: 'TRAB-003',
      fecha_hora: `${ym}-${d1}T08:25:10-03:00`,
      tipo_marca: 'ENTRADA',
      metodo_biometrico: 'QR',
      respaldo_email: true,
      id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-003`,
    },
    {
      id_marca: 9,
      id_trabajador_presencial: 'TRAB-003',
      fecha_hora: `${ym}-${d1}T17:32:51-03:00`,
      tipo_marca: 'SALIDA',
      metodo_biometrico: 'QR',
      respaldo_email: true,
      id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-003`,
    },
    {
      id_marca: 10,
      id_trabajador_presencial: 'TRAB-003',
      fecha_hora: `${ym}-${d2}T08:28:04-03:00`,
      tipo_marca: 'ENTRADA',
      metodo_biometrico: 'QR',
      respaldo_email: true,
      id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-003`,
    },
    {
      id_marca: 11,
      id_trabajador_presencial: 'TRAB-003',
      fecha_hora: `${ym}-${d2}T17:30:12-03:00`,
      tipo_marca: 'SALIDA',
      metodo_biometrico: 'QR',
      respaldo_email: true,
      id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-003`,
    },
    {
      id_marca: 12,
      id_trabajador_presencial: 'TRAB-004',
      fecha_hora: `${ym}-${d1}T07:55:00-03:00`,
      tipo_marca: 'ENTRADA',
      metodo_biometrico: 'HUELLA',
      respaldo_email: true,
      id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-004`,
    },
    {
      id_marca: 13,
      id_trabajador_presencial: 'TRAB-004',
      fecha_hora: `${ym}-${d1}T17:05:19-03:00`,
      tipo_marca: 'SALIDA',
      metodo_biometrico: 'HUELLA',
      respaldo_email: true,
      id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-004`,
    },
    {
      id_marca: 14,
      id_trabajador_presencial: 'TRAB-004',
      fecha_hora: `${ym}-${d2}T08:11:37-03:00`,
      tipo_marca: 'ENTRADA',
      metodo_biometrico: 'QR',
      respaldo_email: true,
      id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-004`,
    },
    {
      id_marca: 15,
      id_trabajador_presencial: 'TRAB-004',
      fecha_hora: `${ym}-${d2}T17:02:10-03:00`,
      tipo_marca: 'SALIDA',
      metodo_biometrico: 'QR',
      respaldo_email: true,
      id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-004`,
    },
    {
      id_marca: 16,
      id_trabajador_presencial: 'TRAB-005',
      fecha_hora: `${ym}-${d2}T08:59:14-03:00`,
      tipo_marca: 'ENTRADA',
      metodo_biometrico: 'QR',
      respaldo_email: true,
      id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-005`,
    },
    {
      id_marca: 17,
      id_trabajador_presencial: 'TRAB-005',
      fecha_hora: `${ym}-${d2}T18:00:44-03:00`,
      tipo_marca: 'SALIDA',
      metodo_biometrico: 'QR',
      respaldo_email: true,
      id_acta: `ACTA-${anio}-${pad2(mes)}-TRAB-005`,
    },
  ];

  const productos: ProductoRow[] = [
    {
      codigo_producto: 101,
      nombre_producto: 'Plan Enterprise Control Biométrico (Anual)',
      categoria_producto: 'Software SaaS',
      porcentaje_comision_producto: 8.5,
    },
    {
      codigo_producto: 102,
      nombre_producto: 'Tótem Lector QR Industrial Pro',
      categoria_producto: 'Hardware',
      porcentaje_comision_producto: 5.0,
    },
    {
      codigo_producto: 103,
      nombre_producto: 'Licencia Módulo Nómina & Art. 22',
      categoria_producto: 'Software SaaS',
      porcentaje_comision_producto: 10.0,
    },
    {
      codigo_producto: 104,
      nombre_producto: 'Servicio Implementación Multi-Sucursal',
      categoria_producto: 'Servicios',
      porcentaje_comision_producto: 6.5,
    },
  ];

  const lastDay = new Date(anio, mes, 0).getDate();
  const metas: MetaVentaRow[] = [
    {
      id_meta: 1,
      fecha_inicio: `${ym}-01`,
      fecha_fin: `${ym}-${pad2(lastDay)}`,
      monto_objetivo: 18000000,
      monto_actual: 13450000,
      estado: 'EN_PROGRESO',
    },
    {
      id_meta: 2,
      fecha_inicio: `${ym}-01`,
      fecha_fin: `${ym}-15`,
      monto_objetivo: 6500000,
      monto_actual: 7200000,
      estado: 'CUMPLIDA',
    },
  ];

  const ventas: VentaRow[] = [
    { codigo_venta: 1001, fecha: `${ym}-04T11:20:00-03:00`, monto_total: 5200000 },
    { codigo_venta: 1002, fecha: `${ym}-08T15:45:00-03:00`, monto_total: 4150000 },
    { codigo_venta: 1003, fecha: `${ym}-12T10:15:00-03:00`, monto_total: 4100000 },
    { codigo_venta: 1004, fecha: `${ym}-14T16:30:00-03:00`, monto_total: 7200000 },
  ];

  const detallesVenta: DetalleVentaRow[] = [
    {
      id_detalle: 1,
      id_venta: 1001,
      id_vendedor: 'VEND-001',
      codigo_producto: 101,
      id_meta: 1,
      cantidad: 2,
      precio_unitario: 1850000,
      subtotal: 3700000,
    },
    {
      id_detalle: 2,
      id_venta: 1001,
      id_vendedor: 'VEND-001',
      codigo_producto: 102,
      id_meta: 1,
      cantidad: 2,
      precio_unitario: 750000,
      subtotal: 1500000,
    },
    {
      id_detalle: 3,
      id_venta: 1002,
      id_vendedor: 'VEND-002',
      codigo_producto: 103,
      id_meta: 1,
      cantidad: 2,
      precio_unitario: 1450000,
      subtotal: 2900000,
    },
    {
      id_detalle: 4,
      id_venta: 1002,
      id_vendedor: 'VEND-002',
      codigo_producto: 104,
      id_meta: 1,
      cantidad: 1,
      precio_unitario: 1250000,
      subtotal: 1250000,
    },
    {
      id_detalle: 5,
      id_venta: 1003,
      id_vendedor: 'VEND-003',
      codigo_producto: 101,
      id_meta: 1,
      cantidad: 2,
      precio_unitario: 1650000,
      subtotal: 3300000,
    },
    {
      id_detalle: 6,
      id_venta: 1003,
      id_vendedor: 'VEND-003',
      codigo_producto: 102,
      id_meta: 1,
      cantidad: 1,
      precio_unitario: 800000,
      subtotal: 800000,
    },
    {
      id_detalle: 7,
      id_venta: 1004,
      id_vendedor: 'VEND-001',
      codigo_producto: 103,
      id_meta: 2,
      cantidad: 4,
      precio_unitario: 1800000,
      subtotal: 7200000,
    },
  ];

  const schedule: ScheduleConfig = {
    activo: true,
    frecuencia: 'DIARIO',
    horaEjecucion: '18:30',
    emailAdmin: 'rrhh-admin@empresa-jssp.cl',
    toleranciaMinutos: 5,
  };

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
    schedule,
    nextMarcaId: 18,
    nextMetaId: 3,
    nextProductoId: 105,
    nextVentaId: 1005,
    nextDetalleId: 8,
  };
}

const store = createInitialStore();
const sseClients = new Set<Response>();

function broadcastSse(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    res.write(payload);
  }
}

function buildAttendanceEmailHtml(params: {
  nombreCompleto: string;
  rut: string;
  tipoMarca: TipoMarca;
  fechaHoraLocal: string;
  sucursal: string;
  metodoBiometrico: string;
  idActa: string;
  idMarca: number;
}): string {
  const badgeColor = params.tipoMarca === 'ENTRADA' ? '#16A34A' : '#DC2626';
  return `
  <div style="font-family:'DM Sans',Arial,sans-serif;max-width:560px;margin:0 auto;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;background:#FFFFFF;color:#0F172A;">
    <div style="background:#0F172A;padding:20px 24px;color:#FFFFFF;">
      <div style="font-size:12px;color:#94A3B8;margin-bottom:4px;">Comprobante Electrónico de Asistencia · Art. 33 CT</div>
      <div style="font-size:18px;font-weight:700;">Confirmación de Marcación ${escapeHtml(params.tipoMarca)}</div>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 16px;font-size:15px;">Estimado(a) <strong>${escapeHtml(params.nombreCompleto)}</strong> (RUT ${escapeHtml(params.rut)}),</p>
      <p style="margin:0 0 20px;font-size:14px;color:#334155;">Se ha registrado exitosamente su marcación en el sistema de control de asistencia:</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #E2E8F0;">
        <tr><td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;color:#64748B;">Tipo de Marca</td><td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;font-weight:700;color:${badgeColor};">${escapeHtml(params.tipoMarca)}</td></tr>
        <tr><td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;color:#64748B;">Fecha y Hora (Chile)</td><td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;font-family:monospace;">${escapeHtml(params.fechaHoraLocal)}</td></tr>
        <tr><td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;color:#64748B;">Sucursal</td><td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;">${escapeHtml(params.sucursal)}</td></tr>
        <tr><td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;color:#64748B;">Método de Registro</td><td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;">${escapeHtml(params.metodoBiometrico)}</td></tr>
        <tr><td style="padding:10px 12px;color:#64748B;">Acta Mensual / Folio</td><td style="padding:10px 12px;font-family:monospace;">${escapeHtml(params.idActa)} · #${params.idMarca}</td></tr>
      </table>
      <p style="margin:20px 0 0;font-size:12px;color:#64748B;">Este comprobante constituye respaldo automático de su registro de jornada laboral.</p>
    </div>
  </div>`;
}

async function dispatchEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ sent: boolean; mode: 'resend' | 'smtp' | 'preview'; messageId: string }> {
  const resendKey = process.env.RESEND_API_KEY?.trim();
  const smtpHost = process.env.SMTP_HOST?.trim();
  const smtpUser = process.env.SMTP_USER?.trim();
  const smtpPass = process.env.SMTP_PASS?.trim();
  const fromAddr = process.env.SMTP_FROM?.trim() || 'JSSP Asistencia <asistencia@jsspcontrol.cl>';

  if (resendKey) {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddr,
        to: [params.to],
        subject: params.subject,
        html: params.html,
      }),
    });
    if (resp.ok) {
      const json = (await resp.json()) as { id?: string };
      return { sent: true, mode: 'resend', messageId: json.id || `resend-${crypto.randomUUID()}` };
    }
  }

  if (smtpHost && smtpUser && smtpPass) {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT || 587) === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });
    const info = await transporter.sendMail({
      from: fromAddr,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });
    return { sent: true, mode: 'smtp', messageId: info.messageId || `smtp-${crypto.randomUUID()}` };
  }

  return {
    sent: true,
    mode: 'preview',
    messageId: `sim-${crypto.randomBytes(6).toString('hex')}`,
  };
}

function buildActaMensualAdmin(mes: number, anio: number) {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const inicioMes = `${anio}-${pad2(mes)}-01`;
  const lastDay = new Date(anio, mes, 0).getDate();
  const finMes = `${anio}-${pad2(mes)}-${pad2(lastDay)}`;

  const asistencia_presencial = store.presenciales
    .map((tp) => {
      const t = store.trabajadores.find((w) => w.id_trabajador === tp.id_trabajador);
      if (!t) return null;
      const suc = store.sucursales.find((s) => s.id_sucursal === t.id_sucursal);
      const acta = store.actas.find(
        (a) => a.id_trabajador === tp.id_trabajador && a.mes === mes && a.año === anio
      );
      const marcasActa = acta
        ? store.marcas
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
        turno_asignado: tp.turno_asignado,
        id_acta: acta?.id_acta || 'SIN_ACTA',
        total_dias_trabajados: acta?.total_dias_trabajados || 0,
        estado_firma: acta?.estado_firma || 'SIN_MARCAS',
        marcas: marcasActa,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => a.nombre_completo.localeCompare(b.nombre_completo));

  const metas_venta = store.metas
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

      for (const dv of store.detallesVenta) {
        if (dv.id_meta !== m.id_meta) continue;
        const vt = store.vendedores.find((v) => v.id_trabajador === dv.id_vendedor);
        const t = store.trabajadores.find((w) => w.id_trabajador === dv.id_vendedor);
        if (!vt || !t) continue;
        const prod = store.productos.find((p) => p.codigo_producto === dv.codigo_producto);
        const pctCom = prod?.porcentaje_comision_producto || 0;

        let entry = bySeller.get(vt.id_trabajador);
        if (!entry) {
          entry = {
            id_trabajador: vt.id_trabajador,
            vendedor: `${t.nombre_trabajador} ${t.apellido_trabajador}`,
            zona_cobertura: vt.zona_cobertura,
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

function recalculateSalesAndGoals(idVenta?: number, idMeta?: number) {
  if (idVenta !== undefined) {
    const venta = store.ventas.find((v) => v.codigo_venta === idVenta);
    if (venta) {
      venta.monto_total = store.detallesVenta
        .filter((d) => d.id_venta === idVenta)
        .reduce((acc, d) => acc + d.subtotal, 0);
    }
  }
  if (idMeta !== undefined) {
    const meta = store.metas.find((m) => m.id_meta === idMeta);
    if (meta) {
      const sumMeta = store.detallesVenta
        .filter((d) => d.id_meta === idMeta)
        .reduce((acc, d) => acc + d.subtotal, 0);
      meta.monto_actual = sumMeta;
      const todayChile = getChileDateParts(new Date()).dateStr;
      if (sumMeta >= meta.monto_objetivo) {
        meta.estado = 'CUMPLIDA';
      } else if (meta.fecha_fin && todayChile > meta.fecha_fin) {
        meta.estado = 'NO_CUMPLIDA';
      } else {
        meta.estado = 'EN_PROGRESO';
      }
    }
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // SSE stream for real-time local sync across clients
  app.get('/api/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    sseClients.add(res);
    req.on('close', () => {
      sseClients.delete(res);
    });
  });

  app.get('/api/snapshot', (_req: Request, res: Response) => {
    res.json({
      sucursales: store.sucursales,
      trabajadores: store.trabajadores,
      presenciales: store.presenciales,
      vendedores: store.vendedores,
      actas: store.actas,
      marcas: [...store.marcas].sort(
        (a, b) => new Date(b.fecha_hora).getTime() - new Date(a.fecha_hora).getTime()
      ),
      productos: store.productos,
      metas: store.metas,
      ventas: store.ventas,
      detallesVenta: store.detallesVenta,
      emailLogs: store.emailLogs.slice(0, 50),
      schedule: store.schedule,
    });
  });

  app.get('/api/acta-admin', (req: Request, res: Response) => {
    const nowParts = getChileDateParts(new Date());
    const mes = Number(req.query.mes) || nowParts.month;
    const anio = Number(req.query.anio) || nowParts.year;
    res.json(buildActaMensualAdmin(mes, anio));
  });

  // Exact replica of PostgreSQL RPC jssp_registrar_marca_asistencia
  app.post('/api/attendance/mark', async (req: Request, res: Response) => {
    try {
      const { id_trabajador, tipo_marca, metodo_biometrico = 'QR' } = req.body as {
        id_trabajador?: string;
        tipo_marca?: TipoMarca;
        metodo_biometrico?: string;
      };

      if (!id_trabajador || (tipo_marca !== 'ENTRADA' && tipo_marca !== 'SALIDA')) {
        res.status(400).json({ error: 'Debe indicar id_trabajador y tipo_marca (ENTRADA o SALIDA).' });
        return;
      }

      const presencial = store.presenciales.find((p) => p.id_trabajador === id_trabajador);
      if (!presencial) {
        const isArt22 = store.vendedores.some((v) => v.id_trabajador === id_trabajador);
        if (isArt22) {
          res.status(400).json({
            error: `El trabajador ${id_trabajador} está contratado bajo Artículo 22 del Código del Trabajo (exento de registro presencial).`,
          });
          return;
        }
        res.status(404).json({
          error: `El trabajador ${id_trabajador} no está registrado como trabajador presencial.`,
        });
        return;
      }

      const lastMark = [...store.marcas]
        .filter((m) => m.id_trabajador_presencial === id_trabajador)
        .sort((a, b) => new Date(b.fecha_hora).getTime() - new Date(a.fecha_hora).getTime())[0];

      if (tipo_marca === 'ENTRADA' && lastMark?.tipo_marca === 'ENTRADA') {
        res.status(409).json({ error: 'Ya existe una ENTRADA activa sin SALIDA previa.' });
        return;
      }

      if (tipo_marca === 'SALIDA' && (!lastMark || lastMark.tipo_marca === 'SALIDA')) {
        res.status(409).json({ error: 'No existe una ENTRADA activa previa para registrar SALIDA.' });
        return;
      }

      const now = new Date();
      const chile = getChileDateParts(now);
      const pad2 = (n: number) => String(n).padStart(2, '0');
      const idActa = `ACTA-${chile.year}-${pad2(chile.month)}-${id_trabajador}`;

      let acta = store.actas.find(
        (a) => a.id_trabajador === id_trabajador && a.mes === chile.month && a.año === chile.year
      );
      if (!acta) {
        acta = {
          id_acta: idActa,
          mes: chile.month,
          año: chile.year,
          total_dias_trabajados: 0,
          estado_firma: 'PENDIENTE',
          id_trabajador,
          fecha_generacion: now.toISOString(),
        };
        store.actas.push(acta);
      }

      const newMarca: MarcaRow = {
        id_marca: store.nextMarcaId++,
        id_trabajador_presencial: id_trabajador,
        fecha_hora: now.toISOString(),
        tipo_marca,
        metodo_biometrico: String(metodo_biometrico || 'QR'),
        respaldo_email: false,
        id_acta: acta.id_acta,
      };
      store.marcas.push(newMarca);

      // Count unique days in Chile timezone with ENTRADA
      const uniqueDays = new Set(
        store.marcas
          .filter((m) => m.id_acta === acta!.id_acta && m.tipo_marca === 'ENTRADA')
          .map((m) => getChileDateParts(new Date(m.fecha_hora)).dateStr)
      );
      acta.total_dias_trabajados = uniqueDays.size;

      // Dispatch email confirmation to worker
      const trab = store.trabajadores.find((t) => t.id_trabajador === id_trabajador);
      const suc = store.sucursales.find((s) => s.id_sucursal === trab?.id_sucursal);
      let emailStatus: EmailLogRow | undefined;

      if (trab?.email_trabajador) {
        const nombreCompleto = `${trab.nombre_trabajador} ${trab.apellido_trabajador}`;
        const html = buildAttendanceEmailHtml({
          nombreCompleto,
          rut: trab.rut,
          tipoMarca: tipo_marca,
          fechaHoraLocal: chile.displayStr,
          sucursal: suc?.nombre_sucursal || 'Sucursal Principal',
          metodoBiometrico: newMarca.metodo_biometrico,
          idActa: acta.id_acta,
          idMarca: newMarca.id_marca,
        });
        const delivery = await dispatchEmail({
          to: trab.email_trabajador,
          subject: `Comprobante de Marcación QR (${tipo_marca}) — ${chile.displayStr}`,
          html,
        });
        newMarca.respaldo_email = delivery.sent;
        emailStatus = {
          id: crypto.randomUUID(),
          id_marca: newMarca.id_marca,
          id_trabajador: trab.id_trabajador,
          nombre_completo: nombreCompleto,
          email_trabajador: trab.email_trabajador,
          tipo_marca,
          fecha_hora_local: chile.displayStr,
          id_acta: acta.id_acta,
          sent: delivery.sent,
          mode: delivery.mode,
          messageId: delivery.messageId,
          previewHtml: html,
          timestamp: now.toISOString(),
        };
        store.emailLogs.unshift(emailStatus);
      }

      broadcastSse('jssp_sync', {
        table: 'JSSP_MARCA_ASISTENCIA',
        id_marca: newMarca.id_marca,
        id_trabajador,
        tipo_marca,
      });

      res.json({
        id_marca: newMarca.id_marca,
        id_acta: acta.id_acta,
        fecha_hora: newMarca.fecha_hora,
        tipo_marca: newMarca.tipo_marca,
        dias_trabajados_mes: acta.total_dias_trabajados,
        email_status: emailStatus,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Error interno' });
    }
  });

  // Server-side email endpoint used both by local mode and Supabase mode
  app.post('/api/attendance/send-email', async (req: Request, res: Response) => {
    try {
      const {
        id_marca,
        id_trabajador,
        nombre_completo,
        rut,
        email_trabajador,
        tipo_marca,
        fecha_hora_local,
        sucursal,
        metodo_biometrico = 'QR',
        id_acta,
      } = req.body as {
        id_marca: number;
        id_trabajador: string;
        nombre_completo: string;
        rut?: string;
        email_trabajador: string;
        tipo_marca: TipoMarca;
        fecha_hora_local: string;
        sucursal?: string;
        metodo_biometrico?: string;
        id_acta: string;
      };

      if (!email_trabajador || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email_trabajador)) {
        res.status(400).json({ error: 'Dirección de correo electrónico inválida.' });
        return;
      }

      const html = buildAttendanceEmailHtml({
        nombreCompleto: nombre_completo || id_trabajador,
        rut: rut || '—',
        tipoMarca: tipo_marca || 'ENTRADA',
        fechaHoraLocal: fecha_hora_local || getChileDateParts(new Date()).displayStr,
        sucursal: sucursal || 'Sucursal Asignada',
        metodoBiometrico: metodo_biometrico,
        idActa: id_acta || 'ACTA-ACTUAL',
        idMarca: Number(id_marca) || 0,
      });

      const delivery = await dispatchEmail({
        to: email_trabajador,
        subject: `Comprobante de Marcación QR (${tipo_marca}) — ${fecha_hora_local}`,
        html,
      });

      // Also update local store if mark exists
      const localMark = store.marcas.find((m) => m.id_marca === Number(id_marca));
      if (localMark && delivery.sent) {
        localMark.respaldo_email = true;
      }

      const logEntry: EmailLogRow = {
        id: crypto.randomUUID(),
        id_marca: Number(id_marca) || 0,
        id_trabajador: id_trabajador || '',
        nombre_completo: nombre_completo || '',
        email_trabajador,
        tipo_marca: tipo_marca || 'ENTRADA',
        fecha_hora_local: fecha_hora_local || '',
        id_acta: id_acta || '',
        sent: delivery.sent,
        mode: delivery.mode,
        messageId: delivery.messageId,
        previewHtml: html,
        timestamp: new Date().toISOString(),
      };
      store.emailLogs.unshift(logEntry);
      broadcastSse('jssp_sync', { table: 'EMAIL_DISPATCH', id_marca });

      res.json(logEntry);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Error enviando correo' });
    }
  });

  app.post('/api/actas/:idActa/sign', (req: Request, res: Response) => {
    const idActa = String(req.params.idActa);
    const { estado_firma = 'FIRMADA' } = req.body as { estado_firma?: string };
    const acta = store.actas.find((a) => a.id_acta === idActa);
    if (!acta) {
      res.status(404).json({ error: 'Acta mensual no encontrada.' });
      return;
    }
    acta.estado_firma = estado_firma;
    broadcastSse('jssp_sync', { table: 'JSSP_ACTA_ASISTENCIA_MENSUAL', id_acta: idActa });
    res.json(acta);
  });

  app.post('/api/sales', (req: Request, res: Response) => {
    const { id_vendedor, id_meta, items } = req.body as {
      id_vendedor?: string;
      id_meta?: number;
      items?: Array<{ codigo_producto: number; cantidad: number; precio_unitario: number }>;
    };

    if (!id_vendedor || !id_meta || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Debe especificar vendedor, meta e items de venta.' });
      return;
    }

    const seller = store.vendedores.find((v) => v.id_trabajador === id_vendedor);
    if (!seller) {
      res.status(404).json({ error: 'Vendedor de terreno no encontrado.' });
      return;
    }

    const codigoVenta = store.nextVentaId++;
    const venta: VentaRow = {
      codigo_venta: codigoVenta,
      fecha: new Date().toISOString(),
      monto_total: 0,
    };
    store.ventas.push(venta);

    for (const item of items) {
      const cantidad = Number(item.cantidad);
      const precio = Number(item.precio_unitario);
      if (cantidad <= 0 || precio <= 0) continue;
      store.detallesVenta.push({
        id_detalle: store.nextDetalleId++,
        id_venta: codigoVenta,
        id_vendedor,
        codigo_producto: Number(item.codigo_producto),
        id_meta: Number(id_meta),
        cantidad,
        precio_unitario: precio,
        subtotal: cantidad * precio,
      });
    }

    recalculateSalesAndGoals(codigoVenta, Number(id_meta));
    broadcastSse('jssp_sync', { table: 'JSSP_DETALLE_VENTA', codigo_venta: codigoVenta });
    res.json({ codigo_venta: codigoVenta, monto_total: venta.monto_total });
  });

  app.post('/api/metas', (req: Request, res: Response) => {
    const { fecha_inicio, fecha_fin, monto_objetivo } = req.body as {
      fecha_inicio?: string;
      fecha_fin?: string;
      monto_objetivo?: number;
    };
    if (!fecha_inicio || !monto_objetivo || Number(monto_objetivo) <= 0) {
      res.status(400).json({ error: 'Indique fecha de inicio y monto objetivo válido.' });
      return;
    }
    const newMeta: MetaVentaRow = {
      id_meta: store.nextMetaId++,
      fecha_inicio,
      fecha_fin: fecha_fin || null,
      monto_objetivo: Number(monto_objetivo),
      monto_actual: 0,
      estado: 'EN_PROGRESO',
    };
    store.metas.push(newMeta);
    broadcastSse('jssp_sync', { table: 'JSSP_META_VENTA', id_meta: newMeta.id_meta });
    res.json(newMeta);
  });

  app.post('/api/productos', (req: Request, res: Response) => {
    const { nombre_producto, categoria_producto, porcentaje_comision_producto } = req.body as {
      nombre_producto?: string;
      categoria_producto?: string;
      porcentaje_comision_producto?: number;
    };
    const pct = Number(porcentaje_comision_producto);
    if (!nombre_producto || Number.isNaN(pct) || pct < 0 || pct > 100) {
      res.status(400).json({ error: 'Nombre de producto y comisión entre 0 y 100 son obligatorios.' });
      return;
    }
    const newProd: ProductoRow = {
      codigo_producto: store.nextProductoId++,
      nombre_producto: nombre_producto.trim(),
      categoria_producto: (categoria_producto || 'General').trim(),
      porcentaje_comision_producto: pct,
    };
    store.productos.push(newProd);
    broadcastSse('jssp_sync', { table: 'JSSP_PRODUCTO', codigo_producto: newProd.codigo_producto });
    res.json(newProd);
  });

  app.post('/api/trabajadores', (req: Request, res: Response) => {
    const body = req.body as {
      id_trabajador?: string;
      rut?: string;
      nombre_trabajador?: string;
      apellido_trabajador?: string;
      email_trabajador?: string;
      sueldo_base_trabajador?: number;
      id_sucursal?: number;
      modalidad?: 'PRESENCIAL' | 'ART22';
      rol?: string;
      turno_asignado?: string;
      zona_cobertura?: string;
      es_articulo22?: boolean;
    };

    if (!body.id_trabajador || !body.rut || !body.nombre_trabajador || !body.email_trabajador) {
      res.status(400).json({ error: 'Complete ID, RUT, nombre y correo electrónico.' });
      return;
    }
    if (store.trabajadores.some((t) => t.id_trabajador === body.id_trabajador)) {
      res.status(409).json({ error: `El identificador ${body.id_trabajador} ya existe.` });
      return;
    }

    const trab: TrabajadorRow = {
      id_trabajador: body.id_trabajador.trim().toUpperCase(),
      rut: body.rut.trim(),
      nombre_trabajador: body.nombre_trabajador.trim(),
      apellido_trabajador: (body.apellido_trabajador || '').trim(),
      email_trabajador: body.email_trabajador.trim(),
      sueldo_base_trabajador: Number(body.sueldo_base_trabajador) || 850000,
      id_sucursal: Number(body.id_sucursal) || 1,
      rol_sistema: 'TRABAJADOR',
    };
    store.trabajadores.push(trab);

    if (body.modalidad === 'ART22') {
      store.vendedores.push({
        id_trabajador: trab.id_trabajador,
        es_articulo22: body.es_articulo22 ?? true,
        zona_cobertura: (body.zona_cobertura || 'Región Metropolitana').trim(),
      });
    } else {
      store.presenciales.push({
        id_trabajador: trab.id_trabajador,
        rol: (body.rol || 'Operaciones').trim(),
        turno_asignado: (body.turno_asignado || '09:00 - 18:00').trim(),
      });
    }

    broadcastSse('jssp_sync', { table: 'JSSP_TRABAJADOR', id_trabajador: trab.id_trabajador });
    res.json(trab);
  });

  app.post('/api/schedule', (req: Request, res: Response) => {
    const body = req.body as Partial<ScheduleConfig>;
    store.schedule = {
      ...store.schedule,
      ...body,
      toleranciaMinutos: Math.max(0, Math.min(60, Number(body.toleranciaMinutos ?? store.schedule.toleranciaMinutos))),
    };
    res.json(store.schedule);
  });

  app.post('/api/reports/send-admin-pdf', async (req: Request, res: Response) => {
    try {
      const { emailAdmin, mes, anio, tasaPuntualidad, totalAtrasos, fileName } = req.body as {
        emailAdmin?: string;
        mes?: number;
        anio?: number;
        tasaPuntualidad?: number;
        totalAtrasos?: number;
        fileName?: string;
      };
      const target = (emailAdmin || store.schedule.emailAdmin || '').trim();
      if (!target || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
        res.status(400).json({ error: 'Correo de administrador inválido.' });
        return;
      }

      const nowStr = getChileDateParts(new Date()).displayStr;
      const html = `
      <div style="font-family:'DM Sans',Arial,sans-serif;max-width:560px;margin:0 auto;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;background:#FFFFFF;color:#0F172A;">
        <div style="background:#0F172A;padding:20px 24px;color:#FFFFFF;">
          <div style="font-size:12px;color:#94A3B8;margin-bottom:4px;">Envío Automático Programado · JSSP Control</div>
          <div style="font-size:18px;font-weight:700;">Reporte Mensual de Puntualidad (${escapeHtml(String(mes))}/${escapeHtml(String(anio))})</div>
        </div>
        <div style="padding:24px;">
          <p style="margin:0 0 16px;font-size:14px;color:#334155;">Se ha generado el consolidado automático de puntualidad y actas de asistencia para revisión administrativa:</p>
          <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #E2E8F0;">
            <tr><td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;color:#64748B;">Archivo PDF Generado</td><td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;font-family:monospace;">${escapeHtml(fileName || 'Reporte_Puntualidad.pdf')}</td></tr>
            <tr><td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;color:#64748B;">Tasa de Puntualidad Global</td><td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;font-weight:700;color:#16A34A;">${Number(tasaPuntualidad ?? 100)}%</td></tr>
            <tr><td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;color:#64748B;">Atrasos Detectados</td><td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;font-weight:700;color:#D97706;">${Number(totalAtrasos ?? 0)}</td></tr>
            <tr><td style="padding:10px 12px;color:#64748B;">Fecha Emisión (Chile)</td><td style="padding:10px 12px;font-family:monospace;">${escapeHtml(nowStr)}</td></tr>
          </table>
        </div>
      </div>`;

      const delivery = await dispatchEmail({
        to: target,
        subject: `Reporte Automático de Puntualidad PDF — Período ${mes}/${anio}`,
        html,
      });
      store.schedule.ultimoEnvio = new Date().toISOString();

      res.json({
        sent: delivery.sent,
        mode: delivery.mode,
        messageId: delivery.messageId,
        emailAdmin: target,
        previewHtml: html,
        ultimoEnvio: store.schedule.ultimoEnvio,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Error enviando reporte' });
    }
  });

  // Vite dev middleware or static production build
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`JSSP Control server running on http://0.0.0.0:${port}`);
  });
}

startServer();
