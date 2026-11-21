import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type {
  ActaMensualAdminResponse,
  JsspActaAsistenciaMensual,
  JsspDetalleVenta,
  JsspMarcaAsistencia,
  JsspMetaVenta,
  JsspProducto,
  JsspSnapshot,
  JsspSucursal,
  JsspTrabajador,
  JsspTrabajadorPresencial,
  JsspVendedorTerreno,
  JsspVenta,
  RegistrarMarcaResult,
  TipoMarca,
} from '../types/jssp.ts';

export function buildSupabaseClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url.trim(), anonKey.trim(), {
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });
}

export async function fetchSupabaseSnapshot(client: SupabaseClient): Promise<JsspSnapshot> {
  const [
    sucursalesRes,
    trabajadoresRes,
    presencialesRes,
    vendedoresRes,
    actasRes,
    marcasRes,
    productosRes,
    metasRes,
    ventasRes,
    detallesRes,
  ] = await Promise.all([
    client.from('JSSP_SUCURSAL').select('*').order('id_sucursal'),
    client.from('JSSP_TRABAJADOR').select('*').order('apellido_trabajador'),
    client.from('JSSP_TRABAJADOR_PRESENCIAL').select('*'),
    client.from('JSSP_VENDEDOR_TERRENO').select('*'),
    client.from('JSSP_ACTA_ASISTENCIA_MENSUAL').select('*'),
    client.from('JSSP_MARCA_ASISTENCIA').select('*').order('fecha_hora', { ascending: false }).limit(500),
    client.from('JSSP_PRODUCTO').select('*').order('codigo_producto'),
    client.from('JSSP_META_VENTA').select('*').order('fecha_inicio', { ascending: false }),
    client.from('JSSP_VENTA').select('*').order('fecha', { ascending: false }).limit(200),
    client.from('JSSP_DETALLE_VENTA').select('*').order('id_detalle', { ascending: false }).limit(500),
  ]);

  const firstError =
    sucursalesRes.error ||
    trabajadoresRes.error ||
    presencialesRes.error ||
    vendedoresRes.error ||
    actasRes.error ||
    marcasRes.error ||
    productosRes.error ||
    metasRes.error ||
    ventasRes.error ||
    detallesRes.error;

  if (firstError) {
    throw new Error(`Error al leer Supabase: ${firstError.message}`);
  }

  return {
    sucursales: (sucursalesRes.data || []) as JsspSucursal[],
    trabajadores: (trabajadoresRes.data || []) as JsspTrabajador[],
    presenciales: (presencialesRes.data || []) as JsspTrabajadorPresencial[],
    vendedores: (vendedoresRes.data || []) as JsspVendedorTerreno[],
    actas: (actasRes.data || []) as JsspActaAsistenciaMensual[],
    marcas: (marcasRes.data || []) as JsspMarcaAsistencia[],
    productos: (productosRes.data || []) as JsspProducto[],
    metas: (metasRes.data || []) as JsspMetaVenta[],
    ventas: (ventasRes.data || []) as JsspVenta[],
    detallesVenta: (detallesRes.data || []) as JsspDetalleVenta[],
  };
}

export async function fetchSupabaseActaAdmin(
  client: SupabaseClient,
  mes: number,
  anio: number
): Promise<ActaMensualAdminResponse> {
  const { data, error } = await client.rpc('jssp_obtener_acta_mensual_admin', {
    p_mes: mes,
    p_anio: anio,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data as ActaMensualAdminResponse;
}

export async function registrarMarcaSupabase(
  client: SupabaseClient,
  idTrabajador: string,
  tipoMarca: TipoMarca
): Promise<RegistrarMarcaResult> {
  const { data, error } = await client.rpc('jssp_registrar_marca_asistencia', {
    p_id_trabajador: idTrabajador,
    p_tipo_marca: tipoMarca,
    p_metodo_biometrico: 'QR',
  });
  if (error) {
    throw new Error(error.message);
  }
  return data as RegistrarMarcaResult;
}

export async function marcarRespaldoEmailSupabase(
  client: SupabaseClient,
  idMarca: number
): Promise<void> {
  const { error } = await client
    .from('JSSP_MARCA_ASISTENCIA')
    .update({ respaldo_email: true })
    .eq('id_marca', idMarca);
  if (error) {
    throw new Error(error.message);
  }
}

export async function firmarActaSupabase(
  client: SupabaseClient,
  idActa: string,
  estadoFirma: string
): Promise<void> {
  const { error } = await client
    .from('JSSP_ACTA_ASISTENCIA_MENSUAL')
    .update({ estado_firma: estadoFirma })
    .eq('id_acta', idActa);
  if (error) {
    throw new Error(error.message);
  }
}

export async function registrarVentaSupabase(
  client: SupabaseClient,
  payload: {
    id_vendedor: string;
    id_meta: number;
    items: Array<{ codigo_producto: number; cantidad: number; precio_unitario: number }>;
  }
): Promise<void> {
  const montoTotal = payload.items.reduce(
    (sum, item) => sum + item.cantidad * item.precio_unitario,
    0
  );

  const { data: venta, error: ventaErr } = await client
    .from('JSSP_VENTA')
    .insert({
      fecha: new Date().toISOString(),
      monto_total: montoTotal,
    })
    .select('codigo_venta')
    .single();

  if (ventaErr || !venta) {
    throw new Error(ventaErr?.message || 'No se pudo crear la venta en Supabase');
  }

  const detalles = payload.items.map((item) => ({
    id_venta: venta.codigo_venta,
    id_vendedor: payload.id_vendedor,
    codigo_producto: item.codigo_producto,
    id_meta: payload.id_meta,
    cantidad: item.cantidad,
    precio_unitario: item.precio_unitario,
    subtotal: item.cantidad * item.precio_unitario,
  }));

  const { error: detErr } = await client.from('JSSP_DETALLE_VENTA').insert(detalles);
  if (detErr) {
    throw new Error(detErr.message);
  }

  // Fallback recalculation in case trg_actualizar_totales_venta_y_meta wasn't attached yet
  const { data: metaRow } = await client
    .from('JSSP_META_VENTA')
    .select('*')
    .eq('id_meta', payload.id_meta)
    .single();

  if (metaRow) {
    const { data: metaDetails } = await client
      .from('JSSP_DETALLE_VENTA')
      .select('subtotal')
      .eq('id_meta', payload.id_meta);
    const totalMeta = (metaDetails || []).reduce((s, r) => s + Number(r.subtotal || 0), 0);
    const nuevoEstado =
      totalMeta >= Number(metaRow.monto_objetivo || 0)
        ? 'CUMPLIDA'
        : metaRow.fecha_fin && new Date().toISOString().slice(0, 10) > metaRow.fecha_fin
          ? 'NO_CUMPLIDA'
          : 'EN_PROGRESO';
    await client
      .from('JSSP_META_VENTA')
      .update({ monto_actual: totalMeta, estado: nuevoEstado })
      .eq('id_meta', payload.id_meta);
  }
}

export async function crearMetaSupabase(
  client: SupabaseClient,
  payload: { fecha_inicio: string; fecha_fin: string; monto_objetivo: number }
): Promise<void> {
  const { error } = await client.from('JSSP_META_VENTA').insert({
    fecha_inicio: payload.fecha_inicio,
    fecha_fin: payload.fecha_fin || null,
    monto_objetivo: payload.monto_objetivo,
    monto_actual: 0,
    estado: 'EN_PROGRESO',
  });
  if (error) throw new Error(error.message);
}

export async function crearProductoSupabase(
  client: SupabaseClient,
  payload: {
    nombre_producto: string;
    categoria_producto: string;
    porcentaje_comision_producto: number;
  }
): Promise<void> {
  const { error } = await client.from('JSSP_PRODUCTO').insert(payload);
  if (error) throw new Error(error.message);
}

export async function crearTrabajadorSupabase(
  client: SupabaseClient,
  payload: {
    id_trabajador: string;
    rut: string;
    nombre_trabajador: string;
    apellido_trabajador: string;
    email_trabajador: string;
    sueldo_base_trabajador: number;
    id_sucursal: number;
    modalidad: 'PRESENCIAL' | 'ART22';
    rol?: string;
    turno_asignado?: string;
    zona_cobertura?: string;
    es_articulo22?: boolean;
  }
): Promise<void> {
  const { error: errTrab } = await client.from('JSSP_TRABAJADOR').insert({
    id_trabajador: payload.id_trabajador,
    rut: payload.rut,
    nombre_trabajador: payload.nombre_trabajador,
    apellido_trabajador: payload.apellido_trabajador,
    email_trabajador: payload.email_trabajador,
    sueldo_base_trabajador: payload.sueldo_base_trabajador,
    id_sucursal: payload.id_sucursal,
    rol_sistema: 'TRABAJADOR',
  });
  if (errTrab) throw new Error(errTrab.message);

  if (payload.modalidad === 'PRESENCIAL') {
    const { error: errPres } = await client.from('JSSP_TRABAJADOR_PRESENCIAL').insert({
      id_trabajador: payload.id_trabajador,
      rol: payload.rol || 'Operaciones',
      turno_asignado: payload.turno_asignado || '09:00 - 18:00',
    });
    if (errPres) throw new Error(errPres.message);
  } else {
    const { error: errVend } = await client.from('JSSP_VENDEDOR_TERRENO').insert({
      id_trabajador: payload.id_trabajador,
      es_articulo22: payload.es_articulo22 ?? true,
      zona_cobertura: payload.zona_cobertura || 'Región Metropolitana',
    });
    if (errVend) throw new Error(errVend.message);
  }
}

export function subscribeSupabaseRealtime(
  client: SupabaseClient,
  onSync: (table: string, eventType: string) => void,
  onStatus: (status: string) => void
): RealtimeChannel {
  const channel = client
    .channel('jssp-realtime-sync')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'JSSP_MARCA_ASISTENCIA' },
      (payload) => onSync('JSSP_MARCA_ASISTENCIA', payload.eventType)
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'JSSP_ACTA_ASISTENCIA_MENSUAL' },
      (payload) => onSync('JSSP_ACTA_ASISTENCIA_MENSUAL', payload.eventType)
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'JSSP_META_VENTA' },
      (payload) => onSync('JSSP_META_VENTA', payload.eventType)
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'JSSP_DETALLE_VENTA' },
      (payload) => onSync('JSSP_DETALLE_VENTA', payload.eventType)
    )
    .subscribe((status) => {
      onStatus(status);
    });

  return channel;
}
