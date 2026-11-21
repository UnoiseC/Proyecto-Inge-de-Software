import { useMemo, useState } from 'react';
import { FileText, Send, CheckCircle2, CalendarClock, Download } from 'lucide-react';
import type {
  ActaMensualAdminResponse,
  EmailDispatchLog,
  JsspSnapshot,
  ReportAutomationSchedule,
} from '../types/jssp.ts';
import { MESES_ES, summarizeWorkerPunctuality } from '../lib/punctuality.ts';
import { generateCommissionsArt22Pdf, generatePunctualityPdf } from '../lib/pdfGenerator.ts';

interface PdfReportsViewProps {
  snapshot: JsspSnapshot;
  actaAdmin: ActaMensualAdminResponse;
  mes: number;
  anio: number;
  schedule: ReportAutomationSchedule;
  onChangePeriodo: (mes: number, anio: number) => void;
  onSaveSchedule: (next: ReportAutomationSchedule) => Promise<void>;
  onSendAdminReport: (payload: {
    emailAdmin: string;
    mes: number;
    anio: number;
    tasaPuntualidad: number;
    totalAtrasos: number;
    fileName: string;
  }) => Promise<EmailDispatchLog>;
  onViewEmail: (log: EmailDispatchLog) => void;
}

export function PdfReportsView({
  snapshot,
  actaAdmin,
  mes,
  anio,
  schedule,
  onChangePeriodo,
  onSaveSchedule,
  onSendAdminReport,
  onViewEmail,
}: PdfReportsViewProps) {
  const [sucursalFiltro, setSucursalFiltro] = useState('TODAS');
  const [tolerancia, setTolerancia] = useState(schedule.toleranciaMinutos || 5);
  const [formSchedule, setFormSchedule] = useState<ReportAutomationSchedule>(schedule);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [sendingReport, setSendingReport] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string; log?: EmailDispatchLog } | null>(
    null
  );

  const previewRows = useMemo(() => {
    const base =
      sucursalFiltro === 'TODAS'
        ? actaAdmin.asistencia_presencial
        : actaAdmin.asistencia_presencial.filter((r) => r.nombre_sucursal === sucursalFiltro);

    return base.map((row) => ({
      row,
      summary: summarizeWorkerPunctuality(row, tolerancia),
    }));
  }, [actaAdmin.asistencia_presencial, sucursalFiltro, tolerancia]);

  const stats = useMemo(() => {
    const totalEntradas = previewRows.reduce((s, r) => s + r.summary.entradasTotales, 0);
    const totalPuntuales = previewRows.reduce((s, r) => s + r.summary.entradasPuntuales, 0);
    const totalAtrasos = previewRows.reduce((s, r) => s + r.summary.entradasConAtraso, 0);
    const minAtraso = previewRows.reduce((s, r) => s + r.summary.minutosAtrasoTotal, 0);
    return {
      tasaPuntualidad: totalEntradas > 0 ? Math.round((totalPuntuales / totalEntradas) * 100) : 100,
      totalAtrasos,
      minAtraso,
    };
  }, [previewRows]);

  const handleDownloadPunctualityPdf = () => {
    const res = generatePunctualityPdf(actaAdmin, {
      toleranciaMinutos: tolerancia,
      sucursalFiltro,
      download: true,
    });
    setFeedback({
      ok: true,
      text: `PDF generado y descargado: ${res.fileName}`,
    });
  };

  const handleDownloadArt22Pdf = () => {
    const label = `${MESES_ES[mes - 1]}_${anio}`;
    const fileName = generateCommissionsArt22Pdf(actaAdmin.metas_venta, label, true);
    setFeedback({
      ok: true,
      text: `Liquidación de comisiones Art. 22 descargada: ${fileName}`,
    });
  };

  const handleSaveScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSchedule(true);
    setFeedback(null);
    try {
      await onSaveSchedule({ ...formSchedule, toleranciaMinutos: tolerancia });
      setFeedback({
        ok: true,
        text: `Programación automática guardada (${formSchedule.frecuencia} a las ${formSchedule.horaEjecucion}).`,
      });
    } catch (err) {
      setFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Error al guardar programación.',
      });
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleGenerateAndEmailAdmin = async () => {
    setSendingReport(true);
    setFeedback(null);
    try {
      const pdfRes = generatePunctualityPdf(actaAdmin, {
        toleranciaMinutos: tolerancia,
        sucursalFiltro,
        download: true,
      });
      const log = await onSendAdminReport({
        emailAdmin: formSchedule.emailAdmin,
        mes,
        anio,
        tasaPuntualidad: pdfRes.stats.tasaPuntualidadGlobal,
        totalAtrasos: pdfRes.stats.totalAtrasos,
        fileName: pdfRes.fileName,
      });
      setFeedback({
        ok: true,
        text: `Reporte PDF generado y enviado automáticamente al administrador (${formSchedule.emailAdmin}).`,
        log,
      });
    } catch (err) {
      setFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Error al enviar reporte al administrador.',
      });
    } finally {
      setSendingReport(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      {/* Left 8 cols: PDF Report Preview & Instant Download */}
      <section className="lg:col-span-8 bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Generador de Reportes de Puntualidad (PDF)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Basado en jssp_obtener_acta_mensual_admin · Formato A4 listo para auditoría laboral
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadArt22Pdf}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-slate-300 text-slate-800 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Comisiones Art. 22 PDF
            </button>
            <button
              type="button"
              onClick={handleDownloadPunctualityPdf}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              <FileText className="w-3.5 h-3.5" />
              Descargar Puntualidad PDF
            </button>
          </div>
        </div>

        {/* Parameters bar */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-4">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Mes</label>
            <select
              value={mes}
              onChange={(e) => onChangePeriodo(Number(e.target.value), anio)}
              className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
            >
              {MESES_ES.map((m, idx) => (
                <option key={m} value={idx + 1}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Año</label>
            <select
              value={anio}
              onChange={(e) => onChangePeriodo(mes, Number(e.target.value))}
              className="px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
            >
              {[2025, 2026, 2027].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Sucursal</label>
            <select
              value={sucursalFiltro}
              onChange={(e) => setSucursalFiltro(e.target.value)}
              className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
            >
              <option value="TODAS">Todas las sucursales</option>
              {snapshot.sucursales.map((s) => (
                <option key={s.id_sucursal} value={s.nombre_sucursal}>
                  {s.nombre_sucursal}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">
              Tolerancia Atraso (min)
            </label>
            <input
              type="number"
              min={0}
              max={60}
              value={tolerancia}
              onChange={(e) => setTolerancia(Number(e.target.value) || 0)}
              className="w-24 px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
            />
          </div>

          <div className="ml-auto text-right">
            <div className="text-[11px] text-slate-500">Puntualidad Global</div>
            <div className="text-base font-mono font-semibold tabular-nums text-emerald-700">
              {stats.tasaPuntualidad}% · {stats.totalAtrasos} atrasos ({stats.minAtraso} min)
            </div>
          </div>
        </div>

        {/* Report Table Preview */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-white text-xs font-medium text-slate-500">
                <th className="py-3 px-4">RUT</th>
                <th className="py-3 px-3">Trabajador</th>
                <th className="py-3 px-3">Sucursal</th>
                <th className="py-3 px-3">Turno</th>
                <th className="py-3 px-3 text-right">Días</th>
                <th className="py-3 px-3 text-right">Puntuales</th>
                <th className="py-3 px-3 text-right">Atrasos</th>
                <th className="py-3 px-4 text-right">% Punt.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {previewRows.map(({ row, summary }) => (
                <tr key={row.id_trabajador} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-mono tabular-nums text-slate-600">{row.rut}</td>
                  <td className="py-3 px-3 font-medium text-slate-900">{row.nombre_completo}</td>
                  <td className="py-3 px-3 text-slate-600">{row.nombre_sucursal}</td>
                  <td className="py-3 px-3 font-mono text-slate-600">{row.turno_asignado}</td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums">
                    {row.total_dias_trabajados}
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums">
                    {summary.entradasPuntuales}/{summary.entradasTotales}
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums text-amber-700">
                    {summary.entradasConAtraso} ({summary.minutosAtrasoTotal}m)
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                    {summary.tasaPuntualidad}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Right 4 cols: Automated Schedule & Admin Email Delivery */}
      <aside className="lg:col-span-4 bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Envío Automático al Administrador
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Despacho programado de reporte de puntualidad
            </p>
          </div>
          <CalendarClock className="w-5 h-5 text-slate-400" />
        </div>

        <form onSubmit={handleSaveScheduleSubmit} className="p-6 space-y-4">
          <label className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-md cursor-pointer">
            <span className="text-xs font-medium text-slate-800">
              Activar envío automático programado
            </span>
            <input
              type="checkbox"
              checked={formSchedule.activo}
              onChange={(e) => setFormSchedule({ ...formSchedule, activo: e.target.checked })}
              className="w-4 h-4 accent-slate-900"
            />
          </label>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Frecuencia de Generación
            </label>
            <select
              value={formSchedule.frecuencia}
              onChange={(e) =>
                setFormSchedule({
                  ...formSchedule,
                  frecuencia: e.target.value as ReportAutomationSchedule['frecuencia'],
                })
              }
              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-md"
            >
              <option value="DIARIO">Diario (Cierre de jornada)</option>
              <option value="SEMANAL">Semanal (Todos los viernes)</option>
              <option value="MENSUAL">Mensual (Cierre de acta)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Hora de Corte (America/Santiago)
            </label>
            <input
              type="time"
              value={formSchedule.horaEjecucion}
              onChange={(e) => setFormSchedule({ ...formSchedule, horaEjecucion: e.target.value })}
              className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-md"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Correo del Administrador
            </label>
            <input
              type="email"
              required
              value={formSchedule.emailAdmin}
              onChange={(e) => setFormSchedule({ ...formSchedule, emailAdmin: e.target.value })}
              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-md"
            />
          </div>

          <div className="pt-2 space-y-2.5">
            <button
              type="submit"
              disabled={savingSchedule}
              className="w-full px-4 py-2 text-xs font-medium border border-slate-300 text-slate-800 rounded-md hover:bg-slate-50 transition-colors"
            >
              {savingSchedule ? 'Guardando...' : 'Guardar Programación'}
            </button>

            <button
              type="button"
              disabled={sendingReport}
              onClick={handleGenerateAndEmailAdmin}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium bg-blue-700 text-white rounded-md hover:bg-blue-800 disabled:opacity-50 transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
              {sendingReport
                ? 'Generando y enviando...'
                : 'Generar PDF y Enviar al Administrador'}
            </button>
          </div>

          {feedback && (
            <div
              className={`p-3 rounded-md border text-xs space-y-2 ${
                feedback.ok
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}
            >
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{feedback.text}</span>
              </div>
              {feedback.log && (
                <button
                  type="button"
                  onClick={() => onViewEmail(feedback.log!)}
                  className="text-blue-700 font-medium hover:underline"
                >
                  Ver comprobante enviado al administrador
                </button>
              )}
            </div>
          )}
        </form>
      </aside>
    </div>
  );
}
