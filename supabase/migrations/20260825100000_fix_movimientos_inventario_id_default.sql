-- Restaura la generación automática omitida por algunos baselines históricos.
-- Producción puede tener ya una columna IDENTITY; en ese caso no se cambia su ownership.
DO $$
DECLARE
  v_identity text;
  v_sequence text;
BEGIN
  SELECT attidentity
    INTO v_identity
    FROM pg_attribute
   WHERE attrelid = 'public.movimientos_inventario'::regclass
     AND attname = 'id'
     AND NOT attisdropped;

  IF COALESCE(v_identity, '') = '' THEN
    CREATE SEQUENCE IF NOT EXISTS public.movimientos_inventario_id_seq;
    ALTER SEQUENCE public.movimientos_inventario_id_seq
      OWNED BY public.movimientos_inventario.id;
    ALTER TABLE public.movimientos_inventario
      ALTER COLUMN id SET DEFAULT nextval('public.movimientos_inventario_id_seq');
  END IF;

  v_sequence := pg_get_serial_sequence('public.movimientos_inventario', 'id');
  IF v_sequence IS NULL THEN
    RAISE EXCEPTION 'No se encontró la secuencia para movimientos_inventario.id';
  END IF;

  EXECUTE format(
    'SELECT setval(%L, COALESCE((SELECT max(id) FROM public.movimientos_inventario), 0) + 1, false)',
    v_sequence
  );
END
$$;
