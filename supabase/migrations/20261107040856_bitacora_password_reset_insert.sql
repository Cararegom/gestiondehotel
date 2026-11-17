-- The browser records this informational event after Auth accepts the recovery email.
-- Keep financial/inventory audit events and all updates/deletes server-only.
ALTER TABLE public.bitacora ENABLE ROW LEVEL SECURITY;
GRANT INSERT (hotel_id, usuario_id, modulo, accion, detalles, creado_en)
  ON public.bitacora TO authenticated;

DROP POLICY IF EXISTS bitacora_password_reset_insert ON public.bitacora;
CREATE POLICY bitacora_password_reset_insert ON public.bitacora
  FOR INSERT TO authenticated
  WITH CHECK (
    usuario_id = (SELECT auth.uid())
    AND public.fase1_actor_es_miembro_activo(hotel_id)
    AND public.usuario_actual_es_admin_hotel(hotel_id)
    AND modulo = 'Usuarios'
    AND accion = 'RESET_PASSWORD_USUARIO'
    AND jsonb_typeof(detalles) = 'object'
    AND detalles @> '{"sensible": true}'::jsonb
  );
