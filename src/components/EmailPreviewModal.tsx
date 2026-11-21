import { X, Mail, CheckCircle2 } from 'lucide-react';
import type { EmailDispatchLog } from '../types/jssp.ts';

interface EmailPreviewModalProps {
  log: EmailDispatchLog | null;
  onClose: () => void;
}

export function EmailPreviewModal({ log, onClose }: EmailPreviewModalProps) {
  if (!log) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Vista previa de comprobante enviado por correo"
    >
      <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-lg overflow-hidden shadow-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3 min-w-0">
            <Mail className="w-5 h-5 text-slate-700 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-slate-900 truncate">
                Comprobante de Marcación por Correo
              </h3>
              <p className="text-xs text-slate-500 truncate">
                Para: {log.email_trabajador} · ID Mensaje: <span className="font-mono">{log.messageId}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100 transition-colors"
            aria-label="Cerrar vista previa"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              Estado respaldo_email: <strong className="text-emerald-700">Confirmado (true)</strong>
            </span>
          </div>
          <span>
            Canal: {log.mode === 'resend' ? 'Resend API' : log.mode === 'smtp' ? 'Servidor SMTP' : 'Simulación de Vista Previa (sin SMTP configurado)'}
          </span>
        </div>

        <div className="p-4 bg-slate-100">
          <iframe
            title="Comprobante HTML enviado al trabajador"
            srcDoc={log.previewHtml}
            sandbox=""
            className="w-full h-[380px] bg-white border border-slate-200 rounded-md"
          />
        </div>

        <div className="px-6 py-3 border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded-md hover:bg-slate-800 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
