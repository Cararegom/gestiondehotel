-- Control de energia por QR, aislado por hotel y desactivado por defecto.
ALTER TABLE public.configuracion_hotel
  ADD COLUMN IF NOT EXISTS energy_control_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS energy_check_timeout_minutes integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS energy_email_notifications_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS energy_alert_emails text;

ALTER TABLE public.configuracion_hotel
  DROP CONSTRAINT IF EXISTS configuracion_hotel_energy_timeout_check;
ALTER TABLE public.configuracion_hotel
  ADD CONSTRAINT configuracion_hotel_energy_timeout_check
  CHECK (energy_check_timeout_minutes BETWEEN 1 AND 1440);

ALTER TABLE public.habitaciones
  ADD COLUMN IF NOT EXISTS energy_qr_token uuid,
  ADD COLUMN IF NOT EXISTS energy_qr_created_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS habitaciones_energy_qr_token_uidx
  ON public.habitaciones (energy_qr_token) WHERE energy_qr_token IS NOT NULL;

DO $$ BEGIN
  CREATE TYPE public.energy_check_status AS ENUM ('pending', 'completed', 'overdue', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.room_energy_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE CASCADE,
  room_id uuid NOT NULL REFERENCES public.habitaciones(id) ON DELETE CASCADE,
  source_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  source_user_role text,
  source_movement jsonb NOT NULL DEFAULT '{}'::jsonb,
  status public.energy_check_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NOT NULL,
  scanned_at timestamptz,
  completed_at timestamptz,
  completed_by_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  completed_by_role text,
  overdue_at timestamptz,
  admin_alert_sent_at timestamptz,
  admin_alert_status text,
  cancelled_at timestamptz,
  cancelled_by_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  cancellation_reason text,
  CONSTRAINT room_energy_checks_cancellation_reason CHECK
    (status <> 'cancelled' OR length(trim(cancellation_reason)) >= 3)
);
CREATE UNIQUE INDEX IF NOT EXISTS room_energy_checks_one_open_per_room
  ON public.room_energy_checks(room_id) WHERE status IN ('pending', 'overdue');
CREATE INDEX IF NOT EXISTS room_energy_checks_hotel_created_idx
  ON public.room_energy_checks(hotel_id, created_at DESC);

ALTER TABLE public.room_energy_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS room_energy_checks_tenant_select ON public.room_energy_checks;
CREATE POLICY room_energy_checks_tenant_select ON public.room_energy_checks FOR SELECT
USING (hotel_id = public.get_my_hotel_id());

CREATE OR REPLACE FUNCTION public.energy_actor_allowed(p_admin_only boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios u
    WHERE u.id = auth.uid() AND u.activo = true
      AND (CASE WHEN p_admin_only THEN lower(u.rol) IN ('admin','administrador')
                ELSE lower(u.rol) IN ('admin','administrador','recepcionista','camarera','mantenimiento') END)
  );
$$;

CREATE OR REPLACE FUNCTION public.create_energy_check_on_cleaning()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_cfg public.configuracion_hotel%ROWTYPE; v_user public.usuarios%ROWTYPE;
BEGIN
  IF NEW.estado = 'limpieza' AND OLD.estado IS DISTINCT FROM 'limpieza' THEN
    SELECT * INTO v_cfg FROM public.configuracion_hotel WHERE hotel_id=NEW.hotel_id;
    IF coalesce(v_cfg.energy_control_enabled,false) THEN
      SELECT * INTO v_user FROM public.usuarios WHERE id=auth.uid();
      INSERT INTO public.room_energy_checks
        (hotel_id,room_id,source_user_id,source_user_role,source_movement,due_at)
      VALUES (NEW.hotel_id,NEW.id,auth.uid(),v_user.rol,
        jsonb_build_object('from',OLD.estado,'to',NEW.estado),
        now() + make_interval(mins => v_cfg.energy_check_timeout_minutes))
      ON CONFLICT (room_id) WHERE status IN ('pending','overdue') DO NOTHING;
    END IF;
  END IF;
  IF OLD.estado='limpieza' AND NEW.estado='libre' AND EXISTS (
    SELECT 1 FROM public.configuracion_hotel c WHERE c.hotel_id=NEW.hotel_id AND c.energy_control_enabled
  ) AND EXISTS (
    SELECT 1 FROM public.room_energy_checks e WHERE e.room_id=NEW.id AND e.status IN ('pending','overdue')
  ) THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='CONTROL_ENERGIA_PENDIENTE'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS habitaciones_energy_check_trigger ON public.habitaciones;
CREATE TRIGGER habitaciones_energy_check_trigger BEFORE UPDATE OF estado ON public.habitaciones
FOR EACH ROW EXECUTE FUNCTION public.create_energy_check_on_cleaning();

CREATE OR REPLACE FUNCTION public.energy_scan(p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user public.usuarios%ROWTYPE; v_room public.habitaciones%ROWTYPE; v_check public.room_energy_checks%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM public.usuarios WHERE id=auth.uid() AND activo=true;
  IF v_user.id IS NULL OR NOT public.energy_actor_allowed(false) THEN RAISE EXCEPTION 'NO_AUTORIZADO'; END IF;
  SELECT h.* INTO v_room FROM public.habitaciones h JOIN public.configuracion_hotel c ON c.hotel_id=h.hotel_id
   WHERE h.energy_qr_token=p_token AND h.hotel_id=v_user.hotel_id AND c.energy_control_enabled;
  IF v_room.id IS NULL THEN RAISE EXCEPTION 'QR_INVALIDO'; END IF;
  SELECT * INTO v_check FROM public.room_energy_checks WHERE room_id=v_room.id AND status IN ('pending','overdue') ORDER BY created_at DESC LIMIT 1;
  IF v_check.id IS NULL THEN RAISE EXCEPTION 'SIN_CONTROL_PENDIENTE'; END IF;
  UPDATE public.room_energy_checks SET scanned_at=coalesce(scanned_at,now()) WHERE id=v_check.id;
  RETURN jsonb_build_object('check_id',v_check.id,'room_name',v_room.nombre,'created_at',v_check.created_at,'due_at',v_check.due_at);
END $$;

CREATE OR REPLACE FUNCTION public.energy_confirm(p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user public.usuarios%ROWTYPE; v_room public.habitaciones%ROWTYPE; v_check public.room_energy_checks%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM public.usuarios WHERE id=auth.uid() AND activo=true;
  IF v_user.id IS NULL OR NOT public.energy_actor_allowed(false) THEN RAISE EXCEPTION 'NO_AUTORIZADO'; END IF;
  SELECT h.* INTO v_room FROM public.habitaciones h JOIN public.configuracion_hotel c ON c.hotel_id=h.hotel_id
   WHERE h.energy_qr_token=p_token AND h.hotel_id=v_user.hotel_id AND c.energy_control_enabled;
  IF v_room.id IS NULL THEN RAISE EXCEPTION 'QR_INVALIDO'; END IF;
  SELECT * INTO v_check FROM public.room_energy_checks WHERE room_id=v_room.id AND status IN ('pending','overdue') ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF v_check.id IS NULL THEN RAISE EXCEPTION 'SIN_CONTROL_PENDIENTE'; END IF;
  UPDATE public.room_energy_checks SET status='completed', scanned_at=coalesce(scanned_at,now()), completed_at=now(),
    completed_by_user_id=auth.uid(), completed_by_role=v_user.rol WHERE id=v_check.id AND status IN ('pending','overdue');
  INSERT INTO public.notificaciones(hotel_id,rol_destino,tipo,mensaje,entidad_tipo,entidad_id)
    VALUES(v_room.hotel_id,'recepcionista','general_info',coalesce(v_user.nombre,'Un usuario')||' realizo Control de Energia en habitacion '||v_room.nombre||'.','energy_check',v_check.id);
  RETURN jsonb_build_object('completed',true,'check_id',v_check.id,'room_name',v_room.nombre,'completed_at',now());
END $$;

CREATE OR REPLACE FUNCTION public.energy_regenerate_qr(p_room_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_token uuid:=gen_random_uuid(); v_hotel uuid;
BEGIN
  SELECT hotel_id INTO v_hotel FROM public.habitaciones WHERE id=p_room_id;
  IF NOT public.energy_actor_allowed(true) OR v_hotel<>public.get_my_hotel_id() OR NOT EXISTS
    (SELECT 1 FROM public.configuracion_hotel WHERE hotel_id=v_hotel AND energy_control_enabled) THEN RAISE EXCEPTION 'NO_AUTORIZADO'; END IF;
  UPDATE public.habitaciones SET energy_qr_token=v_token,energy_qr_created_at=now() WHERE id=p_room_id;
  RETURN v_token;
END $$;

CREATE OR REPLACE FUNCTION public.energy_cancel(p_check_id uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.energy_actor_allowed(true) OR length(trim(coalesce(p_reason,'')))<3 THEN RAISE EXCEPTION 'MOTIVO_REQUERIDO'; END IF;
 UPDATE public.room_energy_checks SET status='cancelled',cancelled_at=now(),cancelled_by_user_id=auth.uid(),cancellation_reason=trim(p_reason)
 WHERE id=p_check_id AND hotel_id=public.get_my_hotel_id() AND status IN ('pending','overdue');
END $$;
GRANT EXECUTE ON FUNCTION public.energy_scan(uuid),public.energy_confirm(uuid),public.energy_regenerate_qr(uuid),public.energy_cancel(uuid,text) TO authenticated;

-- El nombre solo se usa una vez para resolver el tenant piloto; la aplicacion usa la bandera persistida.
INSERT INTO public.configuracion_hotel(hotel_id,energy_control_enabled)
SELECT id,true FROM public.hoteles WHERE lower(trim(nombre))='marena san isidro'
ON CONFLICT (hotel_id) DO UPDATE SET energy_control_enabled=true;
