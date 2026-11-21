import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Html5Qrcode } from 'html5-qrcode';
import {
  Camera,
  CameraOff,
  CheckCircle2,
  Download,
  Mail,
  QrCode,
  ScanLine,
  Upload,
  AlertCircle,
  Clock,
} from 'lucide-react';
import type {
  EmailDispatchLog,
  JsspSnapshot,
  RegistrarMarcaResult,
  TipoMarca,
} from '../types/jssp.ts';
import {
  buildWorkerQrPayload,
  evaluateMarkPunctuality,
  extractChileClockHM,
  getChileNowParts,
  parseWorkerQrPayload,
} from '../lib/punctuality.ts';

interface QrTerminalViewProps {
  snapshot: JsspSnapshot;
  toleranciaMinutos: number;
  onMarkAttendance: (
    idTrabajador: string,
    tipoMarca: TipoMarca
  ) => Promise<RegistrarMarcaResult>;
  onViewEmail: (log: EmailDispatchLog) => void;
}

export function QrTerminalView({
  snapshot,
  toleranciaMinutos,
  onMarkAttendance,
  onViewEmail,
}: QrTerminalViewProps) {
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState('');
  const [selectedTipo, setSelectedTipo] = useState<'AUTO' | TipoMarca>('AUTO');
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<{
    ok: boolean;
    message: string;
    workerName?: string;
    workerRut?: string;
    turno?: string;
    result?: RegistrarMarcaResult;
  } | null>(null);
  const [qrImages, setQrImages] = useState<Record<string, string>>({});
  const [clockText, setClockText] = useState(() => getChileNowParts(new Date()).fullLocalStr);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastScanTimestampRef = useRef<number>(0);

  // Live Chile clock
  useEffect(() => {
    const timer = setInterval(() => {
      setClockText(getChileNowParts(new Date()).fullLocalStr);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Generate QR Data URLs for every presencial worker
  useEffect(() => {
    let active = true;
    async function genAll() {
      const entries: Record<string, string> = {};
      for (const p of snapshot.presenciales) {
        const t = snapshot.trabajadores.find((w) => w.id_trabajador === p.id_trabajador);
        if (!t) continue;
        const payload = buildWorkerQrPayload(t.id_trabajador, t.rut);
        entries[t.id_trabajador] = await QRCode.toDataURL(payload, {
          width: 240,
          margin: 1,
          color: { dark: '#0F172A', light: '#FFFFFF' },
        });
      }
      if (active) setQrImages(entries);
    }
    genAll();
    return () => {
      active = false;
    };
  }, [snapshot.presenciales, snapshot.trabajadores]);

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      if (scannerRef.current?.isScanning) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  }, []);

  const getWorkerLastMark = (idTrabajador: string) => {
    return [...snapshot.marcas]
      .filter((m) => m.id_trabajador_presencial === idTrabajador)
      .sort((a, b) => new Date(b.fecha_hora).getTime() - new Date(a.fecha_hora).getTime())[0];
  };

  const resolveNextMarkType = (idTrabajador: string): TipoMarca => {
    if (selectedTipo !== 'AUTO') return selectedTipo;
    const last = getWorkerLastMark(idTrabajador);
    return last?.tipo_marca === 'ENTRADA' ? 'SALIDA' : 'ENTRADA';
  };

  const processQrString = async (rawPayload: string) => {
    const nowMs = Date.now();
    if (nowMs - lastScanTimestampRef.current < 1500) return;
    lastScanTimestampRef.current = nowMs;

    const workerId = parseWorkerQrPayload(rawPayload);
    if (!workerId) {
      setLastResult({
        ok: false,
        message: 'Código QR no reconocido. Verifique el formato de credencial JSSP.',
      });
      return;
    }

    const trabajador = snapshot.trabajadores.find(
      (t) =>
        t.id_trabajador.toUpperCase() === workerId.toUpperCase() ||
        t.rut.toUpperCase() === workerId.toUpperCase()
    );

    const resolvedId = trabajador?.id_trabajador || workerId;
    const isPresencial = snapshot.presenciales.some((p) => p.id_trabajador === resolvedId);
    const isArt22 = snapshot.vendedores.some(
      (v) => v.id_trabajador === resolvedId && v.es_articulo22
    );

    if (!isPresencial && isArt22) {
      setLastResult({
        ok: false,
        workerName: trabajador
          ? `${trabajador.nombre_trabajador} ${trabajador.apellido_trabajador}`
          : resolvedId,
        message:
          'Trabajador contratado bajo Artículo 22 del Código del Trabajo: exento de marcación horaria presencial. Gestione sus metas en el módulo Metas Art. 22.',
      });
      return;
    }

    const tipo = resolveNextMarkType(resolvedId);
    const presencial = snapshot.presenciales.find((p) => p.id_trabajador === resolvedId);

    setSubmitting(true);
    try {
      const result = await onMarkAttendance(resolvedId, tipo);
      setLastResult({
        ok: true,
        workerName: trabajador
          ? `${trabajador.nombre_trabajador} ${trabajador.apellido_trabajador}`
          : resolvedId,
        workerRut: trabajador?.rut,
        turno: presencial?.turno_asignado,
        result,
        message: `Marcación de ${result.tipo_marca} registrada vía QR y confirmada por correo electrónico.`,
      });
      setManualInput('');
    } catch (err) {
      setLastResult({
        ok: false,
        workerName: trabajador
          ? `${trabajador.nombre_trabajador} ${trabajador.apellido_trabajador}`
          : resolvedId,
        message: err instanceof Error ? err.message : 'No fue posible registrar la marcación.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleCamera = async () => {
    setCameraError(null);
    if (cameraActive) {
      if (scannerRef.current?.isScanning) {
        await scannerRef.current.stop();
      }
      setCameraActive(false);
      return;
    }

    try {
      const html5QrCode = new Html5Qrcode('jssp-qr-reader');
      scannerRef.current = html5QrCode;
      await html5QrCode.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (decodedText) => {
          processQrString(decodedText);
        },
        () => {}
      );
      setCameraActive(true);
    } catch (err) {
      setCameraActive(false);
      setCameraError(
        err instanceof Error
          ? `Cámara no disponible en este navegador (${err.message}). Puede subir una imagen QR o usar las credenciales de prueba.`
          : 'No se pudo iniciar la cámara.'
      );
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCameraError(null);
    try {
      const tempScanner = new Html5Qrcode('jssp-qr-file-temp');
      const decoded = await tempScanner.scanFile(file, true);
      tempScanner.clear();
      await processQrString(decoded);
    } catch {
      setCameraError('No se detectó un código QR válido en la imagen seleccionada.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDownloadBadge = (idTrabajador: string, nombre: string) => {
    const dataUrl = qrImages[idTrabajador];
    if (!dataUrl) return;
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `Credencial_QR_${idTrabajador}_${nombre.replace(/\s+/g, '_')}.png`;
    link.click();
  };

  const presencialWorkers = snapshot.presenciales.map((p) => {
    const t = snapshot.trabajadores.find((w) => w.id_trabajador === p.id_trabajador);
    const suc = snapshot.sucursales.find((s) => s.id_sucursal === t?.id_sucursal);
    const lastMark = getWorkerLastMark(p.id_trabajador);
    return {
      ...p,
      trabajador: t,
      sucursal: suc?.nombre_sucursal || 'Sucursal',
      lastMark,
      enTurno: lastMark?.tipo_marca === 'ENTRADA',
    };
  });

  const art22Workers = snapshot.vendedores.map((v) => {
    const t = snapshot.trabajadores.find((w) => w.id_trabajador === v.id_trabajador);
    return { ...v, trabajador: t };
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      {/* Left: Optical QR Scanner Terminal */}
      <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Terminal de Marcación Biométrica QR
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              RPC jssp_registrar_marca_asistencia · Zona horaria America/Santiago
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500">Hora Oficial Chile</div>
            <div className="text-sm font-mono font-semibold tabular-nums text-slate-900">
              {clockText}
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Action mode selector */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <span className="text-xs font-medium text-slate-600">Modalidad de Marca</span>
            <div className="inline-flex items-center p-1 bg-slate-100 rounded-md">
              {(['AUTO', 'ENTRADA', 'SALIDA'] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setSelectedTipo(opt)}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                    selectedTipo === opt
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt === 'AUTO' ? 'Automática (Secuencial)' : opt}
                </button>
              ))}
            </div>
          </div>

          {/* Scanner Viewport */}
          <div className="bg-slate-900 rounded-lg overflow-hidden border border-slate-800 relative">
            <div id="jssp-qr-reader" className={cameraActive ? 'w-full min-h-[280px]' : 'hidden'} />
            <div id="jssp-qr-file-temp" className="hidden" />

            {!cameraActive && (
              <div className="px-6 py-12 flex flex-col items-center justify-center text-center">
                <ScanLine className="w-10 h-10 text-slate-400 mb-3" />
                <p className="text-sm font-medium text-white">
                  Lector QR en espera de credencial
                </p>
                <p className="text-xs text-slate-400 mt-1 max-w-md">
                  Active la cámara web, suba una imagen QR o pruebe escaneando directamente una
                  credencial del panel lateral.
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={toggleCamera}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                  >
                    <Camera className="w-4 h-4" />
                    Iniciar Cámara QR
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-slate-800 text-slate-200 border border-slate-700 rounded-md hover:bg-slate-700 transition-colors"
                  >
                    <Upload className="w-4 h-4" />
                    Subir Imagen QR
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </div>
              </div>
            )}

            {cameraActive && (
              <div className="p-3 bg-slate-950 flex items-center justify-between">
                <span className="text-xs text-slate-300">
                  Apunte el código QR de la credencial frente a la cámara
                </span>
                <button
                  type="button"
                  onClick={toggleCamera}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-rose-600 text-white rounded-md hover:bg-rose-700"
                >
                  <CameraOff className="w-3.5 h-3.5" />
                  Detener Cámara
                </button>
              </div>
            )}
          </div>

          {cameraError && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-900 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <span>{cameraError}</span>
            </div>
          )}

          {/* USB / Manual Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (manualInput.trim()) processQrString(manualInput);
            }}
            className="flex flex-col sm:flex-row gap-3"
          >
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="Lector USB / Ingreso manual: ID (ej. TRAB-001), RUT o JSON QR..."
              className="flex-1 px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <button
              type="submit"
              disabled={submitting || !manualInput.trim()}
              className="px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded-md hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              {submitting ? 'Registrando...' : 'Validar Marcación'}
            </button>
          </form>

          {/* Last scan feedback */}
          {lastResult && (
            <div
              className={`p-4 rounded-lg border ${
                lastResult.ok
                  ? 'bg-emerald-50/70 border-emerald-200'
                  : 'bg-rose-50/70 border-rose-200'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  {lastResult.ok ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-rose-700 shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-slate-900">
                      {lastResult.workerName || 'Validación de Terminal'}
                      {lastResult.workerRut ? (
                        <span className="ml-2 text-xs font-mono font-normal text-slate-500">
                          {lastResult.workerRut}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-slate-700">{lastResult.message}</p>

                    {lastResult.ok && lastResult.result && (
                      <div className="pt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 font-mono tabular-nums">
                        <span>Marca #{lastResult.result.id_marca}</span>
                        <span>·</span>
                        <span>{lastResult.result.id_acta}</span>
                        <span>·</span>
                        <span>
                          Hora:{' '}
                          {extractChileClockHM(lastResult.result.fecha_hora).displayTime}
                        </span>
                        <span>·</span>
                        <span>
                          {
                            evaluateMarkPunctuality(
                              lastResult.result.fecha_hora,
                              lastResult.result.tipo_marca,
                              lastResult.turno,
                              toleranciaMinutos
                            ).etiqueta
                          }
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {lastResult.result?.email_status && (
                  <button
                    type="button"
                    onClick={() => onViewEmail(lastResult.result!.email_status!)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 text-slate-800 rounded-md hover:bg-slate-50 shrink-0"
                  >
                    <Mail className="w-3.5 h-3.5 text-emerald-700" />
                    Ver Correo Enviado
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Right: Worker QR Badges */}
      <aside className="lg:col-span-5 bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Credenciales QR Presenciales
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              JSSP_TRABAJADOR_PRESENCIAL · {presencialWorkers.length} activos
            </p>
          </div>
          <QrCode className="w-5 h-5 text-slate-400" />
        </div>

        <div className="divide-y divide-slate-200 max-h-[540px] overflow-y-auto">
          {presencialWorkers.map((w) => {
            const nombre = w.trabajador
              ? `${w.trabajador.nombre_trabajador} ${w.trabajador.apellido_trabajador}`
              : w.id_trabajador;
            const qrSrc = qrImages[w.id_trabajador];
            return (
              <div key={w.id_trabajador} className="p-4 flex items-center gap-4 hover:bg-slate-50/70">
                <div className="w-20 h-20 bg-white border border-slate-200 rounded-md p-1.5 shrink-0 flex items-center justify-center">
                  {qrSrc ? (
                    <img
                      src={qrSrc}
                      alt={`Código QR de ${nombre}`}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <QrCode className="w-6 h-6 text-slate-300" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-900 truncate">{nombre}</span>
                    <span
                      className={`text-xs font-medium shrink-0 ${
                        w.enTurno ? 'text-emerald-700' : 'text-slate-500'
                      }`}
                    >
                      {w.enTurno ? 'En turno' : 'Fuera de turno'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 truncate">
                    <span className="font-mono">{w.id_trabajador}</span> ·{' '}
                    <span className="font-mono">{w.trabajador?.rut}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                    <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                    <span className="truncate">
                      Turno {w.turno_asignado} · {w.sucursal}
                    </span>
                  </div>

                  <div className="mt-2.5 flex items-center gap-2">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() =>
                        processQrString(
                          buildWorkerQrPayload(w.id_trabajador, w.trabajador?.rut || '')
                        )
                      }
                      className="px-2.5 py-1 text-xs font-medium bg-slate-900 text-white rounded hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap"
                    >
                      Escanear {selectedTipo === 'AUTO' ? (w.enTurno ? 'Salida' : 'Entrada') : selectedTipo}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownloadBadge(w.id_trabajador, nombre)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium border border-slate-300 text-slate-700 rounded hover:bg-slate-100 transition-colors whitespace-nowrap"
                    >
                      <Download className="w-3 h-3" />
                      QR PNG
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Excluded Art. 22 notice */}
        <div className="px-5 py-4 bg-slate-50 border-t border-slate-200">
          <div className="text-xs font-semibold text-slate-700">
            Personal Exento de Marcación Horaria (Artículo 22 CT)
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {art22Workers
              .map((v) =>
                v.trabajador
                  ? `${v.trabajador.nombre_trabajador} ${v.trabajador.apellido_trabajador} (${v.zona_cobertura})`
                  : v.id_trabajador
              )
              .join(' · ')}
          </p>
        </div>
      </aside>
    </div>
  );
}
