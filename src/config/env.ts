import crypto from 'node:crypto';

const runtimeQrSecret = crypto.randomBytes(32).toString('hex');

export const env = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN?.trim() || '',

  supabaseUrl: (process.env.SUPABASE_URL || '')
    .trim()
    .replace(/\/rest\/v1\/?$/i, '')
    .replace(/\/+$/, ''),
  supabaseServiceRoleKey: (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
  supabaseAnonKey: (process.env.SUPABASE_ANON_KEY || '').trim(),
  databaseUrl: (process.env.DATABASE_URL || '').trim(),

  requireAuth: process.env.REQUIRE_AUTH === 'true',
  apiAdminKey: (process.env.API_ADMIN_KEY || '').trim(),
  qrSigningSecret: (process.env.QR_SIGNING_SECRET || '').trim() || runtimeQrSecret,

  resendApiKey: (process.env.RESEND_API_KEY || '').trim(),
  smtpHost: (process.env.SMTP_HOST || '').trim(),
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpUser: (process.env.SMTP_USER || '').trim(),
  smtpPass: (process.env.SMTP_PASS || '').trim(),
  smtpFrom: (process.env.SMTP_FROM || 'JSSP Asistencia <asistencia@jsspcontrol.cl>').trim(),
};
