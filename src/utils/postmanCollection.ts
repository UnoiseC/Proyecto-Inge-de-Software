export function buildPostmanCollection(baseUrl: string) {
  const reqItem = (
    name: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    pathParts: string[],
    options?: {
      body?: unknown;
      query?: Array<{ key: string; value: string }>;
      authHeaders?: boolean;
    }
  ) => {
    const rawQuery = options?.query?.length
      ? `?${options.query.map((q) => `${q.key}=${q.value}`).join('&')}`
      : '';
    const header: Array<{ key: string; value: string }> = [];
    if (options?.body !== undefined) {
      header.push({ key: 'Content-Type', value: 'application/json' });
    }
    if (options?.authHeaders) {
      header.push({ key: 'Authorization', value: 'Bearer {{bearerToken}}' });
    }

    return {
      name,
      request: {
        method,
        header,
        url: {
          raw: `{{baseUrl}}/${pathParts.join('/')}${rawQuery}`,
          host: ['{{baseUrl}}'],
          path: pathParts,
          ...(options?.query ? { query: options.query } : {}),
        },
        ...(options?.body !== undefined
          ? {
              body: {
                mode: 'raw',
                raw: JSON.stringify(options.body, null, 2),
              },
            }
          : {}),
      },
    };
  };

  return {
    info: {
      name: 'JSSP Control — Backend REST API (Supabase PostgreSQL)',
      description:
        'Colección completa para probar todos los endpoints del backend Node.js + Express basado en estructura.sql (Asistencia QR, Actas Art. 33, Metas de Venta, Comisiones Art. 22, Reportes PDF y Emails).',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    variable: [
      { key: 'baseUrl', value: baseUrl },
      { key: 'bearerToken', value: '' },
      { key: 'apiKey', value: '' },
    ],
    item: [
      {
        name: '01. Sistema & Realtime',
        item: [
          reqItem('Healthcheck & Estado DB', 'GET', ['api', 'health']),
          reqItem('Catálogo de Endpoints', 'GET', ['api']),
          reqItem('Script Complementario Supabase SQL', 'GET', ['api', 'supabase', 'complement-sql']),
          reqItem('Descargar Colección Postman', 'GET', ['api', 'postman-collection']),
        ],
      },
      {
        name: '02. Autenticación Supabase',
        item: [
          reqItem('Login (Email + Password Supabase Auth)', 'POST', ['api', 'auth', 'login'], {
            body: { email: 'admin@empresa-jssp.cl', password: 'PasswordSeguro123!' },
          }),
          reqItem('Perfil Usuario Autenticado', 'GET', ['api', 'auth', 'me'], { authHeaders: true }),
        ],
      },
      {
        name: '03. Sucursales (JSSP_SUCURSAL)',
        item: [
          reqItem('Listar Sucursales', 'GET', ['api', 'sucursales']),
          reqItem('Obtener Sucursal por ID', 'GET', ['api', 'sucursales', '1']),
          reqItem('Crear Sucursal', 'POST', ['api', 'sucursales'], {
            body: {
              nombre_sucursal: 'Sucursal Viña del Mar',
              tipo_sucursal: 'Comercial',
              dirección_sucursal: 'Av. Libertad 1240, Viña del Mar',
            },
          }),
          reqItem('Actualizar Sucursal', 'PUT', ['api', 'sucursales', '1'], {
            body: { tipo_sucursal: 'Corporativa Central' },
          }),
        ],
      },
      {
        name: '04. Trabajadores (Presenciales y Art. 22)',
        item: [
          reqItem('Listar Todos los Trabajadores', 'GET', ['api', 'trabajadores']),
          reqItem('Filtrar Trabajadores Presenciales', 'GET', ['api', 'trabajadores'], {
            query: [{ key: 'modalidad', value: 'PRESENCIAL' }],
          }),
          reqItem('Crear Trabajador Presencial', 'POST', ['api', 'trabajadores'], {
            body: {
              id_trabajador: 'TRAB-010',
              rut: '19.876.543-2',
              nombre_trabajador: 'Javiera',
              apellido_trabajador: 'Muñoz',
              email_trabajador: 'javiera.munoz@empresa-jssp.cl',
              sueldo_base_trabajador: 980000,
              id_sucursal: 1,
              modalidad: 'PRESENCIAL',
              rol: 'Analista RRHH',
              turno_asignado: '09:00 - 18:00',
            },
          }),
          reqItem('Crear Vendedor Terreno Art. 22', 'POST', ['api', 'trabajadores'], {
            body: {
              id_trabajador: 'VEND-010',
              rut: '17.445.882-K',
              nombre_trabajador: 'Rodrigo',
              apellido_trabajador: 'Paredes',
              email_trabajador: 'rodrigo.paredes@empresa-jssp.cl',
              sueldo_base_trabajador: 1150000,
              id_sucursal: 2,
              modalidad: 'ART22',
              es_articulo22: true,
              zona_cobertura: 'Zona Centro-Sur',
            },
          }),
        ],
      },
      {
        name: '05. Asistencia QR, Puntualidad y Actas Mensuales',
        item: [
          reqItem('Generar Credencial QR (JSON + DataURL)', 'GET', ['api', 'asistencia', 'qr', 'TRAB-001'], {
            query: [{ key: 'format', value: 'json' }],
          }),
          reqItem('Descargar Credencial QR (PNG Binario)', 'GET', ['api', 'asistencia', 'qr', 'TRAB-001']),
          reqItem('Registrar Marca QR (ENTRADA)', 'POST', ['api', 'asistencia', 'marcar'], {
            body: {
              id_trabajador: 'TRAB-001',
              tipo_marca: 'ENTRADA',
              metodo_biometrico: 'QR',
            },
          }),
          reqItem('Registrar Marca QR (SALIDA)', 'POST', ['api', 'asistencia', 'marcar'], {
            body: {
              id_trabajador: 'TRAB-001',
              tipo_marca: 'SALIDA',
              metodo_biometrico: 'QR',
            },
          }),
          reqItem('Listar Marcas de Asistencia', 'GET', ['api', 'asistencia', 'marcas']),
          reqItem('Análisis de Puntualidad', 'GET', ['api', 'asistencia', 'puntualidad'], {
            query: [{ key: 'tolerancia', value: '5' }],
          }),
          reqItem('Acta Mensual Consolidada Admin (RPC)', 'GET', ['api', 'actas', 'admin']),
          reqItem('Firmar Acta Mensual', 'PATCH', ['api', 'actas', 'ACTA-2026-11-TRAB-001', 'firmar'], {
            body: { estado_firma: 'FIRMADA' },
          }),
        ],
      },
      {
        name: '06. Productos, Metas, Ventas y Comisiones Art. 22',
        item: [
          reqItem('Listar Productos', 'GET', ['api', 'productos']),
          reqItem('Crear Producto', 'POST', ['api', 'productos'], {
            body: {
              nombre_producto: 'Módulo Control Acceso Facial',
              categoria_producto: 'Hardware',
              porcentaje_comision_producto: 7.5,
            },
          }),
          reqItem('Listar Metas de Venta', 'GET', ['api', 'metas']),
          reqItem('Crear Meta de Venta', 'POST', ['api', 'metas'], {
            body: {
              fecha_inicio: '2026-11-01',
              fecha_fin: '2026-11-30',
              monto_objetivo: 15000000,
            },
          }),
          reqItem('Registrar Venta (Trigger subtotal y meta)', 'POST', ['api', 'ventas'], {
            body: {
              id_vendedor: 'VEND-001',
              id_meta: 1,
              items: [
                { codigo_producto: 101, cantidad: 2, precio_unitario: 1850000 },
                { codigo_producto: 103, cantidad: 1, precio_unitario: 1450000 },
              ],
            },
          }),
          reqItem('Liquidación Comisiones Art. 22', 'GET', ['api', 'comisiones', 'art22']),
        ],
      },
      {
        name: '07. Reportes PDF, Programación y Correos',
        item: [
          reqItem('Descargar PDF Puntualidad', 'GET', ['api', 'reportes', 'puntualidad', 'pdf']),
          reqItem('Descargar PDF Comisiones Art. 22', 'GET', ['api', 'reportes', 'comisiones-art22', 'pdf']),
          reqItem('Enviar Reporte Puntualidad por Email', 'POST', ['api', 'reportes', 'puntualidad', 'enviar'], {
            body: { email_admin: 'rrhh-admin@empresa-jssp.cl', tolerancia: 5 },
          }),
          reqItem('Ver Programación Envío Automático', 'GET', ['api', 'reportes', 'programacion']),
          reqItem('Actualizar Programación Envío Automático', 'PUT', ['api', 'reportes', 'programacion'], {
            body: {
              activo: true,
              frecuencia: 'DIARIO',
              horaEjecucion: '18:30',
              emailAdmin: 'rrhh-admin@empresa-jssp.cl',
              toleranciaMinutos: 5,
            },
          }),
          reqItem('Logs de Correos de Respaldo', 'GET', ['api', 'correos', 'logs']),
          reqItem('Reenviar Comprobante por ID de Marca', 'POST', ['api', 'correos', 'reenviar', '1']),
        ],
      },
    ],
  };
}
