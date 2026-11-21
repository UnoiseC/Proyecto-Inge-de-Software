export const SUPABASE_COMPLEMENT_SQL = `-- ============================================================================
-- COMPLEMENTO SUPABASE PARA ESQUEMA JSSP (Realtime, Triggers y Políticas RLS)
-- Ejecutar en el SQL Editor de su proyecto Supabase después de importar la BD
-- ============================================================================

-- 1. Habilitar Supabase Realtime (sincronización en vivo de asistencia y ventas)
ALTER PUBLICATION supabase_realtime ADD TABLE public."JSSP_MARCA_ASISTENCIA";
ALTER PUBLICATION supabase_realtime ADD TABLE public."JSSP_ACTA_ASISTENCIA_MENSUAL";
ALTER PUBLICATION supabase_realtime ADD TABLE public."JSSP_META_VENTA";
ALTER PUBLICATION supabase_realtime ADD TABLE public."JSSP_DETALLE_VENTA";
ALTER PUBLICATION supabase_realtime ADD TABLE public."JSSP_VENTA";

-- 2. Vincular el trigger de actualización automática de ventas, metas y comisiones
DROP TRIGGER IF EXISTS trg_actualizar_totales_venta_y_meta ON public."JSSP_DETALLE_VENTA";
CREATE TRIGGER trg_actualizar_totales_venta_y_meta
AFTER INSERT OR UPDATE OR DELETE ON public."JSSP_DETALLE_VENTA"
FOR EACH ROW EXECUTE FUNCTION public.jssp_actualizar_totales_venta_y_meta();

-- 3. Políticas RLS de lectura y operación para cliente conectado con Anon Key
-- (Ajuste estas políticas a su modelo de Supabase Auth antes de producción pública)
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
    EXECUTE format('DROP POLICY IF EXISTS "jssp_allow_all_select" ON public.%I', tbl);
    EXECUTE format('CREATE POLICY "jssp_allow_all_select" ON public.%I FOR SELECT USING (true)', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "jssp_allow_all_insert" ON public.%I', tbl);
    EXECUTE format('CREATE POLICY "jssp_allow_all_insert" ON public.%I FOR INSERT WITH CHECK (true)', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "jssp_allow_all_update" ON public.%I', tbl);
    EXECUTE format('CREATE POLICY "jssp_allow_all_update" ON public.%I FOR UPDATE USING (true)', tbl);
  END LOOP;
END $$;

-- 4. Permitir ejecución de funciones RPC para el terminal QR y panel administrador
GRANT EXECUTE ON FUNCTION public.jssp_registrar_marca_asistencia(varchar, varchar, varchar) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jssp_obtener_acta_mensual_admin(numeric, numeric) TO anon, authenticated;
`;

export const SUPABASE_EDGE_FUNCTION_CODE = `// supabase/functions/send-attendance-email/index.ts
// Desplegar con: supabase functions deploy send-attendance-email
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  const { id_marca, id_trabajador, tipo_marca, fecha_hora, id_acta } = await req.json();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: trabajador } = await supabase
    .from("JSSP_TRABAJADOR")
    .select("nombre_trabajador, apellido_trabajador, email_trabajador, rut")
    .eq("id_trabajador", id_trabajador)
    .single();

  if (!trabajador?.email_trabajador) {
    return new Response(JSON.stringify({ error: "Trabajador sin correo" }), { status: 400 });
  }

  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": \`Bearer \${RESEND_API_KEY}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Asistencia JSSP <asistencia@tudominio.cl>",
      to: [trabajador.email_trabajador],
      subject: \`Comprobante de Marcación QR — \${tipo_marca}\`,
      html: \`<h2>Comprobante de Asistencia</h2>
             <p>Hola \${trabajador.nombre_trabajador} \${trabajador.apellido_trabajador},</p>
             <p>Se ha registrado su marcación <strong>\${tipo_marca}</strong> vía QR.</p>
             <p>Acta Mensual: \${id_acta} | Marca #\${id_marca}</p>\`,
    }),
  });

  if (emailRes.ok) {
    await supabase
      .from("JSSP_MARCA_ASISTENCIA")
      .update({ respaldo_email: true })
      .eq("id_marca", id_marca);
  }

  return new Response(JSON.stringify({ ok: emailRes.ok }), {
    headers: { "Content-Type": "application/json" },
  });
});
`;
