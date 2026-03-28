ALTER TABLE public.configuracion_hotel
  ADD COLUMN IF NOT EXISTS minutos_tolerancia_llegada integer DEFAULT 60,
  ADD COLUMN IF NOT EXISTS minutos_alerta_reserva integer DEFAULT 120,
  ADD COLUMN IF NOT EXISTS minutos_alerta_checkout integer DEFAULT 30;

ALTER TABLE public.configuracion_hotel
  DROP CONSTRAINT IF EXISTS configuracion_hotel_minutos_tolerancia_llegada_check;
ALTER TABLE public.configuracion_hotel
  ADD CONSTRAINT configuracion_hotel_minutos_tolerancia_llegada_check
  CHECK (minutos_tolerancia_llegada >= 0);

ALTER TABLE public.configuracion_hotel
  DROP CONSTRAINT IF EXISTS configuracion_hotel_minutos_alerta_reserva_check;
ALTER TABLE public.configuracion_hotel
  ADD CONSTRAINT configuracion_hotel_minutos_alerta_reserva_check
  CHECK (minutos_alerta_reserva >= 0);

ALTER TABLE public.configuracion_hotel
  DROP CONSTRAINT IF EXISTS configuracion_hotel_minutos_alerta_checkout_check;
ALTER TABLE public.configuracion_hotel
  ADD CONSTRAINT configuracion_hotel_minutos_alerta_checkout_check
  CHECK (minutos_alerta_checkout >= 0);

CREATE TABLE IF NOT EXISTS public.reglas_tarifas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  descripcion text,
  tipo_ajuste text NOT NULL DEFAULT 'porcentaje',
  valor numeric NOT NULL DEFAULT 0,
  fecha_inicio date,
  fecha_fin date,
  dias_semana integer[] DEFAULT ARRAY[]::integer[],
  origen_reserva text,
  habitacion_id uuid REFERENCES public.habitaciones(id) ON DELETE CASCADE,
  tipo_habitacion_id uuid REFERENCES public.tipos_de_habitacion(id) ON DELETE SET NULL,
  aplica_noches boolean NOT NULL DEFAULT true,
  aplica_horas boolean NOT NULL DEFAULT true,
  prioridad integer NOT NULL DEFAULT 0,
  activo boolean NOT NULL DEFAULT true,
  creada_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  creado_en timestamp with time zone DEFAULT now() NOT NULL,
  actualizado_en timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT reglas_tarifas_tipo_ajuste_check CHECK (tipo_ajuste = ANY (ARRAY['porcentaje'::text, 'fijo'::text])),
  CONSTRAINT reglas_tarifas_valor_check CHECK (valor >= (-1000000)::numeric)
);

CREATE INDEX IF NOT EXISTS idx_reglas_tarifas_hotel_activo
  ON public.reglas_tarifas (hotel_id, activo, prioridad DESC);

CREATE INDEX IF NOT EXISTS idx_reglas_tarifas_hotel_fecha
  ON public.reglas_tarifas (hotel_id, fecha_inicio, fecha_fin);

CREATE TABLE IF NOT EXISTS public.lista_espera_reservas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE CASCADE,
  cliente_id uuid REFERENCES public.clientes(id) ON DELETE SET NULL,
  cliente_nombre text NOT NULL,
  cedula text,
  telefono text,
  habitacion_id uuid REFERENCES public.habitaciones(id) ON DELETE SET NULL,
  tipo_habitacion_id uuid REFERENCES public.tipos_de_habitacion(id) ON DELETE SET NULL,
  fecha_inicio timestamp with time zone NOT NULL,
  fecha_fin timestamp with time zone NOT NULL,
  cantidad_huespedes integer NOT NULL DEFAULT 1,
  origen_reserva text NOT NULL DEFAULT 'directa',
  prioridad integer NOT NULL DEFAULT 1,
  estado text NOT NULL DEFAULT 'pendiente',
  notas text,
  sugerencias_cache jsonb NOT NULL DEFAULT '[]'::jsonb,
  creada_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  creada_en timestamp with time zone DEFAULT now() NOT NULL,
  actualizado_en timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT lista_espera_reservas_prioridad_check CHECK (prioridad BETWEEN 1 AND 3),
  CONSTRAINT lista_espera_reservas_estado_check CHECK (estado = ANY (ARRAY['pendiente'::text, 'contactado'::text, 'convertida'::text, 'cancelada'::text])),
  CONSTRAINT lista_espera_reservas_fechas_check CHECK (fecha_fin > fecha_inicio)
);

CREATE INDEX IF NOT EXISTS idx_lista_espera_hotel_estado
  ON public.lista_espera_reservas (hotel_id, estado, fecha_inicio);

CREATE INDEX IF NOT EXISTS idx_lista_espera_hotel_tipo_habitacion
  ON public.lista_espera_reservas (hotel_id, tipo_habitacion_id);

CREATE TABLE IF NOT EXISTS public.inspecciones_limpieza (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE CASCADE,
  habitacion_id uuid NOT NULL REFERENCES public.habitaciones(id) ON DELETE CASCADE,
  reserva_id uuid REFERENCES public.reservas(id) ON DELETE SET NULL,
  usuario_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  puntaje integer NOT NULL DEFAULT 0,
  observaciones text,
  creado_en timestamp with time zone DEFAULT now() NOT NULL,
  actualizado_en timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT inspecciones_limpieza_puntaje_check CHECK (puntaje BETWEEN 0 AND 5)
);

CREATE INDEX IF NOT EXISTS idx_inspecciones_limpieza_hotel_habitacion
  ON public.inspecciones_limpieza (hotel_id, habitacion_id, creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_inspecciones_limpieza_hotel_reserva
  ON public.inspecciones_limpieza (hotel_id, reserva_id, creado_en DESC);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'trigger_set_timestamp_actualizado_en'
      AND pg_function_is_visible(oid)
  ) THEN
    DROP TRIGGER IF EXISTS set_timestamp_reglas_tarifas ON public.reglas_tarifas;
    CREATE TRIGGER set_timestamp_reglas_tarifas
      BEFORE UPDATE ON public.reglas_tarifas
      FOR EACH ROW
      EXECUTE FUNCTION public.trigger_set_timestamp_actualizado_en();

    DROP TRIGGER IF EXISTS set_timestamp_lista_espera_reservas ON public.lista_espera_reservas;
    CREATE TRIGGER set_timestamp_lista_espera_reservas
      BEFORE UPDATE ON public.lista_espera_reservas
      FOR EACH ROW
      EXECUTE FUNCTION public.trigger_set_timestamp_actualizado_en();

    DROP TRIGGER IF EXISTS set_timestamp_inspecciones_limpieza ON public.inspecciones_limpieza;
    CREATE TRIGGER set_timestamp_inspecciones_limpieza
      BEFORE UPDATE ON public.inspecciones_limpieza
      FOR EACH ROW
      EXECUTE FUNCTION public.trigger_set_timestamp_actualizado_en();
  END IF;
END
$$;

ALTER TABLE public.reglas_tarifas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lista_espera_reservas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspecciones_limpieza ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reglas_tarifas_hotel_crud" ON public.reglas_tarifas;
CREATE POLICY "reglas_tarifas_hotel_crud" ON public.reglas_tarifas
  USING (
    EXISTS (
      SELECT 1
      FROM public.usuarios
      WHERE usuarios.id = auth.uid()
        AND usuarios.hotel_id = reglas_tarifas.hotel_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.usuarios
      WHERE usuarios.id = auth.uid()
        AND usuarios.hotel_id = reglas_tarifas.hotel_id
    )
  );

DROP POLICY IF EXISTS "lista_espera_reservas_hotel_crud" ON public.lista_espera_reservas;
CREATE POLICY "lista_espera_reservas_hotel_crud" ON public.lista_espera_reservas
  USING (
    EXISTS (
      SELECT 1
      FROM public.usuarios
      WHERE usuarios.id = auth.uid()
        AND usuarios.hotel_id = lista_espera_reservas.hotel_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.usuarios
      WHERE usuarios.id = auth.uid()
        AND usuarios.hotel_id = lista_espera_reservas.hotel_id
    )
  );

DROP POLICY IF EXISTS "inspecciones_limpieza_hotel_crud" ON public.inspecciones_limpieza;
CREATE POLICY "inspecciones_limpieza_hotel_crud" ON public.inspecciones_limpieza
  USING (
    EXISTS (
      SELECT 1
      FROM public.usuarios
      WHERE usuarios.id = auth.uid()
        AND usuarios.hotel_id = inspecciones_limpieza.hotel_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.usuarios
      WHERE usuarios.id = auth.uid()
        AND usuarios.hotel_id = inspecciones_limpieza.hotel_id
    )
  );
