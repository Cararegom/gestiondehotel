-- Las tarifas operativas deben ser legibles por los usuarios del hotel,
-- pero solo un administrador puede modificar precios o reglas.

DROP POLICY IF EXISTS tarifas_programadas_insert_hotel
  ON public.tarifas_programadas_habitacion;
DROP POLICY IF EXISTS tarifas_programadas_update_hotel
  ON public.tarifas_programadas_habitacion;
DROP POLICY IF EXISTS tarifas_programadas_delete_hotel
  ON public.tarifas_programadas_habitacion;

CREATE POLICY tarifas_programadas_insert_admin
ON public.tarifas_programadas_habitacion
FOR INSERT
TO authenticated
WITH CHECK (
  public.usuario_actual_es_admin_hotel(hotel_id)
  AND (creada_por IS NULL OR creada_por = (SELECT auth.uid()))
);

CREATE POLICY tarifas_programadas_update_admin
ON public.tarifas_programadas_habitacion
FOR UPDATE
TO authenticated
USING (
  public.usuario_actual_es_admin_hotel(hotel_id)
)
WITH CHECK (
  public.usuario_actual_es_admin_hotel(hotel_id)
);

CREATE POLICY tarifas_programadas_delete_admin
ON public.tarifas_programadas_habitacion
FOR DELETE
TO authenticated
USING (
  public.usuario_actual_es_admin_hotel(hotel_id)
);

COMMENT ON TABLE public.tarifas_programadas_habitacion IS
'Tarifas programadas opcionales por día/fecha. Lectura para miembros del hotel; creación, edición y eliminación solo para administradores. No sustituyen los precios base.';
