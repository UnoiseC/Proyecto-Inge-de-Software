import { Fragment, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Mail,
  Plus,
  Search,
  Send,
  UserPlus,
  X,
} from 'lucide-react';
import type {
  ActaMensualAdminResponse,
  EmailDispatchLog,
  JsspSnapshot,
} from '../types/jssp.ts';
import {
  MESES_ES,
  evaluateMarkPunctuality,
  extractChileClockHM,
  summarizeWorkerPunctuality,
} from '../lib/punctuality.ts';

interface AttendanceMonitorViewProps {
  snapshot: JsspSnapshot;
  actaAdmin: ActaMensualAdminResponse;
  mes: number;
  anio: number;
  toleranciaMinutos: number;
  realtimeConnected: boolean;
  realtimeLabel: string;
  onChangePeriodo: (mes: number, anio: number) => void;
  onSignActa: (idActa: string) => Promise<void>;
  onResendEmail: (params: {
    id_marca: number;
    id_trabajador: string;
    nombre_completo: string;
    rut: string;
    email_trabajador: string;
    tipo_marca: 'ENTRADA' | 'SALIDA';
    fecha_hora_local: string;
    sucursal: string;
    metodo_biometrico: string;
    id_acta: string;
  }) => Promise<EmailDispatchLog>;
  onCreateWorker: (payload: {
    id_trabajador: string;
    rut: string;
    nombre_trabajador: string;
    apellido_trabajador: string;
    email_trabajador: string;
    sueldo_base_trabajador: number;
    id_sucursal: number;
    modalidad: 'PRESENCIAL' | 'ART22';
    rol?: string;
    turno_asignado?: string;
    zona_cobertura?: string;
    es_articulo22?: boolean;
  }) => Promise<void>;
  onViewEmail: (log: EmailDispatchLog) => void;
}

export function AttendanceMonitorView({
  snapshot,
  actaAdmin,
  mes,
  anio,
  toleranciaMinutos,
  realtimeConnected,
  realtimeLabel,
  onChangePeriodo,
  onSignActa,
  onResendEmail,
  onCreateWorker,
  onViewEmail,
}: AttendanceMonitorViewProps) {
  const [search, setSearch] = useState('');
  const [sucursalFilter, setSucursalFilter] = useState('TODAS');
  const [statusFilter, setStatusFilter] = useState<'TODOS' | 'PUNTUALES' | 'ATRASO' | 'EN_TURNO'>('TODOS');
  const [expandedWorkers, setExpandedWorkers] = useState<Record<string, boolean>>({});
  const [showNewWorker, setShowNewWorker] = useState(false);
  const [resendingId, setResendingId] = useState<number | null>(null);
  const [signingId, setSigningId] = useState<string | null>(null);

  // New worker form state
  const [nwForm, setNwForm] = useState({
    id_trabajador: '',
    rut: '',
    nombre_trabajador: '',
    apellido_trabajador: '',
    email_trabajador: '',
    sueldo_base_trabajador: 950000,
    id_sucursal: snapshot.sucursales[0]?.id_sucursal || 1,
    modalidad: 'PRESENCIAL' as 'PRESENCIAL' | 'ART22',
    rol: 'Operaciones',
    turno_asignado: '09:00 - 18:00',
    zona_cobertura: 'Región Metropolitana',
  });
  const [nwError, setNwError] = useState<string | null>(null);
  const [nwSaving, setNwSaving] = useState(false);

  const enrichedRows = useMemo(() => {
    return actaAdmin.asistencia_presencial.map((row) => {
      const summary = summarizeWorkerPunctuality(row, toleranciaMinutos);
      const trab = snapshot.trabajadores.find((t) => t.id_trabajador === row.id_trabajador);
      const email = row.email_trabajador || trab?.email_trabajador || '';
      const enTurno = summary.ultimaMarca?.tipo_marca === 'ENTRADA';
      return {
        ...row,
        email_trabajador: email,
        summary,
        enTurno,
      };
    });
  }, [actaAdmin.asistencia_presencial, snapshot.trabajadores, toleranciaMinutos]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enrichedRows.filter((r) => {
      if (sucursalFilter !== 'TODAS' && r.nombre_sucursal !== sucursalFilter) return false;
      if (statusFilter === 'PUNTUALES' && r.summary.entradasConAtraso > 0) return false;
      if (statusFilter === 'ATRASO' && r.summary.entradasConAtraso === 0) return false;
      if (statusFilter === 'EN_TURNO' && !r.enTurno) return false;
      if (q) {
        const hay = `${r.nombre_completo} ${r.rut} ${r.id_trabajador} ${r.rol}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [enrichedRows, sucursalFilter, statusFilter, search]);

  const kpis = useMemo(() => {
    const enTurnoCount = enrichedRows.filter((r) => r.enTurno).length;
    const totalEntradas = enrichedRows.reduce((s, r) => s + r.summary.entradasTotales, 0);
    const totalPuntuales = enrichedRows.reduce((s, r) => s + r.summary.entradasPuntuales, 0);
    const totalAtrasos = enrichedRows.reduce((s, r) => s + r.summary.entradasConAtraso, 0);
    const totalMinAtraso = enrichedRows.reduce((s, r) => s + r.summary.minutosAtrasoTotal, 0);
    const allMarks = enrichedRows.flatMap((r) => r.marcas || []);
    const emailsSent = allMarks.filter((m) => m.respaldo_email).length;
    return {
      enTurnoCount,
      tasaPuntualidad: totalEntradas > 0 ? Math.round((totalPuntuales / totalEntradas) * 100) : 100,
      totalAtrasos,
      totalMinAtraso,
      emailsSent,
      totalMarks: allMarks.length,
    };
  }, [enrichedRows]);

  const recentFeed = useMemo(() => {
    return [...snapshot.marcas]
      .sort((a, b) => new Date(b.fecha_hora).getTime() - new Date(a.fecha_hora).getTime())
      .slice(0, 8)
      .map((m) => {
        const t = snapshot.trabajadores.find((w) => w.id_trabajador === m.id_trabajador_presencial);
        const p = snapshot.presenciales.find((pr) => pr.id_trabajador === m.id_trabajador_presencial);
        const emailLog = snapshot.emailLogs?.find((l) => l.id_marca === m.id_marca);
        return {
          ...m,
          nombre: t ? `${t.nombre_trabajador} ${t.apellido_trabajador}` : m.id_trabajador_presencial,
          turno: p?.turno_asignado,
          emailLog,
        };
      });
  }, [snapshot.marcas, snapshot.trabajadores, snapshot.presenciales, snapshot.emailLogs]);

  const handleToggleExpand = (id: string) => {
    setExpandedWorkers((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCreateWorkerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNwError(null);
    setNwSaving(true);
    try {
      await onCreateWorker(nwForm);
      setShowNewWorker(false);
      setNwForm({
        ...nwForm,
        id_trabajador: '',
        rut: '',
        nombre_trabajador: '',
        apellido_trabajador: '',
        email_trabajador: '',
      });
    } catch (err) {
      setNwError(err instanceof Error ? err.message : 'Error al registrar trabajador');
    } finally {
      setNwSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top 4-KPI summary bar */}
      <div className="bg-white border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <div className="p-5">
          <div className="text-xs text-slate-500">Personal en Turno Ahora</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-2xl font-semibold font-mono tabular-nums text-slate-900">
              {kpis.enTurnoCount}
            </span>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              / {enrichedRows.length} presenciales
            </span>
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs text-slate-500">Puntualidad del Período</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-2xl font-semibold font-mono tabular-nums text-emerald-700">
              {kpis.tasaPuntualidad}%
            </span>
            <span className="text-xs text-slate-500">
              tolerancia {toleranciaMinutos} min
            </span>
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs text-slate-500">Atrasos Acumulados</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-2xl font-semibold font-mono tabular-nums text-amber-700">
              {kpis.totalAtrasos}
            </span>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              {kpis.totalMinAtraso} min totales
            </span>
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs text-slate-500">Respaldos Email Enviados</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-2xl font-semibold font-mono tabular-nums text-slate-900">
              {kpis.emailsSent}/{kpis.totalMarks}
            </span>
            <span className="text-xs text-slate-500 flex items-center gap-1.5">
              {realtimeConnected ? (
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              ) : null}
              {realtimeLabel}
            </span>
          </div>
        </div>
      </div>

      {/* Filters & Toolbar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Seleccionar mes"
            value={mes}
            onChange={(e) => onChangePeriodo(Number(e.target.value), anio)}
            className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            {MESES_ES.map((m, idx) => (
              <option key={m} value={idx + 1}>
                {m}
              </option>
            ))}
          </select>

          <select
            aria-label="Seleccionar año"
            value={anio}
            onChange={(e) => onChangePeriodo(mes, Number(e.target.value))}
            className="px-3 py-1.5 text-xs font-medium font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            {[2025, 2026, 2027].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>

          <select
            aria-label="Filtrar por sucursal"
            value={sucursalFilter}
            onChange={(e) => setSucursalFilter(e.target.value)}
            className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="TODAS">Todas las sucursales</option>
            {snapshot.sucursales.map((s) => (
              <option key={s.id_sucursal} value={s.nombre_sucursal}>
                {s.nombre_sucursal}
              </option>
            ))}
          </select>

          <div className="inline-flex items-center p-1 bg-slate-100 rounded-md">
            {(
              [
                { id: 'TODOS', label: 'Todos' },
                { id: 'PUNTUALES', label: 'Puntuales' },
                { id: 'ATRASO', label: 'Con Atraso' },
                { id: 'EN_TURNO', label: 'En Turno' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  statusFilter === f.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-60">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar RUT o nombre..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <button
            type="button"
            onClick={() => setShowNewWorker(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Nuevo Trabajador
          </button>
        </div>
      </div>

      {/* Main grid: Actas table + Real-time activity log */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-8 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Consolidado de Actas Mensuales de Asistencia
              </h3>
              <p className="text-xs text-slate-500">
                Haga clic en un trabajador para inspeccionar sus marcaciones y respaldos de correo
              </p>
            </div>
            <span className="text-xs font-mono text-slate-500">
              {MESES_ES[mes - 1]} {anio}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="py-2.5 pl-4 pr-2 w-8"></th>
                  <th className="py-2.5 px-3">Trabajador</th>
                  <th className="py-2.5 px-3">Sucursal / Turno</th>
                  <th className="py-2.5 px-3 text-right">Días</th>
                  <th className="py-2.5 px-3 text-right">Puntualidad</th>
                  <th className="py-2.5 px-3 text-right">Atrasos</th>
                  <th className="py-2.5 px-4 text-right">Acta Mensual</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-xs text-slate-500">
                      No hay trabajadores presenciales que coincidan con el filtro aplicado.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    const expanded = !!expandedWorkers[row.id_trabajador];
                    return (
                      <Fragment key={row.id_trabajador}>
                        <tr
                          onClick={() => handleToggleExpand(row.id_trabajador)}
                          className="hover:bg-slate-50 cursor-pointer transition-colors"
                        >
                          <td className="py-3 pl-4 pr-2 text-slate-400">
                            {expanded ? (
                              <ChevronDown className="w-4 h-4" />
                            ) : (
                              <ChevronRight className="w-4 h-4" />
                            )}
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-medium text-slate-900">{row.nombre_completo}</div>
                            <div className="text-xs text-slate-500 font-mono">
                              {row.rut} · {row.rol}
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <div className="text-xs text-slate-800">{row.nombre_sucursal}</div>
                            <div className="text-xs text-slate-500 font-mono">
                              {row.turno_asignado}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-900">
                            {row.total_dias_trabajados}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums">
                            <span
                              className={
                                row.summary.tasaPuntualidad >= 90
                                  ? 'text-emerald-700 font-semibold'
                                  : row.summary.tasaPuntualidad >= 70
                                    ? 'text-amber-700 font-semibold'
                                    : 'text-rose-700 font-semibold'
                              }
                            >
                              {row.summary.tasaPuntualidad}%
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-xs text-slate-700">
                            {row.summary.entradasConAtraso > 0 ? (
                              <span className="text-amber-700 font-medium">
                                {row.summary.entradasConAtraso} ({row.summary.minutosAtrasoTotal}m)
                              </span>
                            ) : (
                              <span className="text-slate-400">0</span>
                            )}
                          </td>
                          <td
                            className="py-3 px-4 text-right"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {row.estado_firma === 'FIRMADA' ? (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Firmada
                              </span>
                            ) : row.id_acta !== 'SIN_ACTA' ? (
                              <button
                                type="button"
                                disabled={signingId === row.id_acta}
                                onClick={async () => {
                                  setSigningId(row.id_acta);
                                  try {
                                    await onSignActa(row.id_acta);
                                  } finally {
                                    setSigningId(null);
                                  }
                                }}
                                className="px-2.5 py-1 text-xs font-medium border border-slate-300 text-slate-700 rounded hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap"
                              >
                                {signingId === row.id_acta ? 'Firmando...' : 'Firmar Acta'}
                              </button>
                            ) : (
                              <span className="text-xs text-slate-400">Sin marcas</span>
                            )}
                          </td>
                        </tr>

                        {expanded && (
                          <tr className="bg-slate-50/70">
                            <td colSpan={7} className="px-6 py-4">
                              <div className="flex items-center justify-between mb-3 text-xs text-slate-600">
                                <span>
                                  Folio Acta: <strong className="font-mono">{row.id_acta}</strong> · Email:{' '}
                                  {row.email_trabajador}
                                </span>
                                <span>{(row.marcas || []).length} registros en el mes</span>
                              </div>

                              {(row.marcas || []).length === 0 ? (
                                <p className="text-xs text-slate-500">
                                  No existen marcaciones registradas para este período.
                                </p>
                              ) : (
                                <table className="w-full text-xs border border-slate-200 bg-white">
                                  <thead>
                                    <tr className="border-b border-slate-200 text-slate-500 bg-slate-50">
                                      <th className="py-2 px-3 text-left">Fecha</th>
                                      <th className="py-2 px-3 text-left">Hora Chile</th>
                                      <th className="py-2 px-3 text-left">Tipo</th>
                                      <th className="py-2 px-3 text-left">Método</th>
                                      <th className="py-2 px-3 text-left">Puntualidad</th>
                                      <th className="py-2 px-3 text-right">Respaldo Email</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-200">
                                    {row.marcas.map((m) => {
                                      const clock = extractChileClockHM(m.fecha_hora_local);
                                      const evalRes = evaluateMarkPunctuality(
                                        m.fecha_hora_local,
                                        m.tipo_marca,
                                        row.turno_asignado,
                                        toleranciaMinutos
                                      );
                                      const log = snapshot.emailLogs?.find(
                                        (l) => l.id_marca === m.id_marca
                                      );
                                      return (
                                        <tr key={m.id_marca}>
                                          <td className="py-2 px-3 font-mono tabular-nums">
                                            {clock.displayDate}
                                          </td>
                                          <td className="py-2 px-3 font-mono tabular-nums font-medium">
                                            {clock.displayTime}
                                          </td>
                                          <td
                                            className={`py-2 px-3 font-medium ${
                                              m.tipo_marca === 'ENTRADA'
                                                ? 'text-emerald-700'
                                                : 'text-rose-700'
                                            }`}
                                          >
                                            {m.tipo_marca}
                                          </td>
                                          <td className="py-2 px-3 font-mono text-slate-600">
                                            {m.metodo_biometrico}
                                          </td>
                                          <td
                                            className={`py-2 px-3 ${
                                              evalRes.estado === 'ATRASO' ||
                                              evalRes.estado === 'SALIDA_ANTICIPADA'
                                                ? 'text-amber-700 font-medium'
                                                : 'text-slate-700'
                                            }`}
                                          >
                                            {evalRes.etiqueta}
                                          </td>
                                          <td className="py-2 px-3 text-right">
                                            <div className="inline-flex items-center gap-2">
                                              <span
                                                className={
                                                  m.respaldo_email
                                                    ? 'text-emerald-700'
                                                    : 'text-amber-700'
                                                }
                                              >
                                                {m.respaldo_email ? 'Enviado' : 'Pendiente'}
                                              </span>
                                              {log ? (
                                                <button
                                                  type="button"
                                                  onClick={() => onViewEmail(log)}
                                                  className="text-blue-700 hover:underline inline-flex items-center gap-1"
                                                >
                                                  <Mail className="w-3 h-3" />
                                                  Ver
                                                </button>
                                              ) : (
                                                <button
                                                  type="button"
                                                  disabled={resendingId === m.id_marca}
                                                  onClick={async () => {
                                                    setResendingId(m.id_marca);
                                                    try {
                                                      const sentLog = await onResendEmail({
                                                        id_marca: m.id_marca,
                                                        id_trabajador: row.id_trabajador,
                                                        nombre_completo: row.nombre_completo,
                                                        rut: row.rut,
                                                        email_trabajador: row.email_trabajador,
                                                        tipo_marca: m.tipo_marca,
                                                        fecha_hora_local: `${clock.displayDate} ${clock.displayTime}`,
                                                        sucursal: row.nombre_sucursal,
                                                        metodo_biometrico: m.metodo_biometrico,
                                                        id_acta: row.id_acta,
                                                      });
                                                      onViewEmail(sentLog);
                                                    } finally {
                                                      setResendingId(null);
                                                    }
                                                  }}
                                                  className="text-blue-700 hover:underline inline-flex items-center gap-1 disabled:opacity-50"
                                                >
                                                  <Send className="w-3 h-3" />
                                                  {resendingId === m.id_marca ? 'Enviando...' : 'Enviar'}
                                                </button>
                                              )}
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Real-time live feed */}
        <aside className="xl:col-span-4 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h3 className="text-base font-semibold text-slate-900">
              Últimas Marcaciones Sincronizadas
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Flujo en tiempo real de entradas y salidas
            </p>
          </div>
          <div className="divide-y divide-slate-200">
            {recentFeed.map((item) => {
              const clock = extractChileClockHM(item.fecha_hora);
              const evalRes = evaluateMarkPunctuality(
                item.fecha_hora,
                item.tipo_marca,
                item.turno,
                toleranciaMinutos
              );
              return (
                <div key={item.id_marca} className="px-5 py-3.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 truncate">
                      {item.nombre}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      <span
                        className={
                          item.tipo_marca === 'ENTRADA'
                            ? 'text-emerald-700 font-semibold'
                            : 'text-rose-700 font-semibold'
                        }
                      >
                        {item.tipo_marca}
                      </span>{' '}
                      · {item.metodo_biometrico} · {evalRes.etiqueta}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-mono tabular-nums font-medium text-slate-900">
                      {clock.displayTime}
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-slate-400">
                      {clock.displayDate}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      </div>

      {/* New worker modal */}
      {showNewWorker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Registrar nuevo trabajador"
        >
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-lg overflow-hidden shadow-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-900">
                Registrar Trabajador en Esquema JSSP
              </h3>
              <button
                type="button"
                onClick={() => setShowNewWorker(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateWorkerSubmit} className="p-6 space-y-4">
              {nwError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded text-xs text-rose-800">
                  {nwError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    ID Trabajador
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="TRAB-006"
                    value={nwForm.id_trabajador}
                    onChange={(e) => setNwForm({ ...nwForm, id_trabajador: e.target.value })}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">RUT</label>
                  <input
                    type="text"
                    required
                    placeholder="17.543.210-K"
                    value={nwForm.rut}
                    onChange={(e) => setNwForm({ ...nwForm, rut: e.target.value })}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Nombre</label>
                  <input
                    type="text"
                    required
                    value={nwForm.nombre_trabajador}
                    onChange={(e) => setNwForm({ ...nwForm, nombre_trabajador: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Apellido</label>
                  <input
                    type="text"
                    required
                    value={nwForm.apellido_trabajador}
                    onChange={(e) => setNwForm({ ...nwForm, apellido_trabajador: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Correo Electrónico
                  </label>
                  <input
                    type="email"
                    required
                    value={nwForm.email_trabajador}
                    onChange={(e) => setNwForm({ ...nwForm, email_trabajador: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Sueldo Base (CLP)
                  </label>
                  <input
                    type="number"
                    required
                    min={100000}
                    value={nwForm.sueldo_base_trabajador}
                    onChange={(e) =>
                      setNwForm({ ...nwForm, sueldo_base_trabajador: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Sucursal</label>
                  <select
                    value={nwForm.id_sucursal}
                    onChange={(e) => setNwForm({ ...nwForm, id_sucursal: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                  >
                    {snapshot.sucursales.map((s) => (
                      <option key={s.id_sucursal} value={s.id_sucursal}>
                        {s.nombre_sucursal}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tipo de Contrato
                  </label>
                  <select
                    value={nwForm.modalidad}
                    onChange={(e) =>
                      setNwForm({
                        ...nwForm,
                        modalidad: e.target.value as 'PRESENCIAL' | 'ART22',
                      })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                  >
                    <option value="PRESENCIAL">Presencial (Marcación QR)</option>
                    <option value="ART22">Vendedor Terreno (Art. 22 CT)</option>
                  </select>
                </div>
              </div>

              {nwForm.modalidad === 'PRESENCIAL' ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Rol</label>
                    <input
                      type="text"
                      value={nwForm.rol}
                      onChange={(e) => setNwForm({ ...nwForm, rol: e.target.value })}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Turno Asignado
                    </label>
                    <input
                      type="text"
                      placeholder="09:00 - 18:00"
                      value={nwForm.turno_asignado}
                      onChange={(e) => setNwForm({ ...nwForm, turno_asignado: e.target.value })}
                      className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Zona de Cobertura (Art. 22 Código del Trabajo)
                  </label>
                  <input
                    type="text"
                    value={nwForm.zona_cobertura}
                    onChange={(e) => setNwForm({ ...nwForm, zona_cobertura: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                  />
                </div>
              )}

              <div className="pt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowNewWorker(false)}
                  className="px-4 py-2 text-xs font-medium border border-slate-300 rounded-md text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={nwSaving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-md hover:bg-slate-800 disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {nwSaving ? 'Guardando...' : 'Guardar Trabajador'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
