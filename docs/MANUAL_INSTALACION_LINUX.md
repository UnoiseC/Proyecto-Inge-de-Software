# Manual de Instalación en Linux (Ubuntu / Debian)

Esta guía detalla los pasos para instalar, configurar, compilar y ejecutar en producción el backend **JSSP Control** sobre un servidor **Linux** (Ubuntu 22.04 / 24.04 LTS o Debian 12).

---

## 1. Requisitos del Sistema

- **Sistema Operativo:** Ubuntu 22.04/24.04 LTS, Debian 12 o distribución equivalente.
- **Node.js:** v22.x LTS (requerido para soporte nativo de TypeScript y rendimiento óptimo).
- **Git:** v2.34 o superior.
- **Base de datos:** Proyecto activo en **Supabase** (con `estructura.sql` ejecutado) o **PostgreSQL 15+**.

---

## 2. Preparación del Servidor e Instalación de Dependencias Base

Actualiza los paquetes e instala herramientas base (`curl`, `git`, `ca-certificates`):

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ca-certificates gnupg
```

### Instalar Node.js 22 LTS (NodeSource)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

Verifica las versiones instaladas:

```bash
node -v   # Debe mostrar v22.x.x
npm -v
git --version
```

---

## 3. Clonar el Proyecto desde GitHub e Instalar Paquetes

```bash
sudo mkdir -p /opt/jssp-backend
sudo chown $USER:$USER /opt/jssp-backend
cd /opt/jssp-backend

git clone https://github.com/<tu-usuario>/<tu-repositorio>.git .
npm install
```

---

## 4. Configurar la Base de Datos (Supabase o PostgreSQL)

### Opción A: Usando Supabase (Recomendado)
1. En el **SQL Editor** de tu proyecto Supabase, ejecuta el contenido completo de `estructura.sql`.
2. Luego ejecuta el script complementario incluido en el backend (`src/db/supabaseScripts.ts`, también accesible en `GET /api/supabase/complement-sql?format=sql`) para activar:
   - Publicación `supabase_realtime` sobre las tablas `JSSP_*`.
   - Trigger `trg_actualizar_totales_venta_y_meta`.
   - Políticas RLS y permisos `GRANT EXECUTE` sobre las funciones RPC.

### Opción B: PostgreSQL local en Linux
```bash
sudo apt install -y postgresql postgresql-contrib
sudo -u postgres psql -c "CREATE DATABASE jssp_control;"
sudo -u postgres psql -c "CREATE USER jssp_user WITH PASSWORD 'ClaveSeguraCambiar';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE jssp_control TO jssp_user;"
sudo -u postgres psql -d jssp_control -f /opt/jssp-backend/estructura.sql
```

---

## 5. Configurar Variables de Entorno (`.env`)

Crea el archivo `.env` a partir de la plantilla:

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

Completa las variables según tu entorno:

```env
PORT=3000
NODE_ENV=production
CORS_ORIGIN="https://tu-dominio.cl"

# Conexión Supabase (sin /rest/v1/ al final de SUPABASE_URL)
SUPABASE_URL="https://tu-proyecto.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="tu_service_role_key"
SUPABASE_ANON_KEY="tu_anon_key"

# Alternativa PostgreSQL directo (si no usas REST/RPC de Supabase)
DATABASE_URL=""

# Seguridad en producción
REQUIRE_AUTH=true
API_ADMIN_KEY="genera_una_clave_larga_aleatoria"
QR_SIGNING_SECRET="genera_un_secreto_hmac_de_64_caracteres"

# Correo electrónico (Resend o SMTP)
RESEND_API_KEY=""
SMTP_HOST="smtp.tu-proveedor.cl"
SMTP_PORT=587
SMTP_USER="asistencia@tu-dominio.cl"
SMTP_PASS="tu_password_smtp"
SMTP_FROM="JSSP Asistencia <asistencia@tu-dominio.cl>"
```

Puedes generar claves aleatorias seguras en Linux con:
```bash
openssl rand -hex 32
```

---

## 6. Validación de Tipos y Compilación para Producción

Verifica la integridad de TypeScript y genera el bundle optimizado en `dist/server.js`:

```bash
npm run lint
npm run build
```

Prueba el arranque compilado manualmente:

```bash
npm run start:prod
```
Deberías ver en consola:
`JSSP Control Pure Backend API (DB mode: supabase | Auth: REQUIRED) listening on http://0.0.0.0:3000`

Detén la prueba con `Ctrl + C`.

---

## 7. Configurar Ejecución Persistente con `systemd`

Crea un servicio del sistema para que el backend arranque automáticamente con Linux y se reinicie ante fallos:

```bash
sudo tee /etc/systemd/system/jssp-backend.service > /dev/null <<'EOF'
[Unit]
Description=JSSP Control Backend API (Node.js)
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/jssp-backend
EnvironmentFile=/opt/jssp-backend/.env
ExecStart=/usr/bin/node /opt/jssp-backend/dist/server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
```

Asigna permisos y activa el servicio:

```bash
sudo chown -R www-data:www-data /opt/jssp-backend
sudo systemctl daemon-reload
sudo systemctl enable jssp-backend
sudo systemctl start jssp-backend
sudo systemctl status jssp-backend
```

Ver logs en tiempo real:
```bash
sudo journalctl -u jssp-backend -f
```

---

## 8. Firewall y Proxy Inverso Nginx (Opcional Recomendado)

Si expones el servicio a internet con HTTPS mediante Nginx:

```bash
sudo apt install -y nginx ufw
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
```

Archivo de sitio Nginx (`/etc/nginx/sites-available/jssp-api`):

```nginx
server {
    listen 80;
    server_name api.tu-dominio.cl;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off; # Necesario para SSE (/api/realtime/stream)
    }
}
```

Habilita la configuración:
```bash
sudo ln -s /etc/nginx/sites-available/jssp-api /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 9. Verificación Final en Linux

```bash
curl -s http://localhost:3000/api/health
```

Debe responder HTTP `200` con `"ok": true` y `"db_connected": true`. Para actualizaciones posteriores desde GitHub:

```bash
cd /opt/jssp-backend
git pull origin main
npm install
npm run build
sudo systemctl restart jssp-backend
```
