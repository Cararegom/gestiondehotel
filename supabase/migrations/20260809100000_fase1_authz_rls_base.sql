-- Fase 1 / 01: base de autorizacion y RLS multi-hotel.
-- Dependencias: usuarios, roles, permisos, usuarios_roles, roles_permisos.
-- Riesgo: policies incorrectas pueden bloquear clientes; aplicar primero en branch/staging.
-- Rollback logico: restaurar policies anteriores desde baseline; no modifica historicos.
-- Tests: fase1-security-migrations.test.cjs y pruebas multi-hotel de 14-pruebas-fase1.md.

INSERT INTO public.permisos (nombre, descripcion)
SELECT v.nombre, v.descripcion
FROM (VALUES
  ('finanzas.ver', 'Consultar finanzas del hotel asignado'),
  ('finanzas.revertir', 'Crear reversiones financieras auditadas'),
  ('finanzas.cerrar_turno', 'Cerrar turnos y persistir arqueos'),
  ('inventario.ajustar', 'Realizar ajustes de inventario auditados'),
  ('tienda.operar', 'Procesar ventas de tienda'),
  ('restaurante.operar', 'Procesar ventas de restaurante')
) AS v(nombre, descripcion)
WHERE NOT EXISTS (SELECT 1 FROM public.permisos p WHERE p.nombre = v.nombre);

INSERT INTO public.roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permisos p ON p.nombre = ANY (
  CASE lower(r.nombre)
    WHEN 'administrador' THEN ARRAY['finanzas.ver','finanzas.revertir','finanzas.cerrar_turno','inventario.ajustar','tienda.operar','restaurante.operar']::text[]
    WHEN 'recepcionista' THEN ARRAY['finanzas.ver','tienda.operar','restaurante.operar']::text[]
    WHEN 'mesero/a' THEN ARRAY['restaurante.operar']::text[]
    WHEN 'gerente' THEN ARRAY['finanzas.ver','finanzas.revertir','finanzas.cerrar_turno']::text[]
    ELSE ARRAY[]::text[]
  END
)
WHERE NOT EXISTS (
  SELECT 1 FROM public.roles_permisos rp
  WHERE rp.rol_id = r.id AND rp.permiso_id = p.id
);

CREATE OR REPLACE FUNCTION public.fase1_actor_es_miembro_activo(p_hotel_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.usuarios u
    WHERE u.id = auth.uid() AND u.activo IS TRUE
      AND u.hotel_id = p_hotel_id
  );
$$;

CREATE OR REPLACE FUNCTION public.fase1_actor_tiene_permiso(p_hotel_id uuid, p_permiso text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.fase1_actor_es_miembro_activo(p_hotel_id)
    AND COALESCE((
      SELECT up.permitido
      FROM public.usuarios_permisos up
      JOIN public.permisos p ON p.id = up.permiso_id
      WHERE up.usuario_id = auth.uid() AND p.nombre = p_permiso
      LIMIT 1
    ), EXISTS (
      SELECT 1
      FROM public.usuarios_roles ur
      JOIN public.roles_permisos rp ON rp.rol_id = ur.rol_id
      JOIN public.permisos p ON p.id = rp.permiso_id
      WHERE ur.usuario_id = auth.uid()
        AND ur.hotel_id = p_hotel_id
        AND p.nombre = p_permiso
    ));
$$;

REVOKE ALL ON FUNCTION public.fase1_actor_es_miembro_activo(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fase1_actor_tiene_permiso(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fase1_actor_es_miembro_activo(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fase1_actor_tiene_permiso(uuid, text) TO authenticated, service_role;

DO $$
DECLARE v_table text; v_policy record;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'ventas_tienda','detalle_ventas_tienda','productos_tienda','proveedores','movimientos_inventario'
  ] LOOP
    FOR v_policy IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=v_table
    LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_policy.policyname, v_table); END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
  END LOOP;
END $$;

CREATE POLICY fase1_ventas_tienda_select ON public.ventas_tienda FOR SELECT TO authenticated
USING (public.fase1_actor_es_miembro_activo(hotel_id));
CREATE POLICY fase1_ventas_tienda_insert_transition ON public.ventas_tienda FOR INSERT TO authenticated
WITH CHECK (public.fase1_actor_tiene_permiso(hotel_id, 'tienda.operar'));
CREATE POLICY fase1_ventas_tienda_update_transition ON public.ventas_tienda FOR UPDATE TO authenticated
USING (public.fase1_actor_tiene_permiso(hotel_id, 'tienda.operar'))
WITH CHECK (public.fase1_actor_tiene_permiso(hotel_id, 'tienda.operar'));

CREATE POLICY fase1_detalle_tienda_select ON public.detalle_ventas_tienda FOR SELECT TO authenticated
USING (public.fase1_actor_es_miembro_activo(hotel_id) AND EXISTS (
  SELECT 1 FROM public.ventas_tienda v WHERE v.id=venta_id AND v.hotel_id=detalle_ventas_tienda.hotel_id
));
CREATE POLICY fase1_detalle_tienda_insert_transition ON public.detalle_ventas_tienda FOR INSERT TO authenticated
WITH CHECK (public.fase1_actor_tiene_permiso(hotel_id, 'tienda.operar') AND EXISTS (
  SELECT 1 FROM public.ventas_tienda v WHERE v.id=venta_id AND v.hotel_id=detalle_ventas_tienda.hotel_id
));

CREATE POLICY fase1_productos_select ON public.productos_tienda FOR SELECT TO authenticated
USING (public.fase1_actor_es_miembro_activo(hotel_id));
CREATE POLICY fase1_productos_insert_transition ON public.productos_tienda FOR INSERT TO authenticated
WITH CHECK (public.fase1_actor_tiene_permiso(hotel_id, 'tienda.operar'));
CREATE POLICY fase1_productos_update_transition ON public.productos_tienda FOR UPDATE TO authenticated
USING (public.fase1_actor_tiene_permiso(hotel_id, 'tienda.operar')) WITH CHECK (public.fase1_actor_tiene_permiso(hotel_id, 'tienda.operar'));

CREATE POLICY fase1_proveedores_select ON public.proveedores FOR SELECT TO authenticated
USING (public.fase1_actor_es_miembro_activo(hotel_id));
CREATE POLICY fase1_proveedores_insert_transition ON public.proveedores FOR INSERT TO authenticated
WITH CHECK (public.fase1_actor_tiene_permiso(hotel_id, 'tienda.operar'));
CREATE POLICY fase1_proveedores_update_transition ON public.proveedores FOR UPDATE TO authenticated
USING (public.fase1_actor_tiene_permiso(hotel_id, 'tienda.operar')) WITH CHECK (public.fase1_actor_tiene_permiso(hotel_id, 'tienda.operar'));

CREATE POLICY fase1_movimientos_inventario_select ON public.movimientos_inventario FOR SELECT TO authenticated
USING (public.fase1_actor_es_miembro_activo(hotel_id));
CREATE POLICY fase1_movimientos_inventario_insert_transition ON public.movimientos_inventario FOR INSERT TO authenticated
WITH CHECK (public.fase1_actor_tiene_permiso(hotel_id, 'inventario.ajustar') OR public.fase1_actor_tiene_permiso(hotel_id, 'tienda.operar'));

DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['ventas_restaurante','ventas_restaurante_items','ingredientes','platos','platos_recetas','bitacora','log_caja_eliminados','caja_movimientos_eliminados','pagos_cargos']
  LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table); END LOOP;
END $$;

DROP POLICY IF EXISTS fase1_restaurante_select ON public.ventas_restaurante;
CREATE POLICY fase1_restaurante_select ON public.ventas_restaurante FOR SELECT TO authenticated
USING (public.fase1_actor_es_miembro_activo(hotel_id));
DROP POLICY IF EXISTS fase1_restaurante_insert_transition ON public.ventas_restaurante;
CREATE POLICY fase1_restaurante_insert_transition ON public.ventas_restaurante FOR INSERT TO authenticated
WITH CHECK (public.fase1_actor_tiene_permiso(hotel_id, 'restaurante.operar'));

DROP POLICY IF EXISTS fase1_rest_items_select ON public.ventas_restaurante_items;
CREATE POLICY fase1_rest_items_select ON public.ventas_restaurante_items FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.ventas_restaurante v WHERE v.id=venta_id AND public.fase1_actor_es_miembro_activo(v.hotel_id)));
DROP POLICY IF EXISTS fase1_rest_items_insert_transition ON public.ventas_restaurante_items;
CREATE POLICY fase1_rest_items_insert_transition ON public.ventas_restaurante_items FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.ventas_restaurante v WHERE v.id=venta_id AND public.fase1_actor_tiene_permiso(v.hotel_id,'restaurante.operar')));

DROP POLICY IF EXISTS fase1_platos_select ON public.platos;
CREATE POLICY fase1_platos_select ON public.platos FOR SELECT TO authenticated USING (public.fase1_actor_es_miembro_activo(hotel_id));
DROP POLICY IF EXISTS fase1_ingredientes_select ON public.ingredientes;
CREATE POLICY fase1_ingredientes_select ON public.ingredientes FOR SELECT TO authenticated USING (public.fase1_actor_es_miembro_activo(hotel_id));
DROP POLICY IF EXISTS fase1_recetas_select ON public.platos_recetas;
CREATE POLICY fase1_recetas_select ON public.platos_recetas FOR SELECT TO authenticated USING (public.fase1_actor_es_miembro_activo(hotel_id));

DROP POLICY IF EXISTS fase1_bitacora_select ON public.bitacora;
CREATE POLICY fase1_bitacora_select ON public.bitacora FOR SELECT TO authenticated
USING (public.fase1_actor_tiene_permiso(hotel_id,'finanzas.ver'));
DROP POLICY IF EXISTS fase1_log_caja_select ON public.log_caja_eliminados;
CREATE POLICY fase1_log_caja_select ON public.log_caja_eliminados FOR SELECT TO authenticated
USING (public.fase1_actor_tiene_permiso(hotel_id,'finanzas.ver'));
-- caja_movimientos_eliminados no tiene hotel_id confiable: no se expone al cliente.
-- pagos_cargos se opera exclusivamente por RPC en Fase 1: no recibe policy cliente.
