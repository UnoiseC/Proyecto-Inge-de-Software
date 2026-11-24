--
-- PostgreSQL database dump
--

\restrict t199595wYTXzMxXoGgPPWgITY4HpvskMiGPd3ubZgbzDPx8Se0gx6oosZfcT24z

-- Dumped from database version 17.11
-- Dumped by pg_dump version 19.0

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: jssp_actualizar_totales_venta_y_meta(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.jssp_actualizar_totales_venta_y_meta() RETURNS trigger
    LANGUAGE plpgsql
    AS $$DECLARE
  v_id_venta integer;
  v_id_meta integer;
BEGIN
  -- 1. Recalcular monto_total de la venta afectada
  v_id_venta := COALESCE(NEW.id_venta, OLD.id_venta);
  IF v_id_venta IS NOT NULL THEN
    UPDATE public."JSSP_VENTA" v
    SET monto_total = COALESCE((
      SELECT SUM(subtotal) FROM public."JSSP_DETALLE_VENTA" WHERE id_venta = v_id_venta
    ), 0)
    WHERE v.codigo_venta = v_id_venta;
  END IF;

  -- 2. Recalcular monto_actual y estado de la meta afectada
  v_id_meta := COALESCE(NEW.id_meta, OLD.id_meta);
  IF v_id_meta IS NOT NULL THEN
    UPDATE public."JSSP_META_VENTA" m
    SET 
      monto_actual = COALESCE((
        SELECT SUM(subtotal) FROM public."JSSP_DETALLE_VENTA" WHERE id_meta = v_id_meta
      ), 0),
      estado = CASE
        WHEN COALESCE((SELECT SUM(subtotal) FROM public."JSSP_DETALLE_VENTA" WHERE id_meta = v_id_meta), 0) >= COALESCE(m.monto_objetivo, 0)
          THEN 'CUMPLIDA'
        WHEN CURRENT_DATE > m.fecha_fin
          THEN 'NO_CUMPLIDA'
        ELSE 'EN_PROGRESO'
      END
    WHERE m.id_meta = v_id_meta;
  END IF;

  RETURN NULL;
END;$$;


--
-- Name: jssp_calcular_subtotal_detalle(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.jssp_calcular_subtotal_detalle() RETURNS trigger
    LANGUAGE plpgsql
    AS $$BEGIN
  NEW.subtotal := COALESCE(NEW.cantidad, 0) * COALESCE(NEW.precio_unitario, 0);
  RETURN NEW;
END;$$;


--
-- Name: jssp_cargar_producto(integer, character varying, character varying, real); Type: PROCEDURE; Schema: public; Owner: -
--

CREATE PROCEDURE public.jssp_cargar_producto(IN p_codigo_producto integer, IN p_nombre_producto character varying, IN p_categoria_producto character varying, IN p_porcentaje_comision_producto real)
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public."JSSP_PRODUCTO"
        WHERE codigo_producto = p_codigo_producto
    ) THEN
        RAISE EXCEPTION 'El código de producto ya existe';
    END IF;

    IF p_porcentaje_comision_producto NOT BETWEEN 0 AND 100 THEN
        RAISE EXCEPTION 'La comisión debe estar entre 0 y 100';
    END IF;

    INSERT INTO public."JSSP_PRODUCTO" (
        codigo_producto,
        nombre_producto,
        categoria_producto,
        porcentaje_comision_producto
    )
    VALUES (
        p_codigo_producto,
        p_nombre_producto,
        p_categoria_producto,
        p_porcentaje_comision_producto
    );
END;
$$;


--
-- Name: jssp_nueva_venta(integer, timestamp with time zone, real); Type: PROCEDURE; Schema: public; Owner: -
--

CREATE PROCEDURE public.jssp_nueva_venta(IN p_codigo_venta integer, IN p_fecha timestamp with time zone, IN p_monto_total real)
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public."JSSP_VENTA"
        WHERE codigo_venta = p_codigo_venta
    ) THEN
        RAISE EXCEPTION 'El código de venta ya existe';
    END IF;

    INSERT INTO public."JSSP_VENTA" (
        codigo_venta,
        fecha,
        monto_total
    )
    VALUES (
        p_codigo_venta,
        p_fecha,
        p_monto_total
    );
END;
$$;


--
-- Name: jssp_nuevo_detalle_venta(integer, character varying, integer, integer, numeric, real); Type: PROCEDURE; Schema: public; Owner: -
--

CREATE PROCEDURE public.jssp_nuevo_detalle_venta(IN p_id_venta integer, IN p_id_vendedor character varying, IN p_codigo_producto integer, IN p_id_meta integer, IN p_cantidad numeric, IN p_precio_unitario real)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_subtotal FLOAT4;
BEGIN
    v_subtotal := p_cantidad * p_precio_unitario;

    INSERT INTO public."JSSP_DETALLE_VENTA" (
        id_venta,
        id_vendedor,
        codigo_producto,
        id_meta,
        cantidad,
        precio_unitario,
        subtotal
    )
    VALUES (
        p_id_venta,
        p_id_vendedor,
        p_codigo_producto,
        p_id_meta,
        p_cantidad,
        p_precio_unitario,
        v_subtotal
    );
END;
$$;


--
-- Name: jssp_obtener_acta_mensual_admin(numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.jssp_obtener_acta_mensual_admin(p_mes numeric, p_anio numeric) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$DECLARE
  v_inicio_mes date;
  v_fin_mes date;
  v_asistencia jsonb;
  v_metas jsonb;
BEGIN
  v_inicio_mes := make_date(p_anio::int, p_mes::int, 1);
  v_fin_mes := (v_inicio_mes + interval '1 month - 1 day')::date;

  -- 1. Consolidado de Asistencia de Trabajadores Presenciales
  SELECT COALESCE(jsonb_agg(row_to_json(a)), '[]'::jsonb)
  INTO v_asistencia
  FROM (
    SELECT
      t.id_trabajador,
      t.rut,
      t.nombre_trabajador || ' ' || t.apellido_trabajador AS nombre_completo,
      s.nombre_sucursal,
      tp.rol,
      tp.turno_asignado,
      COALESCE(acta.id_acta, 'SIN_ACTA') AS id_acta,
      COALESCE(acta.total_dias_trabajados, 0) AS total_dias_trabajados,
      COALESCE(acta.estado_firma, 'SIN_MARCAS') AS estado_firma,
      (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'id_marca', m.id_marca,
            'fecha_hora_local', m.fecha_hora AT TIME ZONE 'America/Santiago',
            'tipo_marca', m.tipo_marca,
            'metodo_biometrico', m.metodo_biometrico,
            'respaldo_email', m.respaldo_email
          ) ORDER BY m.fecha_hora
        ), '[]'::jsonb)
        FROM public."JSSP_MARCA_ASISTENCIA" m
        WHERE m.id_acta = acta.id_acta
      ) AS marcas
    FROM public."JSSP_TRABAJADOR_PRESENCIAL" tp
    JOIN public."JSSP_TRABAJADOR" t ON t.id_trabajador = tp.id_trabajador
    LEFT JOIN public."JSSP_SUCURSAL" s ON s.id_sucursal = t.id_sucursal
    LEFT JOIN public."JSSP_ACTA_ASISTENCIA_MENSUAL" acta
      ON acta.id_trabajador = tp.id_trabajador
      AND acta.mes = p_mes
      AND acta."año" = p_anio
    ORDER BY t.apellido_trabajador
  ) a;

  -- 2. Consolidado de Metas de Venta activas en ese mes + desempeño de vendedores
  SELECT COALESCE(jsonb_agg(row_to_json(mv)), '[]'::jsonb)
  INTO v_metas
  FROM (
    SELECT
      m.id_meta,
      m.fecha_inicio,
      m.fecha_fin,
      m.monto_objetivo,
      COALESCE(m.monto_actual, 0) AS monto_actual,
      CASE
        WHEN COALESCE(m.monto_objetivo, 0) > 0
          THEN ROUND((COALESCE(m.monto_actual, 0) / m.monto_objetivo * 100)::numeric, 2)
        ELSE 0
      END AS porcentaje_cumplimiento,
      m.estado,
      (
        SELECT COALESCE(jsonb_agg(row_to_json(vd)), '[]'::jsonb)
        FROM (
          SELECT
            vt.id_trabajador,
            t.nombre_trabajador || ' ' || t.apellido_trabajador AS vendedor,
            vt.zona_cobertura,
            vt.es_articulo22,
            COUNT(DISTINCT dv.id_venta) AS cantidad_ventas,
            COALESCE(SUM(dv.subtotal), 0) AS total_vendido_meta,
            COALESCE(SUM(dv.subtotal * (COALESCE(p.porcentaje_comision_producto, 0) / 100.0)), 0) AS comision_estimada
          FROM public."JSSP_DETALLE_VENTA" dv
          JOIN public."JSSP_VENDEDOR_TERRENO" vt ON vt.id_trabajador = dv.id_vendedor
          JOIN public."JSSP_TRABAJADOR" t ON t.id_trabajador = vt.id_trabajador
          LEFT JOIN public."JSSP_PRODUCTO" p ON p.codigo_producto = dv.codigo_producto
          WHERE dv.id_meta = m.id_meta
          GROUP BY vt.id_trabajador, t.nombre_trabajador, t.apellido_trabajador, vt.zona_cobertura, vt.es_articulo22
        ) vd
      ) AS detalle_vendedores
    FROM public."JSSP_META_VENTA" m
    WHERE m.fecha_inicio <= v_fin_mes
      AND (m.fecha_fin IS NULL OR m.fecha_fin >= v_inicio_mes)
    ORDER BY m.fecha_inicio
  ) mv;

  RETURN jsonb_build_object(
    'periodo', jsonb_build_object('mes', p_mes, 'anio', p_anio),
    'fecha_emision', now() AT TIME ZONE 'America/Santiago',
    'asistencia_presencial', v_asistencia,
    'metas_venta', v_metas
  );
END;$$;


--
-- Name: jssp_registrar_acta_asistencia(character varying, numeric, numeric, numeric, character varying); Type: PROCEDURE; Schema: public; Owner: -
--

CREATE PROCEDURE public.jssp_registrar_acta_asistencia(IN p_id_acta character varying, IN p_mes numeric, IN p_anio numeric, IN p_total_dias_trabajados numeric, IN p_estado_firma character varying)
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO public."JSSP_ACTA_ASISTENCIA_MENSUAL" (
        id_acta,
        mes,
        "año",
        total_dias_trabajados,
        estado_firma
    )
    VALUES (
        p_id_acta,
        p_mes,
        p_anio,
        p_total_dias_trabajados,
        p_estado_firma
    );
END;
$$;


--
-- Name: jssp_registrar_marca_asistencia(character varying, character varying, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.jssp_registrar_marca_asistencia(p_id_trabajador character varying, p_tipo_marca character varying, p_metodo_biometrico character varying DEFAULT 'HUELLA'::character varying) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$DECLARE
  v_ahora_local timestamp;
  v_mes numeric;
  v_anio numeric;
  v_id_acta character varying;
  v_ultima_marca character varying;
  v_id_marca bigint;
  v_dias_trabajados numeric;
BEGIN
  -- Verificar que el trabajador sea presencial
  IF NOT EXISTS (SELECT 1 FROM public."JSSP_TRABAJADOR_PRESENCIAL" WHERE id_trabajador = p_id_trabajador) THEN
    RAISE EXCEPTION 'El trabajador % no está registrado como trabajador presencial.', p_id_trabajador;
  END IF;

  -- Validar secuencia básica (evitar doble entrada)
  SELECT tipo_marca INTO v_ultima_marca
  FROM public."JSSP_MARCA_ASISTENCIA"
  WHERE id_trabajador_presencial = p_id_trabajador
  ORDER BY fecha_hora DESC
  LIMIT 1;

  IF p_tipo_marca = 'ENTRADA' AND v_ultima_marca = 'ENTRADA' THEN
    RAISE EXCEPTION 'Ya existe una ENTRADA activa sin SALIDA previa.';
  END IF;

  -- Obtener mes y año en hora local de Chile
  v_ahora_local := now() AT TIME ZONE 'America/Santiago';
  v_mes := EXTRACT(MONTH FROM v_ahora_local);
  v_anio := EXTRACT(YEAR FROM v_ahora_local);
  v_id_acta := 'ACTA-' || v_anio::text || '-' || LPAD(v_mes::text, 2, '0') || '-' || p_id_trabajador;

  -- Crear el acta del mes si aún no existe
  INSERT INTO public."JSSP_ACTA_ASISTENCIA_MENSUAL" (
    id_acta, id_trabajador, mes, "año", total_dias_trabajados, estado_firma
  )
  VALUES (
    v_id_acta, p_id_trabajador, v_mes, v_anio, 0, 'PENDIENTE'
  )
  ON CONFLICT (id_trabajador, mes, "año") DO NOTHING;

  -- Insertar la marca
  INSERT INTO public."JSSP_MARCA_ASISTENCIA" (
    id_trabajador_presencial,
    fecha_hora,
    tipo_marca,
    metodo_biometrico,
    respaldo_email,
    id_acta
  )
  VALUES (
    p_id_trabajador,
    now(),
    p_tipo_marca,
    p_metodo_biometrico,
    false, -- Se pondrá en true cuando la Edge Function envíe el correo
    v_id_acta
  )
  RETURNING id_marca INTO v_id_marca;

  -- Recalcular días únicos trabajados en ese mes (días con al menos una ENTRADA)
  SELECT COUNT(DISTINCT DATE(fecha_hora AT TIME ZONE 'America/Santiago'))
  INTO v_dias_trabajados
  FROM public."JSSP_MARCA_ASISTENCIA"
  WHERE id_acta = v_id_acta AND tipo_marca = 'ENTRADA';

  UPDATE public."JSSP_ACTA_ASISTENCIA_MENSUAL"
  SET total_dias_trabajados = v_dias_trabajados
  WHERE id_acta = v_id_acta;

  RETURN jsonb_build_object(
    'id_marca', v_id_marca,
    'id_acta', v_id_acta,
    'fecha_hora', now(),
    'tipo_marca', p_tipo_marca,
    'dias_trabajados_mes', v_dias_trabajados
  );
END;$$;


--
-- Name: jssp_registrar_marca_asistencia(character varying, timestamp with time zone, character varying, character varying, boolean, character varying); Type: PROCEDURE; Schema: public; Owner: -
--

CREATE PROCEDURE public.jssp_registrar_marca_asistencia(IN p_id_trabajador_presencial character varying, IN p_fecha_hora timestamp with time zone, IN p_tipo_marca character varying, IN p_metodo_biometrico character varying, IN p_respaldo_email boolean, IN p_id_acta character varying)
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO public."JSSP_MARCA_ASISTENCIA" (
        id_trabajador_presencial,
        fecha_hora,
        tipo_marca,
        metodo_biometrico,
        respaldo_email,
        id_acta
    )
    VALUES (
        p_id_trabajador_presencial,
        p_fecha_hora,
        p_tipo_marca,
        p_metodo_biometrico,
        p_respaldo_email,
        p_id_acta
    );
END;
$$;


--
-- Name: jssp_registrar_meta_venta(date, date, real, real, character varying); Type: PROCEDURE; Schema: public; Owner: -
--

CREATE PROCEDURE public.jssp_registrar_meta_venta(IN p_fecha_inicio date, IN p_fecha_fin date, IN p_monto_objetivo real, IN p_monto_actual real, IN p_estado character varying)
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO public."JSSP_META_VENTA" (
        fecha_inicio,
        fecha_fin,
        monto_objetivo,
        monto_actual,
        estado
    )
    VALUES (
        p_fecha_inicio,
        p_fecha_fin,
        p_monto_objetivo,
        p_monto_actual,
        p_estado
    );
END;
$$;


--
-- Name: jssp_registrar_sucursal(numeric, character varying, character varying, character varying); Type: PROCEDURE; Schema: public; Owner: -
--

CREATE PROCEDURE public.jssp_registrar_sucursal(IN p_id_sucursal numeric, IN p_nombre_sucursal character varying, IN p_tipo_sucursal character varying, IN p_direccion_sucursal character varying)
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO public."JSSP_SUCURSAL" (
        id_sucursal,
        nombre_sucursal,
        tipo_sucursal,
        "dirección_sucursal"
    )
    VALUES (
        p_id_sucursal,
        p_nombre_sucursal,
        p_tipo_sucursal,
        p_direccion_sucursal
    );
END;
$$;


--
-- Name: jssp_registrar_trabajador(character varying, character varying, character varying, character varying, character varying, real, numeric); Type: PROCEDURE; Schema: public; Owner: -
--

CREATE PROCEDURE public.jssp_registrar_trabajador(IN p_id_trabajador character varying, IN p_rut character varying, IN p_nombre_trabajador character varying, IN p_apellido_trabajador character varying, IN p_email_trabajador character varying, IN p_sueldo_base_trabajador real, IN p_id_sucursal numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO public."JSSP_TRABAJADOR" (
        id_trabajador,
        rut,
        nombre_trabajador,
        apellido_trabajador,
        email_trabajador,
        sueldo_base_trabajador,
        id_sucursal
    )
    VALUES (
        p_id_trabajador,
        p_rut,
        p_nombre_trabajador,
        p_apellido_trabajador,
        p_email_trabajador,
        p_sueldo_base_trabajador,
        p_id_sucursal
    );
END;
$$;


--
-- Name: jssp_registrar_trabajador_presencial(character varying, character varying, character varying); Type: PROCEDURE; Schema: public; Owner: -
--

CREATE PROCEDURE public.jssp_registrar_trabajador_presencial(IN p_id_trabajador character varying, IN p_rol character varying, IN p_turno_asignado character varying)
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO public."JSSP_TRABAJADOR_PRESENCIAL" (
        id_trabajador,
        rol,
        turno_asignado
    )
    VALUES (
        p_id_trabajador,
        p_rol,
        p_turno_asignado
    );
END;
$$;


--
-- Name: jssp_registrar_vendedor_terreno(character varying, boolean, character varying); Type: PROCEDURE; Schema: public; Owner: -
--

CREATE PROCEDURE public.jssp_registrar_vendedor_terreno(IN p_id_trabajador character varying, IN p_es_articulo22 boolean, IN p_zona_cobertura character varying)
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO public."JSSP_VENDEDOR_TERRENO" (
        id_trabajador,
        es_articulo22,
        zona_cobertura
    )
    VALUES (
        p_id_trabajador,
        p_es_articulo22,
        p_zona_cobertura
    );
END;
$$;


--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
  tbl name;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        SELECT c.relname INTO tbl FROM pg_catalog.pg_class c WHERE c.oid = cmd.objid;
        EXECUTE format('alter table if exists %I.%I enable row level security', cmd.schema_name, tbl);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: JSSP_ACTA_ASISTENCIA_MENSUAL; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."JSSP_ACTA_ASISTENCIA_MENSUAL" (
    id_acta character varying NOT NULL,
    mes numeric NOT NULL,
    "año" numeric,
    total_dias_trabajados numeric,
    estado_firma character varying,
    id_trabajador character varying,
    fecha_generacion timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE "JSSP_ACTA_ASISTENCIA_MENSUAL"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public."JSSP_ACTA_ASISTENCIA_MENSUAL" IS 'Almacenara el registro como tal de las asistencia de los trabajadores, para poder realizar el acta mensual de asistencia';


--
-- Name: JSSP_DETALLE_VENTA; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."JSSP_DETALLE_VENTA" (
    id_detalle bigint NOT NULL,
    id_venta integer NOT NULL,
    id_vendedor character varying,
    codigo_producto integer,
    id_meta integer,
    cantidad numeric,
    precio_unitario real,
    subtotal real
);


--
-- Name: TABLE "JSSP_DETALLE_VENTA"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public."JSSP_DETALLE_VENTA" IS 'Boleta';


--
-- Name: JSSP_MARCA_ASISTENCIA; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."JSSP_MARCA_ASISTENCIA" (
    id_marca bigint NOT NULL,
    id_trabajador_presencial character varying NOT NULL,
    fecha_hora timestamp with time zone,
    tipo_marca character varying,
    metodo_biometrico character varying,
    respaldo_email boolean,
    id_acta character varying
);


--
-- Name: TABLE "JSSP_MARCA_ASISTENCIA"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public."JSSP_MARCA_ASISTENCIA" IS 'Almacenara informacion de la marca de asistencia con su correspondiente metodo de cada trabajador';


--
-- Name: JSSP_MARCA_ASISTENCIA_id_marca_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."JSSP_MARCA_ASISTENCIA" ALTER COLUMN id_marca ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."JSSP_MARCA_ASISTENCIA_id_marca_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: JSSP_META_VENTA; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."JSSP_META_VENTA" (
    id_meta integer NOT NULL,
    fecha_inicio date NOT NULL,
    fecha_fin date,
    monto_objetivo real,
    monto_actual real,
    estado character varying
);


--
-- Name: TABLE "JSSP_META_VENTA"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public."JSSP_META_VENTA" IS 'Tabla que almacenara informacion sobre el progreso actual del cumplimiento de meta del trabajador';


--
-- Name: JSSP_META_VENTA_id_meta_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."JSSP_META_VENTA" ALTER COLUMN id_meta ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."JSSP_META_VENTA_id_meta_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: JSSP_PRODUCTO; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."JSSP_PRODUCTO" (
    codigo_producto integer NOT NULL,
    nombre_producto character varying NOT NULL,
    categoria_producto character varying,
    porcentaje_comision_producto real
);


--
-- Name: TABLE "JSSP_PRODUCTO"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public."JSSP_PRODUCTO" IS 'Información sobre producto';


--
-- Name: JSSP_PRODUCTO_codigo_producto_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."JSSP_PRODUCTO" ALTER COLUMN codigo_producto ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."JSSP_PRODUCTO_codigo_producto_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: JSSP_SUCURSAL; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."JSSP_SUCURSAL" (
    id_sucursal numeric NOT NULL,
    nombre_sucursal character varying NOT NULL,
    tipo_sucursal character varying,
    "dirección_sucursal" character varying
);


--
-- Name: TABLE "JSSP_SUCURSAL"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public."JSSP_SUCURSAL" IS 'Información de la sucursal';


--
-- Name: JSSP_TRABAJADOR; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."JSSP_TRABAJADOR" (
    id_trabajador character varying NOT NULL,
    rut character varying NOT NULL,
    nombre_trabajador character varying,
    apellido_trabajador character varying,
    email_trabajador character varying,
    sueldo_base_trabajador real,
    id_sucursal numeric,
    auth_user_id uuid,
    rol_sistema character varying DEFAULT 'TRABAJADOR'::character varying
);


--
-- Name: TABLE "JSSP_TRABAJADOR"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public."JSSP_TRABAJADOR" IS 'Almacena datos personales y a la sucursal que pertenece algun trabajador';


--
-- Name: JSSP_TRABAJADOR_PRESENCIAL; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."JSSP_TRABAJADOR_PRESENCIAL" (
    id_trabajador character varying NOT NULL,
    rol character varying NOT NULL,
    turno_asignado character varying
);


--
-- Name: TABLE "JSSP_TRABAJADOR_PRESENCIAL"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public."JSSP_TRABAJADOR_PRESENCIAL" IS 'ALmacenara al trabajador, el rol y su turno correspondiente';


--
-- Name: JSSP_VENDEDOR_TERRENO; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."JSSP_VENDEDOR_TERRENO" (
    id_trabajador character varying NOT NULL,
    es_articulo22 boolean NOT NULL,
    zona_cobertura character varying
);


--
-- Name: JSSP_VENTA; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."JSSP_VENTA" (
    codigo_venta integer NOT NULL,
    fecha timestamp with time zone DEFAULT now() NOT NULL,
    monto_total numeric
);


--
-- Name: TABLE "JSSP_VENTA"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public."JSSP_VENTA" IS 'Información de venta';


--
-- Name: JSSP_VENTA_codigo_venta_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."JSSP_VENTA" ALTER COLUMN codigo_venta ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."JSSP_VENTA_codigo_venta_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: jssp_detalle_venta_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.jssp_detalle_venta_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: jssp_detalle_venta_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.jssp_detalle_venta_id_seq OWNED BY public."JSSP_DETALLE_VENTA".id_detalle;


--
-- Name: JSSP_DETALLE_VENTA id_detalle; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."JSSP_DETALLE_VENTA" ALTER COLUMN id_detalle SET DEFAULT nextval('public.jssp_detalle_venta_id_seq'::regclass);


--
-- Name: JSSP_ACTA_ASISTENCIA_MENSUAL JSSP_ACTA_ASISTENCIA_MENSUAL_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."JSSP_ACTA_ASISTENCIA_MENSUAL"
    ADD CONSTRAINT "JSSP_ACTA_ASISTENCIA_MENSUAL_pkey" PRIMARY KEY (id_acta);


--
-- Name: JSSP_DETALLE_VENTA JSSP_DETALLE_VENTA_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."JSSP_DETALLE_VENTA"
    ADD CONSTRAINT "JSSP_DETALLE_VENTA_pkey" PRIMARY KEY (id_detalle);


--
-- Name: JSSP_MARCA_ASISTENCIA JSSP_MARCA_ASISTENCIA_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."JSSP_MARCA_ASISTENCIA"
    ADD CONSTRAINT "JSSP_MARCA_ASISTENCIA_pkey" PRIMARY KEY (id_marca);


--
-- Name: JSSP_META_VENTA JSSP_META_VENTA_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."JSSP_META_VENTA"
    ADD CONSTRAINT "JSSP_META_VENTA_pkey" PRIMARY KEY (id_meta);


--
-- Name: JSSP_PRODUCTO JSSP_PRODUCTO_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."JSSP_PRODUCTO"
    ADD CONSTRAINT "JSSP_PRODUCTO_pkey" PRIMARY KEY (codigo_producto);


--
-- Name: JSSP_SUCURSAL JSSP_SUCURSAL_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."JSSP_SUCURSAL"
    ADD CONSTRAINT "JSSP_SUCURSAL_pkey" PRIMARY KEY (id_sucursal);


--
-- Name: JSSP_TRABAJADOR_PRESENCIAL JSSP_TRABAJADOR_PRESENCIAL_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."JSSP_TRABAJADOR_PRESENCIAL"
    ADD CONSTRAINT "JSSP_TRABAJADOR_PRESENCIAL_pkey" PRIMARY KEY (id_trabajador);


--
-- Name: JSSP_TRABAJADOR JSSP_TRABAJADOR_auth_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."JSSP_TRABAJADOR"
    ADD CONSTRAINT "JSSP_TRABAJADOR_auth_user_id_key" UNIQUE (auth_user_id);


--
-- Name: JSSP_TRABAJADOR JSSP_TRABAJADOR_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."JSSP_TRABAJADOR"
    ADD CONSTRAINT "JSSP_TRABAJADOR_pkey" PRIMARY KEY (id_trabajador);


--
-- Name: JSSP_VENDEDOR_TERRENO JSSP_VENDEDOR_TERRENO_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."JSSP_VENDEDOR_TERRENO"
    ADD CONSTRAINT "JSSP_VENDEDOR_TERRENO_pkey" PRIMARY KEY (id_trabajador);


--
-- Name: JSSP_VENTA JSSP_VENTA_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."JSSP_VENTA"
    ADD CONSTRAINT "JSSP_VENTA_pkey" PRIMARY KEY (codigo_venta);


--
-- Name: JSSP_ACTA_ASISTENCIA_MENSUAL uq_acta_trabajador_mes_anio; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."JSSP_ACTA_ASISTENCIA_MENSUAL"
    ADD CONSTRAINT uq_acta_trabajador_mes_anio UNIQUE (id_trabajador, mes, "año");


--
-- Name: JSSP_DETALLE_VENTA trg_subtotal_detalle; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_subtotal_detalle BEFORE INSERT OR UPDATE ON public."JSSP_DETALLE_VENTA" FOR EACH ROW EXECUTE FUNCTION public.jssp_calcular_subtotal_detalle();


--
-- Name: JSSP_ACTA_ASISTENCIA_MENSUAL JSSP_ACTA_ASISTENCIA_MENSUAL_id_trabajador_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."JSSP_ACTA_ASISTENCIA_MENSUAL"
    ADD CONSTRAINT "JSSP_ACTA_ASISTENCIA_MENSUAL_id_trabajador_fkey" FOREIGN KEY (id_trabajador) REFERENCES public."JSSP_TRABAJADOR_PRESENCIAL"(id_trabajador) ON DELETE CASCADE;


--
-- Name: JSSP_DETALLE_VENTA JSSP_DETALLE_VENTA_codigo_producto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."JSSP_DETALLE_VENTA"
    ADD CONSTRAINT "JSSP_DETALLE_VENTA_codigo_producto_fkey" FOREIGN KEY (codigo_producto) REFERENCES public."JSSP_PRODUCTO"(codigo_producto);


--
-- Name: JSSP_DETALLE_VENTA JSSP_DETALLE_VENTA_id_meta_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."JSSP_DETALLE_VENTA"
    ADD CONSTRAINT "JSSP_DETALLE_VENTA_id_meta_fkey" FOREIGN KEY (id_meta) REFERENCES public."JSSP_META_VENTA"(id_meta);


--
-- Name: JSSP_DETALLE_VENTA JSSP_DETALLE_VENTA_id_vendedor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."JSSP_DETALLE_VENTA"
    ADD CONSTRAINT "JSSP_DETALLE_VENTA_id_vendedor_fkey" FOREIGN KEY (id_vendedor) REFERENCES public."JSSP_VENDEDOR_TERRENO"(id_trabajador);


--
-- Name: JSSP_DETALLE_VENTA JSSP_DETALLE_VENTA_id_venta_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."JSSP_DETALLE_VENTA"
    ADD CONSTRAINT "JSSP_DETALLE_VENTA_id_venta_fkey" FOREIGN KEY (id_venta) REFERENCES public."JSSP_VENTA"(codigo_venta);


--
-- Name: JSSP_MARCA_ASISTENCIA JSSP_MARCA_ASISTENCIA_id_acta_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."JSSP_MARCA_ASISTENCIA"
    ADD CONSTRAINT "JSSP_MARCA_ASISTENCIA_id_acta_fkey" FOREIGN KEY (id_acta) REFERENCES public."JSSP_ACTA_ASISTENCIA_MENSUAL"(id_acta) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: JSSP_MARCA_ASISTENCIA JSSP_MARCA_ASISTENCIA_id_trabajador_presencial_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."JSSP_MARCA_ASISTENCIA"
    ADD CONSTRAINT "JSSP_MARCA_ASISTENCIA_id_trabajador_presencial_fkey" FOREIGN KEY (id_trabajador_presencial) REFERENCES public."JSSP_TRABAJADOR_PRESENCIAL"(id_trabajador) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: JSSP_TRABAJADOR_PRESENCIAL JSSP_TRABAJADOR_PRESENCIAL_id_trabajador_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."JSSP_TRABAJADOR_PRESENCIAL"
    ADD CONSTRAINT "JSSP_TRABAJADOR_PRESENCIAL_id_trabajador_fkey" FOREIGN KEY (id_trabajador) REFERENCES public."JSSP_TRABAJADOR"(id_trabajador) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: JSSP_TRABAJADOR JSSP_TRABAJADOR_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."JSSP_TRABAJADOR"
    ADD CONSTRAINT "JSSP_TRABAJADOR_auth_user_id_fkey" FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: JSSP_TRABAJADOR JSSP_TRABAJADOR_id_sucursal_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."JSSP_TRABAJADOR"
    ADD CONSTRAINT "JSSP_TRABAJADOR_id_sucursal_fkey" FOREIGN KEY (id_sucursal) REFERENCES public."JSSP_SUCURSAL"(id_sucursal) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: JSSP_VENDEDOR_TERRENO JSSP_VENDEDOR_TERRENO_id_trabajador_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."JSSP_VENDEDOR_TERRENO"
    ADD CONSTRAINT "JSSP_VENDEDOR_TERRENO_id_trabajador_fkey" FOREIGN KEY (id_trabajador) REFERENCES public."JSSP_TRABAJADOR"(id_trabajador) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: JSSP_ACTA_ASISTENCIA_MENSUAL; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."JSSP_ACTA_ASISTENCIA_MENSUAL" ENABLE ROW LEVEL SECURITY;

--
-- Name: JSSP_DETALLE_VENTA; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."JSSP_DETALLE_VENTA" ENABLE ROW LEVEL SECURITY;

--
-- Name: JSSP_MARCA_ASISTENCIA; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."JSSP_MARCA_ASISTENCIA" ENABLE ROW LEVEL SECURITY;

--
-- Name: JSSP_META_VENTA; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."JSSP_META_VENTA" ENABLE ROW LEVEL SECURITY;

--
-- Name: JSSP_PRODUCTO; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."JSSP_PRODUCTO" ENABLE ROW LEVEL SECURITY;

--
-- Name: JSSP_SUCURSAL; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."JSSP_SUCURSAL" ENABLE ROW LEVEL SECURITY;

--
-- Name: JSSP_TRABAJADOR; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."JSSP_TRABAJADOR" ENABLE ROW LEVEL SECURITY;

--
-- Name: JSSP_TRABAJADOR_PRESENCIAL; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."JSSP_TRABAJADOR_PRESENCIAL" ENABLE ROW LEVEL SECURITY;

--
-- Name: JSSP_VENDEDOR_TERRENO; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."JSSP_VENDEDOR_TERRENO" ENABLE ROW LEVEL SECURITY;

--
-- Name: JSSP_VENTA; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."JSSP_VENTA" ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict t199595wYTXzMxXoGgPPWgITY4HpvskMiGPd3ubZgbzDPx8Se0gx6oosZfcT24z

