-- Las recepcionistas pueden registrar preferencias propias, pero no convertirlas
-- unilateralmente en reglas obligatorias del generador.

DROP POLICY IF EXISTS "horario_solicitudes_insert" ON public.horario_solicitudes;
DROP POLICY IF EXISTS "horario_solicitudes_update" ON public.horario_solicitudes;

CREATE POLICY "horario_solicitudes_insert"
ON public.horario_solicitudes
FOR INSERT TO authenticated
WITH CHECK (
  public.fase1_actor_es_miembro_activo(hotel_id)
  AND (
    public.usuario_actual_es_admin_hotel(hotel_id)
    OR (
      usuario_id = (select auth.uid())
      AND obligatorio IS FALSE
      AND (creado_por IS NULL OR creado_por = (select auth.uid()))
    )
  )
);

CREATE POLICY "horario_solicitudes_update"
ON public.horario_solicitudes
FOR UPDATE TO authenticated
USING (
  public.fase1_actor_es_miembro_activo(hotel_id)
  AND (usuario_id = (select auth.uid()) OR public.usuario_actual_es_admin_hotel(hotel_id))
)
WITH CHECK (
  public.fase1_actor_es_miembro_activo(hotel_id)
  AND (
    public.usuario_actual_es_admin_hotel(hotel_id)
    OR (
      usuario_id = (select auth.uid())
      AND obligatorio IS FALSE
      AND (creado_por IS NULL OR creado_por = (select auth.uid()))
    )
  )
);
