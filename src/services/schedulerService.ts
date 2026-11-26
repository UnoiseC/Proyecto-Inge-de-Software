import type { JsspRepository } from '../db/repository.ts';
import { buildAdminReportEmailHtml, dispatchEmail } from './emailService.ts';
import { buildPunctualityPdfBuffer } from './pdfService.ts';
import { getChileDateParts } from './timeService.ts';

export function startReportScheduler(
  repo: JsspRepository,
  broadcastSse: (event: string, data: unknown) => void
) {
  let lastDispatchedKey = '';

  const timer = setInterval(async () => {
    const sched = repo.getSchedule();
    if (!sched.activo || !sched.emailAdmin) return;

    const now = getChileDateParts(new Date());
    if (now.hhmm !== sched.horaEjecucion) return;

    if (sched.frecuencia === 'SEMANAL' && now.weekday !== 5) return;
    if (sched.frecuencia === 'MENSUAL') {
      const lastDay = new Date(now.year, now.month, 0).getDate();
      if (now.day !== lastDay) return;
    }

    const dispatchKey = `${now.dateStr}-${now.hhmm}`;
    if (lastDispatchedKey === dispatchKey) return;
    lastDispatchedKey = dispatchKey;

    try {
      const acta = await repo.getActaMensualAdmin(now.month, now.year);
      const pdf = buildPunctualityPdfBuffer(acta, {
        toleranciaMinutos: sched.toleranciaMinutos,
      });
      const html = buildAdminReportEmailHtml({
        mes: now.month,
        anio: now.year,
        fileName: pdf.fileName,
        tasaPuntualidad: pdf.tasaPuntualidadGlobal,
        totalAtrasos: pdf.totalAtrasos,
        fechaEmision: now.displayStr,
      });

      await dispatchEmail({
        to: sched.emailAdmin,
        subject: `Reporte Programado de Puntualidad (${now.month}/${now.year})`,
        html,
        attachment: { filename: pdf.fileName, content: pdf.buffer },
      });

      repo.updateSchedule({ ultimoEnvio: new Date().toISOString() });
      broadcastSse('jssp_sync', {
        table: 'SCHEDULED_REPORT',
        eventType: 'DISPATCHED',
        date: now.dateStr,
      });
    } catch (err) {
      console.error('Error en envío programado de reporte:', err);
    }
  }, 30_000);

  timer.unref?.();
  return timer;
}
