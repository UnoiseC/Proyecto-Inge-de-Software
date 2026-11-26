import type { AsistenciaPresencialRow, TipoMarca } from '../types/database.ts';

export const CHILE_TZ = 'America/Santiago';

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

export function formatCLP(value: number): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(Math.round(value || 0));
}

export function getChileDateParts(date: Date = new Date()): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
  dateStr: string;
  hhmm: string;
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
  const hourStr = map.hour === '24' ? '00' : map.hour;
  const dateStr = `${map.year}-${map.month}-${map.day}`;
  const timeStr = `${hourStr}:${map.minute}:${map.second}`;

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(hourStr),
    minute: Number(map.minute),
    weekday: new Date(`${dateStr}T12:00:00Z`).getUTCDay(),
    dateStr,
    hhmm: `${hourStr}:${map.minute}`,
    localTimestamp: `${dateStr}T${timeStr}`,
    displayStr: `${map.day}/${map.month}/${map.year} ${timeStr}`,
  };
}

export function extractChileClock(value: string): {
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
      hour: Number(hh),
      minute: Number(mm),
      displayDate: `${d}/${m}/${y}`,
      displayTime: `${hh}:${mm}:${ss.slice(0, 2)}`,
    };
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return { hour: 0, minute: 0, displayDate: trimmed, displayTime: '--:--' };
  }
  const p = getChileDateParts(parsed);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    hour: p.hour,
    minute: p.minute,
    displayDate: `${pad(p.day)}/${pad(p.month)}/${p.year}`,
    displayTime: `${pad(p.hour)}:${pad(p.minute)}:${p.localTimestamp.slice(-2)}`,
  };
}

export function parseTurnoRange(turno: string | null | undefined): {
  startMinutes: number;
  endMinutes: number;
} | null {
  if (!turno) return null;
  const matches = turno.match(/(\d{1,2}):(\d{2})/g);
  if (!matches || matches.length === 0) return null;
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  return {
    startMinutes: toMin(matches[0]),
    endMinutes: toMin(matches[1] || '18:00'),
  };
}

export function evaluateMarkPunctuality(
  fechaHora: string,
  tipoMarca: TipoMarca,
  turnoAsignado: string | null | undefined,
  toleranciaMinutos = 5
): { estado: string; minutosDiferencia: number; etiqueta: string } {
  const range = parseTurnoRange(turnoAsignado);
  if (!range) {
    return { estado: 'SIN_TURNO', minutosDiferencia: 0, etiqueta: 'Sin turno definido' };
  }
  const clock = extractChileClock(fechaHora);
  const markMin = clock.hour * 60 + clock.minute;

  if (tipoMarca === 'ENTRADA') {
    const diff = markMin - range.startMinutes;
    if (diff > toleranciaMinutos) {
      return { estado: 'ATRASO', minutosDiferencia: diff, etiqueta: `Atraso +${diff} min` };
    }
    return {
      estado: 'PUNTUAL',
      minutosDiferencia: Math.max(0, diff),
      etiqueta: diff <= 0 ? `Puntual (${Math.abs(diff)}m antes)` : `Puntual (+${diff}m tol.)`,
    };
  }

  const diffOut = range.endMinutes - markMin;
  if (diffOut > toleranciaMinutos) {
    return {
      estado: 'SALIDA_ANTICIPADA',
      minutosDiferencia: diffOut,
      etiqueta: `Salida anticipada (-${diffOut} min)`,
    };
  }
  return { estado: 'NORMAL', minutosDiferencia: 0, etiqueta: 'Salida conforme' };
}

export function summarizeWorkerPunctuality(
  row: AsistenciaPresencialRow,
  toleranciaMinutos = 5
) {
  const entradas = (row.marcas || []).filter((m) => m.tipo_marca === 'ENTRADA');
  let puntuales = 0;
  let atrasos = 0;
  let minAtraso = 0;

  for (const m of entradas) {
    const res = evaluateMarkPunctuality(
      m.fecha_hora_local,
      'ENTRADA',
      row.turno_asignado,
      toleranciaMinutos
    );
    if (res.estado === 'ATRASO') {
      atrasos += 1;
      minAtraso += res.minutosDiferencia;
    } else {
      puntuales += 1;
    }
  }

  const total = entradas.length;
  return {
    entradasTotales: total,
    entradasPuntuales: puntuales,
    entradasConAtraso: atrasos,
    minutosAtrasoTotal: minAtraso,
    tasaPuntualidad: total > 0 ? Math.round((puntuales / total) * 100) : 100,
  };
}
