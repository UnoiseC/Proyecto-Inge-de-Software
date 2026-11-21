import { useState } from 'react';
import { X, Database, Copy, Check, RefreshCw, Unplug } from 'lucide-react';
import { SUPABASE_COMPLEMENT_SQL, SUPABASE_EDGE_FUNCTION_CODE } from '../lib/supabaseSqlScripts.ts';

interface SupabaseDrawerProps {
  open: boolean;
  onClose: () => void;
  connected: boolean;
  realtimeStatus: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  lastSyncAt: string | null;
  errorMsg: string | null;
  onConnect: (url: string, anonKey: string) => Promise<void>;
  onDisconnect: () => void;
}

export function SupabaseDrawer({
  open,
  onClose,
  connected,
  realtimeStatus,
  supabaseUrl,
  supabaseAnonKey,
  lastSyncAt,
  errorMsg,
  onConnect,
  onDisconnect,
}: SupabaseDrawerProps) {
  const [urlInput, setUrlInput] = useState(supabaseUrl);
  const [keyInput, setKeyInput] = useState(supabaseAnonKey);
  const [tab, setTab] = useState<'conexion' | 'sql' | 'edge'>('conexion');
  const [connecting, setConnecting] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!open) return null;

  const handleConnectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setConnecting(true);
    try {
      await onConnect(urlInput, keyInput);
    } finally {
      setConnecting(false);
    }
  };

  const handleCopy = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/45"
      role="dialog"
      aria-modal="true"
      aria-label="Configuración de conexión Supabase y scripts SQL"
    >
      <div className="w-full max-w-2xl bg-white h-full border-l border-slate-200 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <Database className="w-5 h-5 text-slate-900" />
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Conexión a Supabase y Sincronización Realtime
              </h2>
              <p className="text-xs text-slate-500">
                Esquema JSSP · RPCs jssp_registrar_marca_asistencia y jssp_obtener_acta_mensual_admin
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100"
            aria-label="Cerrar panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 pt-3 border-b border-slate-200 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTab('conexion')}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === 'conexion'
                ? 'border-blue-700 text-blue-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Credenciales y Estado
          </button>
          <button
            type="button"
            onClick={() => setTab('sql')}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === 'sql'
                ? 'border-blue-700 text-blue-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            SQL Complementario (Realtime y RLS)
          </button>
          <button
            type="button"
            onClick={() => setTab('edge')}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === 'edge'
                ? 'border-blue-700 text-blue-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Edge Function Correo
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {tab === 'conexion' && (
            <>
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-600">Estado de Base de Datos</span>
                  <span
                    className={`text-xs font-semibold ${
                      connected ? 'text-emerald-700' : 'text-slate-700'
                    }`}
                  >
                    {connected
                      ? `Conectado a Supabase (${realtimeStatus})`
                      : 'Motor Local PostgreSQL-Compatible (SSE Activo)'}
                  </span>
                </div>
                {lastSyncAt && (
                  <p className="text-xs text-slate-500 font-mono tabular-nums">
                    Última sincronización: {new Date(lastSyncAt).toLocaleTimeString('es-CL')}
                  </p>
                )}
                <p className="text-xs text-slate-600 leading-relaxed">
                  Ingrese la URL de su proyecto Supabase y su clave pública (Anon Key). Las marcas QR
                  llamarán directamente a <span className="font-mono">jssp_registrar_marca_asistencia</span> y
                  se sincronizarán mediante canales Realtime (<span className="font-mono">postgres_changes</span>).
                </p>
              </div>

              {errorMsg && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-800">
                  {errorMsg}
                </div>
              )}

              <form onSubmit={handleConnectSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Supabase Project URL
                  </label>
                  <input
                    type="url"
                    required
                    placeholder="https://su-proyecto.supabase.co"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Supabase Anon Key (Clave pública del cliente)
                  </label>
                  <input
                    type="password"
                    required
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={connecting}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded-md hover:bg-slate-800 disabled:opacity-50 transition-colors"
                  >
                    <RefreshCw className={`w-4 h-4 ${connecting ? 'animate-spin' : ''}`} />
                    {connecting ? 'Verificando esquema...' : 'Conectar y Sincronizar'}
                  </button>

                  {connected && (
                    <button
                      type="button"
                      onClick={onDisconnect}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-slate-300 text-slate-700 rounded-md hover:bg-slate-50 transition-colors"
                    >
                      <Unplug className="w-4 h-4" />
                      Volver a Modo Local
                    </button>
                  )}
                </div>
              </form>
            </>
          )}

          {tab === 'sql' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <p className="text-xs text-slate-600">
                  Ejecute este bloque en el <strong>SQL Editor</strong> de Supabase para activar
                  Realtime en las tablas <span className="font-mono">JSSP_*</span>, vincular el trigger
                  de metas/ventas y habilitar permisos de ejecución de los RPCs.
                </p>
                <button
                  type="button"
                  onClick={() => handleCopy('sql', SUPABASE_COMPLEMENT_SQL)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-md hover:bg-slate-50 shrink-0"
                >
                  {copiedKey === 'sql' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedKey === 'sql' ? 'Copiado' : 'Copiar SQL'}
                </button>
              </div>
              <pre className="p-4 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono overflow-x-auto leading-relaxed">
                {SUPABASE_COMPLEMENT_SQL}
              </pre>
            </div>
          )}

          {tab === 'edge' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <p className="text-xs text-slate-600">
                  Además del servidor integrado (<span className="font-mono">/api/attendance/send-email</span>),
                  puede desplegar esta Edge Function en Supabase si prefiere disparar correos mediante
                  Database Webhooks al insertar en <span className="font-mono">JSSP_MARCA_ASISTENCIA</span>.
                </p>
                <button
                  type="button"
                  onClick={() => handleCopy('edge', SUPABASE_EDGE_FUNCTION_CODE)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-md hover:bg-slate-50 shrink-0"
                >
                  {copiedKey === 'edge' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedKey === 'edge' ? 'Copiado' : 'Copiar Código'}
                </button>
              </div>
              <pre className="p-4 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono overflow-x-auto leading-relaxed">
                {SUPABASE_EDGE_FUNCTION_CODE}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
