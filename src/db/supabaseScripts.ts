export const SUPABASE_COMPLEMENT_SQL = `-- ============================================================================
-- COMPLEMENTO SUPABASE PARA ESQUEMA JSSP (Realtime, Triggers y RLS)
-- Ejecutar en SQL Editor de Supabase sobre la base estructura_7b0b2863.sql
-- ============================================================================

-- 1. Habilitar publicación Supabase Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public."JSSP_MARCA_ASISTENCIA";
ALTER PUBLICATION supabase_realtime ADD TABLE public."JSSP_ACTA_ASISTENCIA_MENSUAL";
ALTER PUBLICATION supabase_realtime ADD TABLE public."JSSP_META_VENTA";
ALTER PUBLICATION supabase_realtime ADD TABLE public."JSSP_DETALLE_VENTA";
ALTER PUBLICATION supabase_realtime ADD TABLE public."JSSP_VENTA";

-- 2. Vincular trigger de actualización automática de ventas y metas
DROP TRIGGER IF EXISTS trg_actualizar_totales_venta_y_meta ON public."JSSP_DETALLE_VENTA";
CREATE TRIGGER trg_actualizar_totales_venta_y_meta
AFTER INSERT OR UPDATE OR DELETE ON public."JSSP_DETALLE_VENTA"
FOR EACH ROW EXECUTE FUNCTION public.jssp_actualizar_totales_venta_y_meta();

-- 3. Políticas RLS para usuarios autenticados (service_role del backend siempre opera sin bloqueo)
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'JSSP_SUCURSAL',
    'JSSP_TRABAJADOR',
    'JSSP_TRABAJADOR_PRESENCIAL',
    'JSSP_VENDEDOR_TERRENO',
    'JSSP_ACTA_ASISTENCIA_MENSUAL',
    'JSSP_MARCA_ASISTENCIA',
    'JSSP_PRODUCTO',
    'JSSP_META_VENTA',
    'JSSP_VENTA',
    'JSSP_DETALLE_VENTA'
  ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "jssp_auth_select" ON public.%I', tbl);
    EXECUTE format('CREATE POLICY "jssp_auth_select" ON public.%I FOR SELECT TO authenticated USING (true)', tbl);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.jssp_registrar_marca_asistencia(varchar, varchar, varchar) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.jssp_obtener_acta_mensual_admin(numeric, numeric) TO authenticated, service_role;
`;
