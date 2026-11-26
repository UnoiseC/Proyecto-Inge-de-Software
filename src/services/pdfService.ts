import { jsPDF as JsPdfNamed } from 'jspdf';
import autoTableModule from 'jspdf-autotable';
import type { ActaMensualAdminResponse, ComisionArt22Resumen } from '../types/database.ts';
import {
  MESES_ES,
  evaluateMarkPunctuality,
  extractChileClock,
  formatCLP,
  getChileDateParts,
  summarizeWorkerPunctuality,
} from './timeService.ts';

type AutoTableFn = (doc: InstanceType<typeof JsPdfNamed>, options: Record<string, unknown>) => void;

const JsPdfCtor = (
  typeof JsPdfNamed === 'function'
    ? JsPdfNamed
    : (JsPdfNamed as unknown as { jsPDF: typeof JsPdfNamed }).jsPDF
) as typeof JsPdfNamed;

const autoTable: AutoTableFn = (
  typeof autoTableModule === 'function'
    ? autoTableModule
    : (autoTableModule as unknown as { default: AutoTableFn }).default
) as AutoTableFn;

export function buildPunctualityPdfBuffer(
  acta: ActaMensualAdminResponse,
  options: { toleranciaMinutos?: number; sucursalFiltro?: string } = {}
): {
  buffer: Buffer;
  fileName: string;
  tasaPuntualidadGlobal: number;
  totalAtrasos: number;
  minutosAtrasoGlobal: number;
} {
  const tolerancia = options.toleranciaMinutos ?? 5;
  const sucursalFiltro = options.sucursalFiltro || 'TODAS';
  const rows =
    sucursalFiltro === 'TODAS'
      ? acta.asistencia_presencial
      : acta.asistencia_presencial.filter((r) => r.nombre_sucursal === sucursalFiltro);

  const doc = new JsPdfCtor({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const mesLabel = MESES_ES[(acta.periodo.mes || 1) - 1] || String(acta.periodo.mes);
  const emision = getChileDateParts(new Date());

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 210, 34, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Reporte Automático de Puntualidad y Asistencia', 14, 15);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(203, 213, 225);
  doc.text(
    `Período: ${mesLabel} ${acta.periodo.anio}  |  Sucursal: ${sucursalFiltro}  |  Tolerancia: ${tolerancia} min`,
    14,
    22
  );
  doc.text(`Emitido (America/Santiago): ${emision.displayStr}`, 14, 28);

  let totalEntradas = 0;
  let totalPuntuales = 0;
  let totalAtrasos = 0;
  let minutosAtrasoGlobal = 0;
  let totalMarcas = 0;

  const summaryBody = rows.map((row) => {
    const s = summarizeWorkerPunctuality(row, tolerancia);
    totalEntradas += s.entradasTotales;
    totalPuntuales += s.entradasPuntuales;
    totalAtrasos += s.entradasConAtraso;
    minutosAtrasoGlobal += s.minutosAtrasoTotal;
    totalMarcas += (row.marcas || []).length;
    return [
      row.rut,
      row.nombre_completo,
      row.nombre_sucursal || '—',
      row.turno_asignado || '—',
      String(row.total_dias_trabajados),
      `${s.entradasPuntuales}/${s.entradasTotales}`,
      String(s.entradasConAtraso),
      `${s.minutosAtrasoTotal} min`,
      `${s.tasaPuntualidad}%`,
      row.estado_firma,
    ];
  });

  const tasaGlobal = totalEntradas > 0 ? Math.round((totalPuntuales / totalEntradas) * 100) : 100;

  doc.setTextColor(15, 23, 42);
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.rect(14, 40, 182, 20, 'FD');

  const kpis = [
    { label: 'Trabajadores Presenciales', val: String(rows.length) },
    { label: 'Tasa Puntualidad Global', val: `${tasaGlobal}%` },
    { label: 'Atrasos Registrados', val: `${totalAtrasos} (${minutosAtrasoGlobal} min)` },
    { label: 'Total Marcas QR/Biom.', val: String(totalMarcas) },
  ];
  kpis.forEach((kpi, idx) => {
    const x = 18 + idx * 45;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.label, x, 47);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(kpi.val, x, 54);
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('1. Consolidado de Puntualidad por Trabajador (Actas Mensuales)', 14, 70);

  autoTable(doc, {
    startY: 74,
    head: [['RUT', 'Trabajador', 'Sucursal', 'Turno', 'Días', 'Punt.', 'Atrasos', 'Demora', '% Punt.', 'Acta']],
    body: summaryBody.length > 0 ? summaryBody : [['—', 'Sin registros en este período', '', '', '', '', '', '', '', '']],
    styles: { fontSize: 7.5, cellPadding: 2.2, textColor: [30, 41, 59] },
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 120;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('2. Registro Cronológico de Marcaciones e Incidencias', 14, finalY + 10);

  const detailBody: string[][] = [];
  for (const row of rows) {
    for (const m of row.marcas || []) {
      const clock = extractChileClock(m.fecha_hora_local);
      const evalRes = evaluateMarkPunctuality(
        m.fecha_hora_local,
        m.tipo_marca,
        row.turno_asignado,
        tolerancia
      );
      detailBody.push([
        clock.displayDate,
        clock.displayTime,
        row.nombre_completo,
        m.tipo_marca,
        m.metodo_biometrico,
        evalRes.etiqueta,
        m.respaldo_email ? 'Enviado' : 'Pendiente',
      ]);
    }
  }

  autoTable(doc, {
    startY: finalY + 14,
    head: [['Fecha', 'Hora', 'Trabajador', 'Tipo', 'Método', 'Evaluación Turno', 'Email']],
    body: detailBody.length > 0 ? detailBody : [['—', '—', 'Sin marcaciones', '—', '—', '—', '—']],
    styles: { fontSize: 7.5, cellPadding: 2, textColor: [30, 41, 59] },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  const fileName = `Reporte_Puntualidad_JSSP_${acta.periodo.anio}_${String(acta.periodo.mes).padStart(2, '0')}.pdf`;
  return {
    buffer: Buffer.from(doc.output('arraybuffer')),
    fileName,
    tasaPuntualidadGlobal: tasaGlobal,
    totalAtrasos,
    minutosAtrasoGlobal,
  };
}

export function buildArt22CommissionsPdfBuffer(
  comisiones: ComisionArt22Resumen[]
): { buffer: Buffer; fileName: string } {
  const doc = new JsPdfCtor({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const emision = getChileDateParts(new Date());

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 210, 32, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Liquidación de Comisiones — Vendedores Artículo 22', 14, 15);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(203, 213, 225);
  doc.text(`Emitido (America/Santiago): ${emision.displayStr}`, 14, 23);

  const body = comisiones.map((c) => [
    c.rut,
    c.nombre_completo,
    c.zona_cobertura,
    String(c.cantidad_ventas),
    formatCLP(c.total_vendido),
    formatCLP(c.comision_calculada),
    formatCLP(c.sueldo_base_trabajador),
    formatCLP(c.remuneracion_total_estimada),
  ]);

  autoTable(doc, {
    startY: 42,
    head: [['RUT', 'Vendedor', 'Zona', 'Ventas', 'Vendido', 'Comisión', 'Sueldo Base', 'Total']],
    body: body.length > 0 ? body : [['—', 'Sin vendedores Artículo 22', '', '', '', '', '', '']],
    styles: { fontSize: 7.5, cellPadding: 2.3 },
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
  });

  const fileName = `Comisiones_Art22_JSSP_${emision.dateStr}.pdf`;
  return {
    buffer: Buffer.from(doc.output('arraybuffer')),
    fileName,
  };
}
