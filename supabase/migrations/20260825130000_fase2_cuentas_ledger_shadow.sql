-- Fase 2: cuentas y ledger de dinero en shadow mode. No migra históricos ni reemplaza caja.
INSERT INTO public.permisos(nombre,descripcion)
SELECT 'finanzas.cuentas_gestionar','Crear cuentas y transferencias financieras'
WHERE NOT EXISTS (SELECT 1 FROM public.permisos WHERE nombre='finanzas.cuentas_gestionar');

INSERT INTO public.roles_permisos(rol_id,permiso_id)
SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permisos p
WHERE p.nombre='finanzas.cuentas_gestionar'
  AND lower(r.nombre) IN ('administrador','admin','gerente','propietario')
  AND NOT EXISTS (SELECT 1 FROM public.roles_permisos rp WHERE rp.rol_id=r.id AND rp.permiso_id=p.id);

CREATE TABLE IF NOT EXISTS public.financial_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE RESTRICT,
  name text NOT NULL,
  account_type text NOT NULL CHECK(account_type IN('cash','bank','wallet','clearing')),
  currency text NOT NULL DEFAULT 'COP' CHECK(currency='COP'),
  last_four text CHECK(last_four IS NULL OR last_four ~ '^[0-9]{4}$'),
  active boolean NOT NULL DEFAULT true,
  opening_balance numeric NOT NULL DEFAULT 0,
  shadow_started_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(hotel_id,name)
);

ALTER TABLE public.metodos_pago ADD COLUMN IF NOT EXISTS financial_account_id uuid REFERENCES public.financial_accounts(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS public.account_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE RESTRICT,
  from_account_id uuid NOT NULL REFERENCES public.financial_accounts(id) ON DELETE RESTRICT,
  to_account_id uuid NOT NULL REFERENCES public.financial_accounts(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK(amount>0),
  description text NOT NULL CHECK(btrim(description)<>''),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  business_date date NOT NULL,
  created_by uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  client_operation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(from_account_id<>to_account_id),
  UNIQUE(hotel_id,client_operation_id)
);

CREATE TABLE IF NOT EXISTS public.account_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES public.financial_accounts(id) ON DELETE RESTRICT,
  direction text NOT NULL CHECK(direction IN('in','out')),
  amount numeric NOT NULL CHECK(amount>0),
  occurred_at timestamptz NOT NULL,
  business_date date NOT NULL,
  description text NOT NULL CHECK(btrim(description)<>''),
  source text NOT NULL CHECK(btrim(source)<>''),
  caja_id uuid UNIQUE REFERENCES public.caja(id) ON DELETE RESTRICT,
  transfer_id uuid REFERENCES public.account_transfers(id) ON DELETE RESTRICT,
  metodo_pago_id uuid REFERENCES public.metodos_pago(id) ON DELETE RESTRICT,
  turno_id uuid REFERENCES public.turnos(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  client_operation_id uuid,
  reversed_movement_id uuid REFERENCES public.account_movements(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((caja_id IS NOT NULL)::int + (transfer_id IS NOT NULL)::int = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS account_movements_transfer_direction_uq
ON public.account_movements(transfer_id,direction) WHERE transfer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS account_movements_account_date_idx ON public.account_movements(account_id,business_date,occurred_at);

ALTER TABLE public.financial_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fase2_accounts_select ON public.financial_accounts;
CREATE POLICY fase2_accounts_select ON public.financial_accounts FOR SELECT TO authenticated
USING(public.fase1_actor_tiene_permiso(hotel_id,'finanzas.ver'));
DROP POLICY IF EXISTS fase2_accounts_manage ON public.financial_accounts;
CREATE POLICY fase2_accounts_manage ON public.financial_accounts FOR ALL TO authenticated
USING(public.fase1_actor_tiene_permiso(hotel_id,'finanzas.cuentas_gestionar'))
WITH CHECK(public.fase1_actor_tiene_permiso(hotel_id,'finanzas.cuentas_gestionar'));
DROP POLICY IF EXISTS fase2_transfers_select ON public.account_transfers;
CREATE POLICY fase2_transfers_select ON public.account_transfers FOR SELECT TO authenticated
USING(public.fase1_actor_tiene_permiso(hotel_id,'finanzas.ver'));
DROP POLICY IF EXISTS fase2_movements_select ON public.account_movements;
CREATE POLICY fase2_movements_select ON public.account_movements FOR SELECT TO authenticated
USING(public.fase1_actor_tiene_permiso(hotel_id,'finanzas.ver'));

REVOKE ALL ON public.financial_accounts,public.account_transfers,public.account_movements FROM anon;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.account_transfers,public.account_movements FROM authenticated;
GRANT SELECT ON public.financial_accounts,public.account_transfers,public.account_movements TO authenticated;
GRANT INSERT,UPDATE ON public.financial_accounts TO authenticated;

CREATE OR REPLACE FUNCTION public.fase2_account_type_from_method(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT CASE
   WHEN lower(coalesce(p_name,'')) ~ 'efectivo|cash' THEN 'cash'
   WHEN lower(coalesce(p_name,'')) ~ 'banco|bancolombia|transfer|nequi|daviplata' THEN 'bank'
   WHEN lower(coalesce(p_name,'')) ~ 'tarjeta|wallet|billetera' THEN 'wallet'
   ELSE 'clearing' END
$$;

CREATE OR REPLACE FUNCTION public.fase2_ensure_method_account(p_method_id uuid,p_hotel_id uuid,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_method public.metodos_pago%rowtype; v_account uuid;
BEGIN
 SELECT * INTO v_method FROM public.metodos_pago WHERE id=p_method_id AND hotel_id=p_hotel_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Método de pago fuera del hotel' USING ERRCODE='42501'; END IF;
 IF v_method.financial_account_id IS NOT NULL THEN RETURN v_method.financial_account_id; END IF;
 INSERT INTO public.financial_accounts(hotel_id,name,account_type,created_by)
 VALUES(p_hotel_id,'Cuenta '||v_method.nombre,public.fase2_account_type_from_method(v_method.nombre),p_actor)
 ON CONFLICT(hotel_id,name) DO UPDATE SET updated_at=now()
 RETURNING id INTO v_account;
 UPDATE public.metodos_pago SET financial_account_id=v_account WHERE id=v_method.id;
 RETURN v_account;
END $$;

CREATE OR REPLACE FUNCTION public.fase2_project_caja_to_account()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_account uuid; v_direction text;
BEGIN
 IF NEW.metodo_pago_id IS NULL OR EXISTS(SELECT 1 FROM public.account_movements WHERE caja_id=NEW.id) THEN RETURN NEW; END IF;
 v_account:=public.fase2_ensure_method_account(NEW.metodo_pago_id,NEW.hotel_id,NEW.usuario_id);
 v_direction:=CASE WHEN NEW.tipo::text='ingreso' THEN 'in' ELSE 'out' END;
 INSERT INTO public.account_movements(
   hotel_id,account_id,direction,amount,occurred_at,business_date,description,source,caja_id,
   metodo_pago_id,turno_id,created_by,client_operation_id
 ) VALUES (
   NEW.hotel_id,v_account,v_direction,NEW.monto,coalesce(NEW.fecha_movimiento,now()),
   coalesce(NEW.business_date,public.fase1_business_date(coalesce(NEW.fecha_movimiento,now()))),
   NEW.concepto,'caja_shadow',NEW.id,NEW.metodo_pago_id,NEW.turno_id,NEW.usuario_id,NEW.client_operation_id
 );
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS fase2_project_caja_to_account_trg ON public.caja;
CREATE TRIGGER fase2_project_caja_to_account_trg AFTER INSERT ON public.caja
FOR EACH ROW EXECUTE FUNCTION public.fase2_project_caja_to_account();

CREATE OR REPLACE FUNCTION public.crear_transferencia_cuenta(
 p_from_account_id uuid,p_to_account_id uuid,p_amount numeric,p_description text,
 p_client_operation_id uuid,p_occurred_at timestamptz DEFAULT now()
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_from public.financial_accounts%rowtype; v_to public.financial_accounts%rowtype; v_transfer public.account_transfers%rowtype; v_actor public.usuarios%rowtype;
BEGIN
 IF auth.uid() IS NULL OR p_amount<=0 OR p_client_operation_id IS NULL OR btrim(coalesce(p_description,''))='' THEN RAISE EXCEPTION 'Transferencia inválida' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_actor FROM public.usuarios WHERE id=auth.uid() AND activo IS TRUE;
 SELECT * INTO v_from FROM public.financial_accounts WHERE id=p_from_account_id AND active FOR UPDATE;
 SELECT * INTO v_to FROM public.financial_accounts WHERE id=p_to_account_id AND active FOR UPDATE;
 IF v_from.id IS NULL OR v_to.id IS NULL OR v_from.hotel_id IS DISTINCT FROM v_to.hotel_id OR v_actor.hotel_id IS DISTINCT FROM v_from.hotel_id OR NOT public.fase1_actor_tiene_permiso(v_from.hotel_id,'finanzas.cuentas_gestionar') THEN RAISE EXCEPTION 'Cuentas fuera del hotel autorizado' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_transfer FROM public.account_transfers WHERE hotel_id=v_from.hotel_id AND client_operation_id=p_client_operation_id;
 IF FOUND THEN RETURN jsonb_build_object('transfer_id',v_transfer.id,'idempotent',true); END IF;
 INSERT INTO public.account_transfers(hotel_id,from_account_id,to_account_id,amount,description,occurred_at,business_date,created_by,client_operation_id)
 VALUES(v_from.hotel_id,v_from.id,v_to.id,p_amount,p_description,coalesce(p_occurred_at,now()),public.fase1_business_date(coalesce(p_occurred_at,now())),auth.uid(),p_client_operation_id) RETURNING * INTO v_transfer;
 INSERT INTO public.account_movements(hotel_id,account_id,direction,amount,occurred_at,business_date,description,source,transfer_id,created_by,client_operation_id)
 VALUES
 (v_from.hotel_id,v_from.id,'out',p_amount,v_transfer.occurred_at,v_transfer.business_date,p_description,'account_transfer',v_transfer.id,auth.uid(),p_client_operation_id),
 (v_from.hotel_id,v_to.id,'in',p_amount,v_transfer.occurred_at,v_transfer.business_date,p_description,'account_transfer',v_transfer.id,auth.uid(),p_client_operation_id);
 RETURN jsonb_build_object('transfer_id',v_transfer.id,'idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.crear_transferencia_cuenta(uuid,uuid,numeric,text,uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crear_transferencia_cuenta(uuid,uuid,numeric,text,uuid,timestamptz) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.resumen_cuentas_financieras()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_hotel uuid;
BEGIN
 SELECT hotel_id INTO v_hotel FROM public.usuarios WHERE id=auth.uid() AND activo IS TRUE;
 IF v_hotel IS NULL OR NOT public.fase1_actor_tiene_permiso(v_hotel,'finanzas.ver') THEN RAISE EXCEPTION 'Sin permiso financiero' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object(
  'hotel_id',v_hotel,'generated_at',now(),
  'accounts',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.name) FROM (
    SELECT a.id,a.name,a.account_type,a.currency,a.last_four,a.active,a.shadow_started_at,
      a.opening_balance+coalesce(sum(CASE m.direction WHEN 'in' THEN m.amount ELSE -m.amount END),0) AS balance
    FROM public.financial_accounts a LEFT JOIN public.account_movements m ON m.account_id=a.id
    WHERE a.hotel_id=v_hotel GROUP BY a.id
  ) x),'[]'::jsonb),
  'unmapped_methods',(SELECT count(*) FROM public.metodos_pago WHERE hotel_id=v_hotel AND activo AND financial_account_id IS NULL),
  'caja_without_ledger',(SELECT count(*) FROM public.caja c WHERE c.hotel_id=v_hotel AND c.metodo_pago_id IS NOT NULL AND c.creado_en >= (SELECT coalesce(min(shadow_started_at),now()) FROM public.financial_accounts WHERE hotel_id=v_hotel) AND NOT EXISTS(SELECT 1 FROM public.account_movements m WHERE m.caja_id=c.id))
 );
END $$;
REVOKE ALL ON FUNCTION public.resumen_cuentas_financieras() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resumen_cuentas_financieras() TO authenticated,service_role;
