import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { env } from '../config/env.ts';
import type { TipoMarca } from '../types/database.ts';

export function escapeHtml(unsafe: string): string {
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function buildAttendanceEmailHtml(params: {
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

export function buildAdminReportEmailHtml(params: {
  mes: number;
  anio: number;
  fileName: string;
  tasaPuntualidad: number;
  totalAtrasos: number;
  fechaEmision: string;
}): string {
  return `
  <div style="font-family:'DM Sans',Arial,sans-serif;max-width:560px;margin:0 auto;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;background:#FFFFFF;color:#0F172A;">
    <div style="background:#0F172A;padding:20px 24px;color:#FFFFFF;">
      <div style="font-size:12px;color:#94A3B8;margin-bottom:4px;">Envío Automático Programado · Backend JSSP</div>
      <div style="font-size:18px;font-weight:700;">Reporte de Puntualidad (${escapeHtml(String(params.mes))}/${escapeHtml(String(params.anio))})</div>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 16px;font-size:14px;color:#334155;">Se adjunta el reporte automático de puntualidad y actas de asistencia en formato PDF:</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #E2E8F0;">
        <tr><td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;color:#64748B;">Archivo PDF</td><td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;font-family:monospace;">${escapeHtml(params.fileName)}</td></tr>
        <tr><td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;color:#64748B;">Tasa de Puntualidad Global</td><td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;font-weight:700;color:#16A34A;">${Number(params.tasaPuntualidad)}%</td></tr>
        <tr><td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;color:#64748B;">Atrasos Detectados</td><td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;font-weight:700;color:#D97706;">${Number(params.totalAtrasos)}</td></tr>
        <tr><td style="padding:10px 12px;color:#64748B;">Fecha Emisión (Chile)</td><td style="padding:10px 12px;font-family:monospace;">${escapeHtml(params.fechaEmision)}</td></tr>
      </table>
    </div>
  </div>`;
}

export async function dispatchEmail(params: {
  to: string;
  subject: string;
  html: string;
  attachment?: { filename: string; content: Buffer };
}): Promise<{ sent: boolean; mode: 'resend' | 'smtp' | 'preview'; messageId: string }> {
  if (env.resendApiKey) {
    const payload: Record<string, unknown> = {
      from: env.smtpFrom,
      to: [params.to],
      subject: params.subject,
      html: params.html,
    };
    if (params.attachment) {
      payload.attachments = [
        {
          filename: params.attachment.filename,
          content: params.attachment.content.toString('base64'),
        },
      ];
    }

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (resp.ok) {
      const json = (await resp.json()) as { id?: string };
      return { sent: true, mode: 'resend', messageId: json.id || `resend-${crypto.randomUUID()}` };
    }
  }

  if (env.smtpHost && env.smtpUser && env.smtpPass) {
    const transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpPort === 465,
      auth: { user: env.smtpUser, pass: env.smtpPass },
    });
    const info = await transporter.sendMail({
      from: env.smtpFrom,
      to: params.to,
      subject: params.subject,
      html: params.html,
      attachments: params.attachment
        ? [
            {
              filename: params.attachment.filename,
              content: params.attachment.content,
              contentType: 'application/pdf',
            },
          ]
        : undefined,
    });
    return { sent: true, mode: 'smtp', messageId: info.messageId || `smtp-${crypto.randomUUID()}` };
  }

  return {
    sent: true,
    mode: 'preview',
    messageId: `sim-${crypto.randomBytes(6).toString('hex')}`,
  };
}
