import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { env } from '../config/env.ts';
import { ApiError } from '../middleware/errorHandler.ts';

export interface SignedQrPayload {
  sistema: 'JSSP';
  id: string;
  rut: string;
  sig: string;
}

function computeSignature(id: string, rut: string): string {
  return crypto
    .createHmac('sha256', env.qrSigningSecret)
    .update(`${id}:${rut}`)
    .digest('hex')
    .slice(0, 16);
}

export function createWorkerQrPayload(idTrabajador: string, rut: string): SignedQrPayload {
  return {
    sistema: 'JSSP',
    id: idTrabajador,
    rut,
    sig: computeSignature(idTrabajador, rut),
  };
}

export async function generateWorkerQrPng(
  idTrabajador: string,
  rut: string
): Promise<{ payload: SignedQrPayload; pngBuffer: Buffer; dataUrl: string }> {
  const payload = createWorkerQrPayload(idTrabajador, rut);
  const raw = JSON.stringify(payload);
  const [pngBuffer, dataUrl] = await Promise.all([
    QRCode.toBuffer(raw, { width: 320, margin: 2 }),
    QRCode.toDataURL(raw, { width: 320, margin: 2 }),
  ]);
  return { payload, pngBuffer, dataUrl };
}

export function parseAndVerifyQrInput(input: {
  id_trabajador?: string;
  qr_payload?: string;
}): string {
  if (input.id_trabajador && !input.qr_payload) {
    return input.id_trabajador.trim().toUpperCase();
  }

  const raw = (input.qr_payload || '').trim();
  if (!raw) {
    throw new ApiError(400, 'Debe enviar id_trabajador o qr_payload.');
  }

  if (!raw.startsWith('{')) {
    return raw.toUpperCase();
  }

  let parsed: Partial<SignedQrPayload> & { id_trabajador?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError(400, 'El contenido del código QR no tiene formato JSON válido.');
  }

  const id = (parsed.id || parsed.id_trabajador || '').trim().toUpperCase();
  if (!id) {
    throw new ApiError(400, 'El código QR no contiene identificador de trabajador.');
  }

  // If HMAC signature is present, verify integrity when rut is provided
  if (parsed.sig && parsed.rut) {
    const expected = computeSignature(id, parsed.rut);
    const sigBuf = Buffer.from(parsed.sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      throw new ApiError(401, 'Firma criptográfica de credencial QR inválida o alterada.');
    }
  }

  return id;
}
