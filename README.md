# JSSP Control — Backend API REST (Node.js + TypeScript + Supabase/PostgreSQL)

Backend empresarial desarrollado en **Node.js, Express y TypeScript** sobre la base de datos **`estructura.sql`** (PostgreSQL / Supabase), orientado al control de asistencia mediante códigos QR, actas mensuales (Art. 33 del Código del Trabajo), gestión de ventas, metas comerciales y cálculo de comisiones para vendedores bajo **Artículo 22**.

---

## 1. Arquitectura del Software

```text
├── server.ts                        # Punto de entrada Express, CORS, SSE Realtime y scheduler
├── estructura.sql                   # Dump PostgreSQL (tablas, triggers, procedimientos y RPCs)
├── package.json                     # Scripts y dependencias puras de backend Node.js
├── tsconfig.json                    # Configuración TypeScript (NodeNext / ES2022)
├── .env.example                     # Plantilla segura de variables de entorno
└── src/
    ├── config/env.ts                # Carga y normalización de variables de entorno
    ├── db/
    │   ├── repository.ts            # Capa de datos (Supabase RPC/REST, PostgreSQL pg o Memoria)
    │   └── supabaseScripts.ts       # Script SQL complementario (Realtime, triggers y políticas RLS)
    ├── middleware/
    │   ├── auth.ts                  # Validación JWT de Supabase, X-API-Key y control de roles (RBAC)
    │   └── errorHandler.ts          # Manejo centralizado de errores HTTP y PostgreSQL
    ├── routes/
    │   └── apiRouter.ts             # Definición completa de endpoints REST (/api/*)
    ├── services/
    │   ├── emailService.ts          # Envío de respaldos y reportes PDF (Resend / SMTP / Preview)
    │   ├── pdfService.ts            # Generación binaria de reportes PDF (jsPDF + AutoTable)
    │   ├── qrService.ts             # Generación PNG/JSON y verificación HMAC-SHA256 de QR
    │   ├── schedulerService.ts      # Envío programado de reportes en zona America/Santiago
    │   └── timeService.ts           # Cálculos horarios (America/Santiago) y evaluación de puntualidad
    ├── types/database.ts            # Interfaces TypeScript mapeadas al esquema JSSP_*
    └── utils/postmanCollection.ts   # Generador dinámico de colección Postman v2.1
```

### Modos de Base de Datos Soportados
1. **Supabase (`supabase`)**: Usa `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `SUPABASE_ANON_KEY`, ejecutando consultas, funciones RPC (`jssp_registrar_marca_asistencia`, `jssp_obtener_acta_mensual_admin`) y suscripción Realtime.
2. **PostgreSQL directo (`postgres`)**: Usa `DATABASE_URL` mediante pool de conexiones `pg`.
3. **Sandbox en memoria (`memory`)**: Modo de respaldo automático cuando no existen credenciales configuradas.

---

## 2. Control de Versión en Git y GitHub

El archivo `.gitignore` ya protege credenciales y artefactos generados (`node_modules/`, `dist/`, `.env*` manteniendo visible únicamente `!.env.example`).

### Inicializar repositorio y subir por primera vez
```bash
git init
git add .
git status   # Verifica que .env NO aparezca en la lista (solo .env.example)
git commit -m "feat: backend inicial Node.js + TypeScript conectado a Supabase"
git branch -M main
git remote add origin https://github.com/<tu-usuario>/<tu-repositorio>.git
git push -u origin main
```

### Flujo de trabajo recomendado (ramas y commits)
```bash
# Crear una rama para una nueva funcionalidad o corrección
git checkout -b feat/reportes-pdf

# Guardar cambios
git add src/
git commit -m "feat(reportes): agrega filtro por sucursal en PDF de puntualidad"

# Subir rama a GitHub
git push -u origin feat/reportes-pdf

# Actualizar rama principal tras hacer Pull Request / Merge
git checkout main
git pull origin main
```

> **Regla crítica de seguridad:** Nunca ejecutes `git add -f .env` ni pegues claves reales (`SUPABASE_SERVICE_ROLE_KEY`, `SMTP_PASS`, `API_ADMIN_KEY`) en `.env.example` o archivos `.ts`.

---

## 3. Documentación Incluida

- **[Manual de Usuario](docs/MANUAL_USUARIO.md)**: Uso completo de endpoints y pruebas en Postman.
- **[Manual de Instalación en Linux](docs/MANUAL_INSTALACION_LINUX.md)**: Despliegue en Ubuntu/Debian paso a paso con `systemd`.
