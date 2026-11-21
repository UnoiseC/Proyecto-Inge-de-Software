import type {
  ActaMarcaItem,
  AsistenciaPresencialRow,
  PunctualityAssessment,
} from '../types/jssp.ts';

export const CHILE_TIMEZONE = 'America/Santiago';

export function formatCLP(value: number): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(Math.round(value || 0));
}

export function getChileNowParts(dateInput: Date | string = new Date()): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  dateStr: string;
  timeStr: string;
  fullLocalStr: string;
} {
  const date = typeof dateInput === 'string' ? parseLocalOrIsoDate(dateInput) : dateInput;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CHILE_TIMEZONE,
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
  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  const hour = Number(map.hour === '24' ? '0' : map.hour);
  const minute = Number(map.minute);
  const second = Number(map.second);

  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${year}-${pad(month)}-${pad(day)}`;
  const timeStr = `${pad(hour)}:${pad(minute)}:${pad(second)}`;

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    dateStr,
    timeStr,
    fullLocalStr: `${pad(day)}/${pad(month)}/${year} ${pad(hour)}:${pad(minute)}:${pad(second)}`,
  };
}

/**
 * Handles both timestamptz ISO strings (with Z or offset) and Postgres
 * `timestamp without time zone` returned by `AT TIME ZONE 'America/Santiago'`.
 */
export function parseLocalOrIsoDate(value: string): Date {
  if (!value) return new Date();
  const hasTz = /[Zz]|[+-]\d{2}:?\d{2}$/.test(value.trim());
  if (hasTz) {
    return new Date(value);
  }
  // Treat naive timestamp returned by AT TIME ZONE 'America/Santiago' directly by extracting HH:mm
  const normalized = value.replace(' ', 'T');
  return new Date(`${normalized}-03:00`);
}

export function extractChileClockHM(value: string): {
  dateKey: string;
  hour: number;
  minute: number;
  displayDate: string;
  displayTime: string;
} {
  const trimmed = (value || '').trim();
  const hasTz = /[Zz]|[+-]\d{2}:?\d{2}$/.test(trimmed);

  if (!hasTz && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(trimmed)) {
    const [datePart, timePart] = trimmed.split(/[T ]/);
    const [y, m, d] = datePart.split('-');
    const [hh, mm, ss = '00'] = timePart.split(':');
    return {
      dateKey: datePart,
      hour: Number(hh),
      minute: Number(mm),
      displayDate: `${d}/${m}/${y}`,
      displayTime: `${hh}:${mm}:${ss.slice(0, 2)}`,
    };
  }

  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) {
    return {
      dateKey: '',
      hour: 0,
      minute: 0,
      displayDate: trimmed,
      displayTime: '--:--',
    };
  }
  const p = getChileNowParts(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    dateKey: p.dateStr,
    hour: p.hour,
    minute: p.minute,
    displayDate: `${pad(p.day)}/${pad(p.month)}/${p.year}`,
    displayTime: p.timeStr,
  };
}

export function parseTurnoRange(turno: string | null | undefined): {
  startMinutes: number;
  endMinutes: number;
  startStr: string;
  endStr: string;
} | null {
  if (!turno) return null;
  const matches = turno.match(/(\d{1,2}):(\d{2})/g);
  if (!matches || matches.length < 1) return null;
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  const startStr = matches[0].padStart(5, '0');
  const endStr = (matches[1] || '18:00').padStart(5, '0');
  return {
    startMinutes: toMin(matches[0]),
    endMinutes: toMin(matches[1] || '18:00'),
    startStr,
    endStr,
  };
}

export function evaluateMarkPunctuality(
  fechaHora: string,
  tipoMarca: 'ENTRADA' | 'SALIDA',
  turnoAsignado: string | null | undefined,
  toleranciaMinutos = 5
): PunctualityAssessment {
  const range = parseTurnoRange(turnoAsignado);
  if (!range) {
    return {
      estado: 'SIN_TURNO',
      minutosDiferencia: 0,
      horaTurnoEsperada: null,
      etiqueta: 'Sin turno definido',
    };
  }

  const clock = extractChileClockHM(fechaHora);
  const markMinutes = clock.hour * 60 + clock.minute;

  if (tipoMarca === 'ENTRADA') {
    const diff = markMinutes - range.startMinutes;
    if (diff > toleranciaMinutos) {
      return {
        estado: 'ATRASO',
        minutosDiferencia: diff,
        horaTurnoEsperada: range.startStr,
        etiqueta: `Atraso +${diff} min`,
      };
    }
    return {
      estado: 'PUNTUAL',
      minutosDiferencia: Math.max(0, diff),
      horaTurnoEsperada: range.startStr,
      etiqueta: diff <= 0 ? `Puntual (${Math.abs(diff)} min antes)` : `Puntual (+${diff} min tol.)`,
    };
  }

  const diffSalida = range.endMinutes - markMinutes;
  if (diffSalida > toleranciaMinutos) {
    return {
      estado: 'SALIDA_ANTICIPADA',
      minutosDiferencia: diffSalida,
      horaTurnoEsperada: range.endStr,
      etiqueta: `Salida anticipada (-${diffSalida} min)`,
    };
  }
  return {
    estado: 'NORMAL',
    minutosDiferencia: 0,
    horaTurnoEsperada: range.endStr,
    etiqueta: 'Salida conforme',
  };
}

export interface WorkerPunctualitySummary {
  id_trabajador: string;
  entradasTotales: number;
  entradasPuntuales: number;
  entradasConAtraso: number;
  minutosAtrasoTotal: number;
  tasaPuntualidad: number;
  ultimaMarca: ActaMarcaItem | null;
}

export function summarizeWorkerPunctuality(
  row: AsistenciaPresencialRow,
  toleranciaMinutos = 5
): WorkerPunctualitySummary {
  const entradas = (row.marcas || []).filter((m) => m.tipo_marca === 'ENTRADA');
  let puntuales = 0;
  let atrasos = 0;
  let minAtraso = 0;

  for (const m of entradas) {
    const evalRes = evaluateMarkPunctuality(
      m.fecha_hora_local,
      'ENTRADA',
      row.turno_asignado,
      toleranciaMinutos
    );
    if (evalRes.estado === 'ATRASO') {
      atrasos += 1;
      minAtraso += evalRes.minutosDiferencia;
    } else {
      puntuales += 1;
    }
  }

  const total = entradas.length;
  const tasa = total > 0 ? Math.round((puntuales / total) * 100) : 100;
  const sorted = [...(row.marcas || [])].sort(
    (a, b) =>
      parseLocalOrIsoDate(b.fecha_hora_local).getTime() -
      parseLocalOrIsoDate(a.fecha_hora_local).getTime()
  );

  return {
    id_trabajador: row.id_trabajador,
    entradasTotales: total,
    entradasPuntuales: puntuales,
    entradasConAtraso: atrasos,
    minutosAtrasoTotal: minAtraso,
    tasaPuntualidad: tasa,
    ultimaMarca: sorted[0] ?? null,
  };
}

export const MESES_ES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

export function buildWorkerQrPayload(idTrabajador: string, rut: string): string {
  return JSON.stringify({
    sistema: 'JSSP',
    id: idTrabajador,
    rut,
  });
}

export function parseWorkerQrPayload(raw: string): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { id?: string; id_trabajador?: string };
      return (parsed.id || parsed.id_trabajador || '').trim() || null;
    } catch {
      return null;
    }
  }
  return trimmed;
}
