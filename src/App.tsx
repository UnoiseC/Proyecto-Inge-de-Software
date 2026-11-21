import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { Database } from 'lucide-react';
import type {
  ActaMensualAdminResponse,
  EmailDispatchLog,
  JsspSnapshot,
  RegistrarMarcaResult,
  ReportAutomationSchedule,
  TipoMarca,
} from './types/jssp.ts';
import { MESES_ES, extractChileClockHM, getChileNowParts } from './lib/punctuality.ts';
import {
  buildSupabaseClient,
  crearMetaSupabase,
  crearProductoSupabase,
  crearTrabajadorSupabase,
  fetchSupabaseActaAdmin,
  fetchSupabaseSnapshot,
  firmarActaSupabase,
  marcarRespaldoEmailSupabase,
  registrarMarcaSupabase,
  registrarVentaSupabase,
  subscribeSupabaseRealtime,
} from './lib/supabaseClient.ts';
import { QrTerminalView } from './components/QrTerminalView.tsx';
import { AttendanceMonitorView } from './components/AttendanceMonitorView.tsx';
import { PdfReportsView } from './components/PdfReportsView.tsx';
import { Art22SalesView } from './components/Art22SalesView.tsx';
import { SupabaseDrawer } from './components/SupabaseDrawer.tsx';
import { EmailPreviewModal } from './components/EmailPreviewModal.tsx';

type ActiveTab = 'terminal' | 'asistencia' | 'reportes' | 'ventas';

const TAB_TITLES: Record<ActiveTab, { title: string; subtitle: string }> = {
  terminal: {
    title: 'Terminal de Marcación QR',
    subtitle:
      'Registro biométrico de entrada y salida para personal presencial con respaldo inmediato por correo electrónico',
  },
  asistencia: {
    title: 'Control de Asistencia y Puntualidad en Tiempo Real',
    subtitle:
      'Consolidado de actas mensuales, control de atrasos por turno y verificación de respaldos enviados',
  },
  reportes: {
    title: 'Reportes Automáticos de Puntualidad en PDF',
    subtitle:
      'Generación ejecutiva para auditoría laboral y programación de envíos automáticos al administrador',
  },
  ventas: {
    title: 'Metas de Venta y Comisiones Artículo 22',
    subtitle:
      'Seguimiento comercial de vendedores exentos de jornada y cálculo automático de comisiones por producto',
  },
};

export default function App() {
  const initialNow = getChileNowParts(new Date());
  const [activeTab, setActiveTab] = useState<ActiveTab>('terminal');
  const [mes, setMes] = useState<number>(initialNow.month);
  const [anio, setAnio] = useState<number>(initialNow.year);

  const [snapshot, setSnapshot] = useState<JsspSnapshot | null>(null);
  const [actaAdmin, setActaAdmin] = useState<ActaMensualAdminResponse | null>(null);
  const [schedule, setSchedule] = useState<ReportAutomationSchedule>({
    activo: true,
    frecuencia: 'DIARIO',
    horaEjecucion: '18:30',
    emailAdmin: 'rrhh-admin@empresa-jssp.cl',
    toleranciaMinutos: 5,
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Supabase Realtime state
  const [sbDrawerOpen, setSbDrawerOpen] = useState(false);
  const [sbUrl, setSbUrl] = useState<string>(import.meta.env.VITE_SUPABASE_URL || '');
  const [sbKey, setSbKey] = useState<string>(import.meta.env.VITE_SUPABASE_ANON_KEY || '');
  const [sbConnected, setSbConnected] = useState(false);
  const [sbRealtimeStatus, setSbRealtimeStatus] = useState('DESCONECTADO');
  const [sbError, setSbError] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  const [previewEmailLog, setPreviewEmailLog] = useState<EmailDispatchLog | null>(null);

  const sbClientRef = useRef<SupabaseClient | null>(null);
  const sbChannelRef = useRef<RealtimeChannel | null>(null);

  const loadLocalData = useCallback(async (targetMes: number, targetAnio: number) => {
    const [snapRes, actaRes] = await Promise.all([
      fetch('/api/snapshot'),
      fetch(`/api/acta-admin?mes=${targetMes}&anio=${targetAnio}`),
    ]);
    if (!snapRes.ok || !actaRes.ok) {
      throw new Error('No se pudo cargar el estado operativo del servidor.');
    }
    const snapJson = (await snapRes.json()) as JsspSnapshot & {
      schedule?: ReportAutomationSchedule;
    };
    const actaJson = (await actaRes.json()) as ActaMensualAdminResponse;
    setSnapshot(snapJson);
    setActaAdmin(actaJson);
    if (snapJson.schedule) setSchedule(snapJson.schedule);
    setLastSyncAt(new Date().toISOString());
  }, []);

  const loadSupabaseData = useCallback(
    async (client: SupabaseClient, targetMes: number, targetAnio: number) => {
      const [snap, acta] = await Promise.all([
        fetchSupabaseSnapshot(client),
        fetchSupabaseActaAdmin(client, targetMes, targetAnio),
      ]);
      setSnapshot((prev) => ({
        ...snap,
        emailLogs: prev?.emailLogs || [],
      }));
      setActaAdmin(acta);
      setLastSyncAt(new Date().toISOString());
    },
    []
  );

  const refreshActiveSource = useCallback(
    async (targetMes = mes, targetAnio = anio) => {
      if (sbConnected && sbClientRef.current) {
        await loadSupabaseData(sbClientRef.current, targetMes, targetAnio);
      } else {
        await loadLocalData(targetMes, targetAnio);
      }
    },
    [sbConnected, mes, anio, loadSupabaseData, loadLocalData]
  );

  // Initial load + SSE listener for local realtime mode
  useEffect(() => {
    let active = true;
    async function init() {
      setLoading(true);
      setLoadError(null);
      try {
        if (sbUrl && sbKey) {
          const client = buildSupabaseClient(sbUrl, sbKey);
          sbClientRef.current = client;
          await loadSupabaseData(client, mes, anio);
          if (!active) return;
          setSbConnected(true);
          sbChannelRef.current = subscribeSupabaseRealtime(
            client,
            () => {
              loadSupabaseData(client, mes, anio).catch(() => {});
            },
            (status) => setSbRealtimeStatus(status)
          );
        } else {
          await loadLocalData(mes, anio);
        }
      } catch (err) {
        if (active) {
          setLoadError(err instanceof Error ? err.message : 'Error inicializando datos');
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    init();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh when period changes
  useEffect(() => {
    if (loading) return;
    refreshActiveSource(mes, anio).catch((err) => {
      setLoadError(err instanceof Error ? err.message : 'Error cambiando período');
    });
  }, [mes, anio, loading, refreshActiveSource]);

  // Local SSE stream subscription when not connected to Supabase
  useEffect(() => {
    if (sbConnected) {
      setSseConnected(false);
      return;
    }
    const es = new EventSource('/api/stream');
    es.addEventListener('connected', () => setSseConnected(true));
    es.addEventListener('jssp_sync', () => {
      loadLocalData(mes, anio).catch(() => {});
    });
    es.onerror = () => setSseConnected(false);
    return () => {
      es.close();
      setSseConnected(false);
    };
  }, [sbConnected, mes, anio, loadLocalData]);

  const handleConnectSupabase = async (url: string, anonKey: string) => {
    setSbError(null);
    try {
      if (sbChannelRef.current && sbClientRef.current) {
        await sbClientRef.current.removeChannel(sbChannelRef.current);
      }
      const client = buildSupabaseClient(url, anonKey);
      await loadSupabaseData(client, mes, anio);
      sbClientRef.current = client;
      setSbUrl(url);
      setSbKey(anonKey);
      setSbConnected(true);
      sbChannelRef.current = subscribeSupabaseRealtime(
        client,
        () => {
          loadSupabaseData(client, mes, anio).catch(() => {});
        },
        (status) => setSbRealtimeStatus(status)
      );
      setSbDrawerOpen(false);
    } catch (err) {
      setSbError(
        err instanceof Error
          ? err.message
          : 'No se pudo conectar con Supabase. Verifique URL, Anon Key y políticas RLS.'
      );
      throw err;
    }
  };

  const handleDisconnectSupabase = async () => {
    if (sbChannelRef.current && sbClientRef.current) {
      await sbClientRef.current.removeChannel(sbChannelRef.current);
    }
    sbChannelRef.current = null;
    sbClientRef.current = null;
    setSbConnected(false);
    setSbRealtimeStatus('DESCONECTADO');
    await loadLocalData(mes, anio);
  };

  const sendAttendanceEmailServer = async (params: {
    id_marca: number;
    id_trabajador: string;
    nombre_completo: string;
    rut: string;
    email_trabajador: string;
    tipo_marca: TipoMarca;
    fecha_hora_local: string;
    sucursal: string;
    metodo_biometrico: string;
    id_acta: string;
  }): Promise<EmailDispatchLog> => {
    const resp = await fetch('/api/attendance/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error || 'Error enviando comprobante por correo');

    if (sbConnected && sbClientRef.current && json.sent) {
      await marcarRespaldoEmailSupabase(sbClientRef.current, params.id_marca);
      await loadSupabaseData(sbClientRef.current, mes, anio);
    } else {
      await loadLocalData(mes, anio);
    }
    return json as EmailDispatchLog;
  };

  const handleMarkAttendance = async (
    idTrabajador: string,
    tipoMarca: TipoMarca
  ): Promise<RegistrarMarcaResult> => {
    if (sbConnected && sbClientRef.current) {
      const result = await registrarMarcaSupabase(sbClientRef.current, idTrabajador, tipoMarca);
      const trab = snapshot?.trabajadores.find((t) => t.id_trabajador === idTrabajador);
      const suc = snapshot?.sucursales.find((s) => s.id_sucursal === trab?.id_sucursal);
      let emailStatus: EmailDispatchLog | undefined;

      if (trab?.email_trabajador) {
        const clock = extractChileClockHM(result.fecha_hora);
        emailStatus = await sendAttendanceEmailServer({
          id_marca: result.id_marca,
          id_trabajador: idTrabajador,
          nombre_completo: `${trab.nombre_trabajador} ${trab.apellido_trabajador}`,
          rut: trab.rut,
          email_trabajador: trab.email_trabajador,
          tipo_marca: result.tipo_marca,
          fecha_hora_local: `${clock.displayDate} ${clock.displayTime}`,
          sucursal: suc?.nombre_sucursal || 'Sucursal Principal',
          metodo_biometrico: 'QR',
          id_acta: result.id_acta,
        });
      }
      await loadSupabaseData(sbClientRef.current, mes, anio);
      return { ...result, email_status: emailStatus };
    }

    const resp = await fetch('/api/attendance/mark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id_trabajador: idTrabajador,
        tipo_marca: tipoMarca,
        metodo_biometrico: 'QR',
      }),
    });
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error || 'Error registrando marcación');
    await loadLocalData(mes, anio);
    return json as RegistrarMarcaResult;
  };

  const handleSignActa = async (idActa: string) => {
    if (sbConnected && sbClientRef.current) {
      await firmarActaSupabase(sbClientRef.current, idActa, 'FIRMADA');
      await loadSupabaseData(sbClientRef.current, mes, anio);
      return;
    }
    const resp = await fetch(`/api/actas/${encodeURIComponent(idActa)}/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado_firma: 'FIRMADA' }),
    });
    if (!resp.ok) throw new Error('No se pudo firmar el acta.');
    await loadLocalData(mes, anio);
  };

  const handleCreateWorker = async (payload: Parameters<typeof crearTrabajadorSupabase>[1]) => {
    if (sbConnected && sbClientRef.current) {
      await crearTrabajadorSupabase(sbClientRef.current, payload);
      await loadSupabaseData(sbClientRef.current, mes, anio);
      return;
    }
    const resp = await fetch('/api/trabajadores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error || 'Error registrando trabajador');
    await loadLocalData(mes, anio);
  };

  const handleRegisterSale = async (payload: {
    id_vendedor: string;
    id_meta: number;
    items: Array<{ codigo_producto: number; cantidad: number; precio_unitario: number }>;
  }) => {
    if (sbConnected && sbClientRef.current) {
      await registrarVentaSupabase(sbClientRef.current, payload);
      await loadSupabaseData(sbClientRef.current, mes, anio);
      return;
    }
    const resp = await fetch('/api/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error || 'Error registrando venta');
    await loadLocalData(mes, anio);
  };

  const handleCreateMeta = async (payload: {
    fecha_inicio: string;
    fecha_fin: string;
    monto_objetivo: number;
  }) => {
    if (sbConnected && sbClientRef.current) {
      await crearMetaSupabase(sbClientRef.current, payload);
      await loadSupabaseData(sbClientRef.current, mes, anio);
      return;
    }
    const resp = await fetch('/api/metas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error || 'Error creando meta');
    await loadLocalData(mes, anio);
  };

  const handleCreateProduct = async (payload: {
    nombre_producto: string;
    categoria_producto: string;
    porcentaje_comision_producto: number;
  }) => {
    if (sbConnected && sbClientRef.current) {
      await crearProductoSupabase(sbClientRef.current, payload);
      await loadSupabaseData(sbClientRef.current, mes, anio);
      return;
    }
    const resp = await fetch('/api/productos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error || 'Error creando producto');
    await loadLocalData(mes, anio);
  };

  const handleSaveSchedule = async (next: ReportAutomationSchedule) => {
    const resp = await fetch('/api/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error || 'Error guardando programación');
    setSchedule(json);
  };

  const handleSendAdminReport = async (payload: {
    emailAdmin: string;
    mes: number;
    anio: number;
    tasaPuntualidad: number;
    totalAtrasos: number;
    fileName: string;
  }): Promise<EmailDispatchLog> => {
    const resp = await fetch('/api/reports/send-admin-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error || 'Error enviando reporte');
    return {
      id: json.messageId,
      id_marca: 0,
      id_trabajador: 'ADMIN',
      nombre_completo: 'Administrador RRHH',
      email_trabajador: json.emailAdmin,
      tipo_marca: 'ENTRADA',
      fecha_hora_local: getChileNowParts(new Date()).fullLocalStr,
      id_acta: payload.fileName,
      sent: json.sent,
      mode: json.mode,
      messageId: json.messageId,
      previewHtml: json.previewHtml,
      timestamp: new Date().toISOString(),
    };
  };

  const isRealtimeLive = sbConnected ? sbRealtimeStatus === 'SUBSCRIBED' : sseConnected;
  const realtimeLabel = sbConnected
    ? `Supabase Realtime (${sbRealtimeStatus})`
    : sseConnected
      ? 'Sincronización en vivo'
      : 'Reconectando';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="bg-white border-b border-slate-200 px-6 h-16 flex items-center justify-between gap-8 sticky top-0 z-30">
        {/* Zone 1: Single-line Brand Wordmark */}
        <a
          href="#terminal"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('terminal');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          JSSP Control
        </a>

        {/* Zone 2: 4 Single-line Navigation Links */}
        <nav className="flex items-center gap-6 overflow-x-auto text-sm font-medium">
          {(
            [
              { id: 'terminal', label: 'Terminal QR' },
              { id: 'asistencia', label: 'Asistencia' },
              { id: 'reportes', label: 'Reportes PDF' },
              { id: 'ventas', label: 'Metas Art. 22' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`py-5 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === item.id
                  ? 'border-blue-700 text-slate-900 font-semibold'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Zone 3: 1 Primary CTA Button */}
        <div className="shrink-0">
          <button
            type="button"
            onClick={() => setSbDrawerOpen(true)}
            className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              sbConnected
                ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                : 'bg-slate-900 text-white hover:bg-slate-800'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            {sbConnected ? 'Supabase Conectado' : 'Conectar Supabase'}
          </button>
        </div>
      </header>

      {/* Main Content Viewport */}
      <main className="flex-1 w-full max-w-[1400px] mx-auto px-6 py-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              {TAB_TITLES[activeTab].title}
            </h1>
            <p className="text-sm text-slate-600 mt-1">{TAB_TITLES[activeTab].subtitle}</p>
          </div>

          <div className="text-xs text-slate-500 flex items-center gap-2">
            <span>
              Período: <strong className="text-slate-800">{MESES_ES[mes - 1]} {anio}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Origen:{' '}
              <strong className="text-slate-800">
                {sbConnected ? 'Supabase PostgreSQL' : 'Motor Local JSSP'}
              </strong>
            </span>
          </div>
        </div>

        {loading && (
          <div className="bg-white border border-slate-200 rounded-lg p-12 text-center text-sm text-slate-500">
            Cargando esquema operativo JSSP y actas del período...
          </div>
        )}

        {!loading && loadError && (
          <div className="bg-rose-50 border border-rose-200 rounded-lg p-6 text-sm text-rose-800">
            {loadError}
          </div>
        )}

        {!loading && snapshot && actaAdmin && (
          <>
            {activeTab === 'terminal' && (
              <QrTerminalView
                snapshot={snapshot}
                toleranciaMinutos={schedule.toleranciaMinutos}
                onMarkAttendance={handleMarkAttendance}
                onViewEmail={(log) => setPreviewEmailLog(log)}
              />
            )}

            {activeTab === 'asistencia' && (
              <AttendanceMonitorView
                snapshot={snapshot}
                actaAdmin={actaAdmin}
                mes={mes}
                anio={anio}
                toleranciaMinutos={schedule.toleranciaMinutos}
                realtimeConnected={isRealtimeLive}
                realtimeLabel={realtimeLabel}
                onChangePeriodo={(m, y) => {
                  setMes(m);
                  setAnio(y);
                }}
                onSignActa={handleSignActa}
                onResendEmail={sendAttendanceEmailServer}
                onCreateWorker={handleCreateWorker}
                onViewEmail={(log) => setPreviewEmailLog(log)}
              />
            )}

            {activeTab === 'reportes' && (
              <PdfReportsView
                snapshot={snapshot}
                actaAdmin={actaAdmin}
                mes={mes}
                anio={anio}
                schedule={schedule}
                onChangePeriodo={(m, y) => {
                  setMes(m);
                  setAnio(y);
                }}
                onSaveSchedule={handleSaveSchedule}
                onSendAdminReport={handleSendAdminReport}
                onViewEmail={(log) => setPreviewEmailLog(log)}
              />
            )}

            {activeTab === 'ventas' && (
              <Art22SalesView
                snapshot={snapshot}
                actaAdmin={actaAdmin}
                mes={mes}
                anio={anio}
                onRegisterSale={handleRegisterSale}
                onCreateMeta={handleCreateMeta}
                onCreateProduct={handleCreateProduct}
              />
            )}
          </>
        )}
      </main>

      <SupabaseDrawer
        open={sbDrawerOpen}
        onClose={() => setSbDrawerOpen(false)}
        connected={sbConnected}
        realtimeStatus={sbRealtimeStatus}
        supabaseUrl={sbUrl}
        supabaseAnonKey={sbKey}
        lastSyncAt={lastSyncAt}
        errorMsg={sbError}
        onConnect={handleConnectSupabase}
        onDisconnect={handleDisconnectSupabase}
      />

      <EmailPreviewModal
        log={previewEmailLog}
        onClose={() => setPreviewEmailLog(null)}
      />
    </div>
  );
}
