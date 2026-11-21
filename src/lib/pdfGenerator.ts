import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type {
  ActaMensualAdminResponse,
  AsistenciaPresencialRow,
  MetaVentaConsolidada,
} from '../types/jssp.ts';
import {
  MESES_ES,
  evaluateMarkPunctuality,
  extractChileClockHM,
  formatCLP,
  getChileNowParts,
  summarizeWorkerPunctuality,
} from './punctuality.ts';

export interface GeneratedPdfResult {
  fileName: string;
  blobUrl: string;
  stats: {
    trabajadoresPresenciales: number;
    totalMarcas: number;
    tasaPuntualidadGlobal: number;
    totalAtrasos: number;
    minutosAtrasoGlobal: number;
  };
}

export function generatePunctualityPdf(
  acta: ActaMensualAdminResponse,
  options: {
    toleranciaMinutos?: number;
    sucursalFiltro?: string;
    download?: boolean;
  } = {}
): GeneratedPdfResult {
  const tolerancia = options.toleranciaMinutos ?? 5;
  const sucursalFiltro = options.sucursalFiltro || 'TODAS';
  const rows: AsistenciaPresencialRow[] =
    sucursalFiltro === 'TODAS'
      ? acta.asistencia_presencial
      : acta.asistencia_presencial.filter((r) => r.nombre_sucursal === sucursalFiltro);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const mesLabel = MESES_ES[(acta.periodo.mes || 1) - 1] || String(acta.periodo.mes);
  const emision = getChileNowParts(new Date());

  // Header band
  doc.setFillColor(15, 23, 42); // Slate 900
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
  doc.text(`Emitido (America/Santiago): ${emision.fullLocalStr}`, 14, 28);

  // Aggregate KPIs
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

  // KPI strip
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

  // Table 1: Resumen por trabajador
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('1. Consolidado de Puntualidad por Trabajador (Actas Mensuales)', 14, 70);

  autoTable(doc, {
    startY: 74,
    head: [
      [
        'RUT',
        'Trabajador',
        'Sucursal',
        'Turno',
        'Días',
        'Punt.',
        'Atrasos',
        'Demora',
        '% Punt.',
        'Acta',
      ],
    ],
    body: summaryBody.length > 0 ? summaryBody : [['—', 'Sin registros en este período', '', '', '', '', '', '', '', '']],
    styles: { fontSize: 7.5, cellPadding: 2.2, textColor: [30, 41, 59] },
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'right' },
      8: { halign: 'right' },
    },
  });

  // Table 2: Detalle cronológico de marcaciones
  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 120;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('2. Registro Cronológico de Marcaciones e Incidencias', 14, finalY + 10);

  const detailBody: string[][] = [];
  for (const row of rows) {
    for (const m of row.marcas || []) {
      const clock = extractChileClockHM(m.fecha_hora_local);
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
    body: detailBody.length > 0 ? detailBody : [['—', '—', 'Sin marcaciones registradas', '—', '—', '—', '—']],
    styles: { fontSize: 7.5, cellPadding: 2, textColor: [30, 41, 59] },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  const fileName = `Reporte_Puntualidad_JSSP_${acta.periodo.anio}_${String(acta.periodo.mes).padStart(2, '0')}.pdf`;
  if (options.download !== false) {
    doc.save(fileName);
  }
  const blobUrl = doc.output('bloburl') as unknown as string;

  return {
    fileName,
    blobUrl,
    stats: {
      trabajadoresPresenciales: rows.length,
      totalMarcas,
      tasaPuntualidadGlobal: tasaGlobal,
      totalAtrasos,
      minutosAtrasoGlobal,
    },
  };
}

export function generateCommissionsArt22Pdf(
  metas: MetaVentaConsolidada[],
  periodoLabel: string,
  download = true
): string {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const emision = getChileNowParts(new Date());

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 210, 32, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Liquidación de Metas y Comisiones — Art. 22', 14, 15);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(203, 213, 225);
  doc.text(`Período: ${periodoLabel}  |  Emitido: ${emision.fullLocalStr}`, 14, 23);

  const metaRows = metas.map((m) => [
    `#${m.id_meta}`,
    `${m.fecha_inicio} / ${m.fecha_fin || 'Abierta'}`,
    formatCLP(m.monto_objetivo),
    formatCLP(m.monto_actual),
    `${m.porcentaje_cumplimiento}%`,
    m.estado,
  ]);

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('1. Cumplimiento de Metas Comerciales', 14, 42);

  autoTable(doc, {
    startY: 46,
    head: [['Meta', 'Vigencia', 'Objetivo', 'Vendido Actual', '% Cumpl.', 'Estado']],
    body: metaRows.length > 0 ? metaRows : [['—', 'Sin metas activas', '', '', '', '']],
    styles: { fontSize: 8, cellPadding: 2.5 },
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 90;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('2. Desglose de Comisiones por Vendedor Artículo 22', 14, finalY + 10);

  const sellerRows: string[][] = [];
  for (const m of metas) {
    for (const v of m.detalle_vendedores || []) {
      sellerRows.push([
        `#${m.id_meta}`,
        v.vendedor,
        v.zona_cobertura || '—',
        v.es_articulo22 ? 'Art. 22 CT' : 'Con Jornada',
        String(v.cantidad_ventas),
        formatCLP(v.total_vendido_meta),
        formatCLP(v.comision_estimada),
      ]);
    }
  }

  autoTable(doc, {
    startY: finalY + 14,
    head: [['Meta', 'Vendedor', 'Zona', 'Contrato', 'Ventas', 'Total Vendido', 'Comisión Calc.']],
    body: sellerRows.length > 0 ? sellerRows : [['—', 'Sin ventas imputadas en metas', '', '', '', '', '']],
    styles: { fontSize: 8, cellPadding: 2.3 },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255] },
    columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
  });

  const fileName = `Comisiones_Art22_JSSP_${periodoLabel.replace(/\s+/g, '_')}.pdf`;
  if (download) doc.save(fileName);
  return fileName;
}
