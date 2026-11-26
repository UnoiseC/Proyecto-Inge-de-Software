# Manual de Usuario — API REST JSSP Control

Este manual describe cómo operar el sistema de backend **JSSP Control** utilizando **Postman** (u otro cliente HTTP) para administrar sucursales, trabajadores presenciales, vendedores bajo Artículo 22, marcación de asistencia mediante QR, actas mensuales, metas de venta y reportes PDF.

---

## 1. Requisitos Previos para el Operador

1. Tener el backend en ejecución (por ejemplo, en `http://localhost:3000` o la URL del servidor Linux).
2. Tener instalado **Postman Desktop** *(si pruebas en `localhost`, asegúrate de usar Postman Desktop o el agente local, no el Cloud Agent web)*.
3. Importar la colección oficial descargándola desde:
   - `GET http://localhost:3000/api/postman-collection`
   - En Postman: **Import → seleccionar el archivo `JSSP_Control_API.postman_collection.json`**.

---

## 2. Verificación Inicial del Sistema

Antes de operar, verifica el estado de conexión con Supabase:
- **Método:** `GET`
- **URL:** `http://localhost:3000/api/health`
- **Respuesta esperada (`200 OK`):**
  ```json
  {
    "ok": true,
    "database_mode": "supabase",
    "db_connected": true,
    "chile_time": "26/11/2026 18:45:11"
  }
  ```
- Si `REQUIRE_AUTH=true` está activado en el servidor, inicia sesión primero con `POST /api/auth/login` enviando `email` y `password` para obtener tu `access_token`, e inclúyelo como cabecera `Authorization: Bearer <token>` (o usa `X-API-Key` para acceso administrativo).

---

## 3. Gestión de Sucursales y Trabajadores

### 3.1 Crear o consultar sucursales
- **Listar:** `GET /api/sucursales`
- **Crear:** `POST /api/sucursales`
  ```json
  {
    "nombre_sucursal": "Sucursal Talca Centro",
    "tipo_sucursal": "Comercial",
    "dirección_sucursal": "1 Sur 1120, Talca"
  }
  ```

### 3.2 Registrar trabajadores
- **Endpoint:** `POST /api/trabajadores`
- **Trabajador Presencial** (control horario con QR y acta mensual):
  ```json
  {
    "id_trabajador": "TRAB002",
    "rut": "18.456.321-5",
    "nombre_trabajador": "Camila",
    "apellido_trabajador": "Rojas",
    "email_trabajador": "camila.rojas@empresa.cl",
    "sueldo_base_trabajador": 950000,
    "id_sucursal": 1,
    "modalidad": "PRESENCIAL",
    "rol": "Cajera",
    "turno_asignado": "09:00 - 18:00"
  }
  ```
- **Vendedor en Terreno — Artículo 22** (exento de control horario; habilitado para ventas y comisiones):
  ```json
  {
    "id_trabajador": "VEND002",
    "rut": "17.987.654-3",
    "nombre_trabajador": "Matías",
    "apellido_trabajador": "Fuentes",
    "email_trabajador": "matias.fuentes@empresa.cl",
    "sueldo_base_trabajador": 1100000,
    "id_sucursal": 1,
    "modalidad": "ART22",
    "es_articulo22": true,
    "zona_cobertura": "Zona Sur"
  }
  ```
- **Listar trabajadores:** `GET /api/trabajadores` *(filtros opcionales: `?modalidad=PRESENCIAL`, `?id_sucursal=1`, `?search=Camila`)*.

---

## 4. Control de Asistencia por QR y Actas Mensuales

### 4.1 Generar credencial QR
- **Imagen PNG directa:** `GET /api/asistencia/qr/TRAB001`
- **Payload firmado + DataURL JSON:** `GET /api/asistencia/qr/TRAB001?format=json`
  > Los vendedores registrados exclusivamente bajo Artículo 22 reciben rechazo (`400`) si intentan generar QR o marcar asistencia horaria.

### 4.2 Registrar Entrada y Salida
- **Endpoint:** `POST /api/asistencia/marcar`
- **Marcar ENTRADA:**
  ```json
  {
    "id_trabajador": "TRAB001",
    "tipo_marca": "ENTRADA",
    "metodo_biometrico": "QR"
  }
  ```
  *(También puede enviarse `"qr_payload"` con el JSON firmado leído desde la credencial QR; el servidor verifica la firma HMAC-SHA256).*
- **Marcar SALIDA:** enviar `"tipo_marca": "SALIDA"`.
- **Reglas de negocio validadas automáticamente:**
  - No permite dos `ENTRADA` consecutivas sin `SALIDA` intermedia (`409 Conflict`).
  - Crea o actualiza automáticamente el acta mensual (`JSSP_ACTA_ASISTENCIA_MENSUAL`) y recalcula los días únicos trabajados en hora de Chile (`America/Santiago`).
  - Despacha comprobante por correo electrónico al trabajador y registra el estado en `respaldo_email`.

### 4.3 Revisar puntualidad y firmar actas
- **Análisis de puntualidad:** `GET /api/asistencia/puntualidad?mes=11&anio=2026&tolerancia=5`
- **Consolidado administrativo (RPC):** `GET /api/actas/admin?mes=11&anio=2026`
- **Firmar acta mensual:** `PATCH /api/actas/ACTA-2026-11-TRAB001/firmar`
  ```json
  { "estado_firma": "FIRMADA" }
  ```

---

## 5. Productos, Metas, Ventas y Comisiones Art. 22

1. **Productos (`GET /api/productos`, `POST /api/productos`)**:
   ```json
   {
     "nombre_producto": "Lector Biométrico USB",
     "categoria_producto": "Hardware",
     "porcentaje_comision_producto": 6.5
   }
   ```
2. **Metas de Venta (`GET /api/metas`, `POST /api/metas`)**:
   ```json
   {
     "fecha_inicio": "2026-11-01",
     "fecha_fin": "2026-11-30",
     "monto_objetivo": 5000000
   }
   ```
3. **Registrar Venta (`POST /api/ventas`)**:
   ```json
   {
     "id_vendedor": "TRAB001",
     "id_meta": 1,
     "items": [
       { "codigo_producto": 1001, "cantidad": 2, "precio_unitario": 45000 }
     ]
   }
   ```
   > Calcula automáticamente `subtotal`, actualiza `monto_total` de la venta y recalcula el progreso (`monto_actual` y `estado`) de la meta asociada.
4. **Consultar Comisiones Art. 22 (`GET /api/comisiones/art22`)**: devuelve sueldo base, total vendido, comisión calculada por producto y remuneración total estimada.

---

## 6. Reportes PDF, Programación y Correos

- **Descargar PDF de Puntualidad:** `GET /api/reportes/puntualidad/pdf?mes=11&anio=2026&tolerancia=5` *(en Postman usar **Send and Download**)*.
- **Descargar PDF de Comisiones Art. 22:** `GET /api/reportes/comisiones-art22/pdf`.
- **Enviar reporte por correo manualmente:** `POST /api/reportes/puntualidad/enviar` con `{ "email_admin": "rrhh@empresa.cl", "tolerancia": 5 }`.
- **Configurar envío automático (`GET` / `PUT /api/reportes/programacion`)**:
  ```json
  {
    "activo": true,
    "frecuencia": "DIARIO",
    "horaEjecucion": "18:30",
    "emailAdmin": "rrhh@empresa.cl",
    "toleranciaMinutos": 5
  }
  ```
- **Auditoría y reenvío de comprobantes:** `GET /api/correos/logs` y `POST /api/correos/reenviar/:idMarca`.
