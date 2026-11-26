export type TipoMarca = 'ENTRADA' | 'SALIDA';
export type MetodoBiometrico = 'QR' | 'HUELLA';
export type EstadoFirmaActa = 'PENDIENTE' | 'FIRMADA' | 'SIN_MARCAS';
export type EstadoMetaVenta = 'EN_PROGRESO' | 'CUMPLIDA' | 'NO_CUMPLIDA';
export type ModalidadTrabajador = 'PRESENCIAL' | 'ART22' | 'GENERAL';

export interface JsspSucursal {
  id_sucursal: number;
  nombre_sucursal: string;
  tipo_sucursal: string | null;
  dirección_sucursal: string | null;
}

export interface JsspTrabajador {
  id_trabajador: string;
  rut: string;
  nombre_trabajador: string;
  apellido_trabajador: string;
  email_trabajador: string;
  sueldo_base_trabajador: number;
  id_sucursal: number;
  auth_user_id?: string | null;
  rol_sistema: string;
}

export interface JsspTrabajadorPresencial {
  id_trabajador: string;
  rol: string;
  turno_asignado: string | null;
}

export interface JsspVendedorTerreno {
  id_trabajador: string;
  es_articulo22: boolean;
  zona_cobertura: string | null;
}

export interface TrabajadorCompleto extends JsspTrabajador {
  modalidad: ModalidadTrabajador;
  presencial: JsspTrabajadorPresencial | null;
  vendedor: JsspVendedorTerreno | null;
  sucursal: JsspSucursal | null;
}

export interface JsspActaAsistenciaMensual {
  id_acta: string;
  mes: number;
  año: number;
  total_dias_trabajados: number;
  estado_firma: EstadoFirmaActa | string;
  id_trabajador: string;
  fecha_generacion: string;
}

export interface JsspMarcaAsistencia {
  id_marca: number;
  id_trabajador_presencial: string;
  fecha_hora: string;
  tipo_marca: TipoMarca;
  metodo_biometrico: string;
  respaldo_email: boolean;
  id_acta: string;
}

export interface JsspProducto {
  codigo_producto: number;
  nombre_producto: string;
  categoria_producto: string | null;
  porcentaje_comision_producto: number;
}

export interface JsspMetaVenta {
  id_meta: number;
  fecha_inicio: string;
  fecha_fin: string | null;
  monto_objetivo: number;
  monto_actual: number;
  estado: EstadoMetaVenta | string;
}

export interface JsspVenta {
  codigo_venta: number;
  fecha: string;
  monto_total: number;
}

export interface JsspDetalleVenta {
  id_detalle: number;
  id_venta: number;
  id_vendedor: string;
  codigo_producto: number;
  id_meta: number;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
}

export interface ActaMarcaItem {
  id_marca: number;
  fecha_hora_local: string;
  tipo_marca: TipoMarca;
  metodo_biometrico: string;
  respaldo_email: boolean;
}

export interface AsistenciaPresencialRow {
  id_trabajador: string;
  rut: string;
  nombre_completo: string;
  email_trabajador?: string;
  nombre_sucursal: string;
  rol: string;
  turno_asignado: string;
  id_acta: string;
  total_dias_trabajados: number;
  estado_firma: string;
  marcas: ActaMarcaItem[];
}

export interface DetalleVendedorMeta {
  id_trabajador: string;
  vendedor: string;
  zona_cobertura: string;
  es_articulo22: boolean;
  sueldo_base_trabajador?: number;
  cantidad_ventas: number;
  total_vendido_meta: number;
  comision_estimada: number;
}

export interface MetaVentaConsolidada {
  id_meta: number;
  fecha_inicio: string;
  fecha_fin: string | null;
  monto_objetivo: number;
  monto_actual: number;
  porcentaje_cumplimiento: number;
  estado: string;
  detalle_vendedores: DetalleVendedorMeta[];
}

export interface ActaMensualAdminResponse {
  periodo: { mes: number; anio: number };
  fecha_emision: string;
  asistencia_presencial: AsistenciaPresencialRow[];
  metas_venta: MetaVentaConsolidada[];
}

export interface ComisionArt22Resumen {
  id_trabajador: string;
  rut: string;
  nombre_completo: string;
  email_trabajador: string;
  zona_cobertura: string;
  es_articulo22: boolean;
  sueldo_base_trabajador: number;
  cantidad_ventas: number;
  total_vendido: number;
  comision_calculada: number;
  remuneracion_total_estimada: number;
}

export interface EmailLogRow {
  id: string;
  id_marca: number;
  id_trabajador: string;
  nombre_completo: string;
  email_trabajador: string;
  tipo_marca: TipoMarca;
  fecha_hora_local: string;
  id_acta: string;
  sent: boolean;
  mode: 'resend' | 'smtp' | 'preview';
  messageId: string;
  previewHtml: string;
  timestamp: string;
}

export interface ScheduleConfig {
  activo: boolean;
  frecuencia: 'DIARIO' | 'SEMANAL' | 'MENSUAL';
  horaEjecucion: string;
  emailAdmin: string;
  toleranciaMinutos: number;
  ultimoEnvio?: string;
}

export interface JsspSnapshot {
  sucursales: JsspSucursal[];
  trabajadores: JsspTrabajador[];
  presenciales: JsspTrabajadorPresencial[];
  vendedores: JsspVendedorTerreno[];
  actas: JsspActaAsistenciaMensual[];
  marcas: JsspMarcaAsistencia[];
  productos: JsspProducto[];
  metas: JsspMetaVenta[];
  ventas: JsspVenta[];
  detallesVenta: JsspDetalleVenta[];
  emailLogs: EmailLogRow[];
  schedule: ScheduleConfig;
}
