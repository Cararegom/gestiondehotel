-- Fase 3: gastos, proveedores y cuentas por pagar. Sin conversión automática de históricos.
INSERT INTO public.permisos(nombre,descripcion)
SELECT v.nombre,v.descripcion FROM (VALUES
 ('gastos.ver','Consultar gastos y cuentas por pagar'),
 ('gastos.gestionar','Crear y pagar gastos'),
 ('gastos.aprobar','Aprobar gastos sujetos a control')
) v(nombre,descripcion)
WHERE NOT EXISTS(SELECT 1 FROM public.permisos p WHERE p.nombre=v.nombre);

INSERT INTO public.roles_permisos(rol_id,permiso_id)
SELECT r.id,p.id FROM public.roles r JOIN public.permisos p ON p.nombre = ANY(CASE lower(r.nombre)
 WHEN 'administrador' THEN ARRAY['gastos.ver','gastos.gestionar','gastos.aprobar']::text[]
 WHEN 'admin' THEN ARRAY['gastos.ver','gastos.gestionar','gastos.aprobar']::text[]
 WHEN 'gerente' THEN ARRAY['gastos.ver','gastos.gestionar','gastos.aprobar']::text[]
 WHEN 'propietario' THEN ARRAY['gastos.ver','gastos.gestionar','gastos.aprobar']::text[]
 WHEN 'contabilidad' THEN ARRAY['gastos.ver','gastos.gestionar']::text[]
 ELSE ARRAY[]::text[] END)
WHERE NOT EXISTS(SELECT 1 FROM public.roles_permisos rp WHERE rp.rol_id=r.id AND rp.permiso_id=p.id);

CREATE TABLE IF NOT EXISTS public.expense_categories(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE CASCADE,
 name text NOT NULL, treatment text NOT NULL DEFAULT 'operating_expense' CHECK(treatment IN('operating_expense','cogs','asset','liability_payment','owner')),
 parent_id uuid REFERENCES public.expense_categories(id) ON DELETE RESTRICT, active boolean NOT NULL DEFAULT true,
 display_order integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(hotel_id,name)
);
CREATE TABLE IF NOT EXISTS public.cost_centers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE CASCADE,
 name text NOT NULL, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(hotel_id,name)
);
CREATE TABLE IF NOT EXISTS public.expense_settings(
 hotel_id uuid PRIMARY KEY REFERENCES public.hoteles(id) ON DELETE CASCADE,
 approval_threshold numeric NOT NULL DEFAULT 1000000 CHECK(approval_threshold>=0), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.expenses(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE RESTRICT,
 supplier_id uuid REFERENCES public.proveedores(id) ON DELETE RESTRICT, category_id uuid NOT NULL REFERENCES public.expense_categories(id) ON DELETE RESTRICT,
 cost_center_id uuid NOT NULL REFERENCES public.cost_centers(id) ON DELETE RESTRICT, document_number text,
 description text NOT NULL CHECK(btrim(description)<>''), expense_date date NOT NULL, due_date date,
 subtotal numeric NOT NULL CHECK(subtotal>=0), tax_amount numeric NOT NULL DEFAULT 0 CHECK(tax_amount>=0),
 total_amount numeric NOT NULL CHECK(total_amount>0), currency text NOT NULL DEFAULT 'COP' CHECK(currency='COP'),
 status text NOT NULL CHECK(status IN('pending_approval','pending','partial','paid','cancelled')),
 receipt_url text, requires_approval boolean NOT NULL DEFAULT false, approved_by uuid REFERENCES public.usuarios(id) ON DELETE RESTRICT,
 approved_at timestamptz, cancelled_by uuid REFERENCES public.usuarios(id) ON DELETE RESTRICT, cancelled_at timestamptz,
 cancel_reason text, created_by uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
 client_operation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(hotel_id,client_operation_id), CHECK(round(subtotal+tax_amount,2)=round(total_amount,2)), CHECK(due_date IS NULL OR due_date>=expense_date)
);
CREATE TABLE IF NOT EXISTS public.expense_payments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE RESTRICT,
 expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE RESTRICT, account_id uuid NOT NULL REFERENCES public.financial_accounts(id) ON DELETE RESTRICT,
 metodo_pago_id uuid NOT NULL REFERENCES public.metodos_pago(id) ON DELETE RESTRICT, turno_id uuid REFERENCES public.turnos(id) ON DELETE RESTRICT,
 amount numeric NOT NULL CHECK(amount>0), paid_at timestamptz NOT NULL, business_date date NOT NULL,
 caja_id uuid NOT NULL UNIQUE REFERENCES public.caja(id) ON DELETE RESTRICT,
 account_movement_id uuid NOT NULL UNIQUE REFERENCES public.account_movements(id) ON DELETE RESTRICT,
 created_by uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT, client_operation_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(hotel_id,client_operation_id)
);
ALTER TABLE public.account_movements ADD COLUMN IF NOT EXISTS expense_payment_id uuid REFERENCES public.expense_payments(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS account_movements_expense_payment_uq ON public.account_movements(expense_payment_id) WHERE expense_payment_id IS NOT NULL;

INSERT INTO public.expense_settings(hotel_id) SELECT id FROM public.hoteles ON CONFLICT(hotel_id) DO NOTHING;
INSERT INTO public.expense_categories(hotel_id,name,treatment,display_order)
SELECT h.id,v.name,v.treatment,v.ord FROM public.hoteles h CROSS JOIN (VALUES
 ('Servicios públicos','operating_expense',10),('Nómina','operating_expense',20),('Mantenimiento','operating_expense',30),
 ('Lavandería','operating_expense',40),('Vehículo','operating_expense',50),('Administración','operating_expense',60),
 ('Inventario','cogs',70),('Activos','asset',80),('Retiros del propietario','owner',90),('Otros','operating_expense',100)
) v(name,treatment,ord) ON CONFLICT(hotel_id,name) DO NOTHING;
INSERT INTO public.cost_centers(hotel_id,name)
SELECT h.id,v.name FROM public.hoteles h CROSS JOIN (VALUES('Habitaciones'),('Tienda'),('Restaurante'),('Terraza'),('Administración'),('Mantenimiento'),('Vehículo'),('Lavandería'),('Otros')) v(name)
ON CONFLICT(hotel_id,name) DO NOTHING;

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY; ALTER TABLE public.cost_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_settings ENABLE ROW LEVEL SECURITY; ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY; ALTER TABLE public.expense_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY fase3_categories_select ON public.expense_categories FOR SELECT TO authenticated USING(public.fase1_actor_tiene_permiso(hotel_id,'gastos.ver'));
CREATE POLICY fase3_centers_select ON public.cost_centers FOR SELECT TO authenticated USING(public.fase1_actor_tiene_permiso(hotel_id,'gastos.ver'));
CREATE POLICY fase3_settings_select ON public.expense_settings FOR SELECT TO authenticated USING(public.fase1_actor_tiene_permiso(hotel_id,'gastos.ver'));
CREATE POLICY fase3_expenses_select ON public.expenses FOR SELECT TO authenticated USING(public.fase1_actor_tiene_permiso(hotel_id,'gastos.ver'));
CREATE POLICY fase3_payments_select ON public.expense_payments FOR SELECT TO authenticated USING(public.fase1_actor_tiene_permiso(hotel_id,'gastos.ver'));
REVOKE ALL ON public.expense_categories,public.cost_centers,public.expense_settings,public.expenses,public.expense_payments FROM anon;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.expenses,public.expense_payments FROM authenticated;
GRANT SELECT ON public.expense_categories,public.cost_centers,public.expense_settings,public.expenses,public.expense_payments TO authenticated;

CREATE OR REPLACE FUNCTION public.crear_gasto(
 p_category_id uuid,p_cost_center_id uuid,p_description text,p_expense_date date,p_due_date date,
 p_subtotal numeric,p_tax_amount numeric,p_supplier_id uuid,p_document_number text,p_receipt_url text,p_client_operation_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_actor public.usuarios%rowtype; v_threshold numeric; v_total numeric; v_expense public.expenses%rowtype;
BEGIN
 SELECT * INTO v_actor FROM public.usuarios WHERE id=auth.uid() AND activo IS TRUE;
 IF v_actor.hotel_id IS NULL OR NOT public.fase1_actor_tiene_permiso(v_actor.hotel_id,'gastos.gestionar') OR p_client_operation_id IS NULL THEN RAISE EXCEPTION 'Sin permiso para registrar gastos' USING ERRCODE='42501'; END IF;
 IF btrim(coalesce(p_description,''))='' OR p_expense_date IS NULL OR coalesce(p_subtotal,0)<0 OR coalesce(p_tax_amount,0)<0 THEN RAISE EXCEPTION 'Datos de gasto inválidos' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.expense_categories WHERE id=p_category_id AND hotel_id=v_actor.hotel_id AND active) OR NOT EXISTS(SELECT 1 FROM public.cost_centers WHERE id=p_cost_center_id AND hotel_id=v_actor.hotel_id AND active) THEN RAISE EXCEPTION 'Categoría o centro fuera del hotel' USING ERRCODE='42501'; END IF;
 IF p_supplier_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.proveedores WHERE id=p_supplier_id AND hotel_id=v_actor.hotel_id) THEN RAISE EXCEPTION 'Proveedor fuera del hotel' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_expense FROM public.expenses WHERE hotel_id=v_actor.hotel_id AND client_operation_id=p_client_operation_id;
 IF FOUND THEN RETURN jsonb_build_object('expense_id',v_expense.id,'status',v_expense.status,'idempotent',true); END IF;
 v_total:=round(coalesce(p_subtotal,0)+coalesce(p_tax_amount,0),2); IF v_total<=0 THEN RAISE EXCEPTION 'Total positivo requerido' USING ERRCODE='22023'; END IF;
 SELECT approval_threshold INTO v_threshold FROM public.expense_settings WHERE hotel_id=v_actor.hotel_id;
 INSERT INTO public.expenses(hotel_id,supplier_id,category_id,cost_center_id,document_number,description,expense_date,due_date,subtotal,tax_amount,total_amount,status,receipt_url,requires_approval,created_by,client_operation_id)
 VALUES(v_actor.hotel_id,p_supplier_id,p_category_id,p_cost_center_id,nullif(btrim(p_document_number),''),btrim(p_description),p_expense_date,p_due_date,p_subtotal,p_tax_amount,v_total,CASE WHEN v_total>=coalesce(v_threshold,1000000) THEN 'pending_approval' ELSE 'pending' END,p_receipt_url,v_total>=coalesce(v_threshold,1000000),auth.uid(),p_client_operation_id) RETURNING * INTO v_expense;
 RETURN jsonb_build_object('expense_id',v_expense.id,'status',v_expense.status,'total',v_expense.total_amount,'idempotent',false);
END $$;

CREATE OR REPLACE FUNCTION public.aprobar_gasto(p_expense_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_actor public.usuarios%rowtype; v_expense public.expenses%rowtype;
BEGIN SELECT * INTO v_actor FROM public.usuarios WHERE id=auth.uid() AND activo; SELECT * INTO v_expense FROM public.expenses WHERE id=p_expense_id FOR UPDATE;
 IF v_expense.id IS NULL OR v_actor.hotel_id IS DISTINCT FROM v_expense.hotel_id OR NOT public.fase1_actor_tiene_permiso(v_expense.hotel_id,'gastos.aprobar') THEN RAISE EXCEPTION 'Sin permiso para aprobar' USING ERRCODE='42501'; END IF;
 IF v_expense.status<>'pending_approval' THEN RAISE EXCEPTION 'El gasto no espera aprobación' USING ERRCODE='23514'; END IF;
 UPDATE public.expenses SET status='pending',approved_by=auth.uid(),approved_at=now(),updated_at=now() WHERE id=v_expense.id;
 RETURN jsonb_build_object('expense_id',v_expense.id,'status','pending'); END $$;

CREATE OR REPLACE FUNCTION public.pagar_gasto(
 p_expense_id uuid,p_account_id uuid,p_metodo_pago_id uuid,p_turno_id uuid,p_amount numeric,p_client_operation_id uuid,p_paid_at timestamptz DEFAULT now()
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_actor public.usuarios%rowtype; v_expense public.expenses%rowtype; v_paid numeric; v_payment public.expense_payments%rowtype; v_caja uuid; v_movement uuid; v_new_status text;
BEGIN SELECT * INTO v_actor FROM public.usuarios WHERE id=auth.uid() AND activo; SELECT * INTO v_expense FROM public.expenses WHERE id=p_expense_id FOR UPDATE;
 IF v_expense.id IS NULL OR v_actor.hotel_id IS DISTINCT FROM v_expense.hotel_id OR NOT public.fase1_actor_tiene_permiso(v_expense.hotel_id,'gastos.gestionar') THEN RAISE EXCEPTION 'Gasto fuera del hotel autorizado' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_payment FROM public.expense_payments WHERE hotel_id=v_expense.hotel_id AND client_operation_id=p_client_operation_id; IF FOUND THEN RETURN jsonb_build_object('expense_id',v_expense.id,'payment_id',v_payment.id,'status',v_expense.status,'idempotent',true); END IF;
 IF v_expense.status NOT IN('pending','partial') OR p_amount IS NULL OR p_amount<=0 THEN RAISE EXCEPTION 'Gasto no pagable o monto inválido' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.metodos_pago WHERE id=p_metodo_pago_id AND hotel_id=v_expense.hotel_id AND activo IS TRUE AND financial_account_id=p_account_id) THEN RAISE EXCEPTION 'Método no asignado a la cuenta seleccionada' USING ERRCODE='42501'; END IF;
 IF p_turno_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.turnos WHERE id=p_turno_id AND hotel_id=v_expense.hotel_id AND usuario_id=auth.uid() AND estado='abierto' AND fecha_cierre IS NULL) THEN RAISE EXCEPTION 'Turno activo propio requerido' USING ERRCODE='42501'; END IF;
 SELECT coalesce(sum(amount),0) INTO v_paid FROM public.expense_payments WHERE expense_id=v_expense.id; IF round(v_paid+p_amount,2)>round(v_expense.total_amount,2) THEN RAISE EXCEPTION 'El pago supera el saldo pendiente' USING ERRCODE='23514'; END IF;
 INSERT INTO public.caja(hotel_id,tipo,monto,concepto,fecha_movimiento,metodo_pago_id,usuario_id,turno_id,client_operation_id,source,business_date)
 VALUES(v_expense.hotel_id,'egreso',p_amount,'Pago gasto: '||v_expense.description,coalesce(p_paid_at,now()),p_metodo_pago_id,auth.uid(),p_turno_id,p_client_operation_id,'expense_payment',public.fase1_business_date(coalesce(p_paid_at,now()))) RETURNING id INTO v_caja;
 SELECT id INTO v_movement FROM public.account_movements WHERE caja_id=v_caja; IF v_movement IS NULL THEN RAISE EXCEPTION 'No se proyectó el pago al ledger'; END IF;
 v_new_status:=CASE WHEN round(v_paid+p_amount,2)=round(v_expense.total_amount,2) THEN 'paid' ELSE 'partial' END;
 INSERT INTO public.expense_payments(hotel_id,expense_id,account_id,metodo_pago_id,turno_id,amount,paid_at,business_date,caja_id,account_movement_id,created_by,client_operation_id)
 VALUES(v_expense.hotel_id,v_expense.id,p_account_id,p_metodo_pago_id,p_turno_id,p_amount,coalesce(p_paid_at,now()),public.fase1_business_date(coalesce(p_paid_at,now())),v_caja,v_movement,auth.uid(),p_client_operation_id) RETURNING * INTO v_payment;
 UPDATE public.account_movements SET expense_payment_id=v_payment.id WHERE id=v_movement;
 UPDATE public.expenses SET status=v_new_status,updated_at=now() WHERE id=v_expense.id;
 RETURN jsonb_build_object('expense_id',v_expense.id,'payment_id',v_payment.id,'status',v_new_status,'paid_total',v_paid+p_amount,'balance_due',v_expense.total_amount-v_paid-p_amount,'idempotent',false);
END $$;

CREATE OR REPLACE FUNCTION public.cancelar_gasto(p_expense_id uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_actor public.usuarios%rowtype; v_expense public.expenses%rowtype;
BEGIN SELECT * INTO v_actor FROM public.usuarios WHERE id=auth.uid() AND activo; SELECT * INTO v_expense FROM public.expenses WHERE id=p_expense_id FOR UPDATE;
 IF v_expense.id IS NULL OR v_actor.hotel_id IS DISTINCT FROM v_expense.hotel_id OR NOT public.fase1_actor_tiene_permiso(v_expense.hotel_id,'gastos.gestionar') THEN RAISE EXCEPTION 'Sin permiso para cancelar' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.expense_payments WHERE expense_id=v_expense.id) OR v_expense.status IN('paid','cancelled') OR btrim(coalesce(p_reason,''))='' THEN RAISE EXCEPTION 'El gasto pagado requiere reversión, no cancelación' USING ERRCODE='23514'; END IF;
 UPDATE public.expenses SET status='cancelled',cancelled_by=auth.uid(),cancelled_at=now(),cancel_reason=btrim(p_reason),updated_at=now() WHERE id=v_expense.id;
 RETURN jsonb_build_object('expense_id',v_expense.id,'status','cancelled'); END $$;

REVOKE ALL ON FUNCTION public.crear_gasto(uuid,uuid,text,date,date,numeric,numeric,uuid,text,text,uuid),public.aprobar_gasto(uuid),public.pagar_gasto(uuid,uuid,uuid,uuid,numeric,uuid,timestamptz),public.cancelar_gasto(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crear_gasto(uuid,uuid,text,date,date,numeric,numeric,uuid,text,text,uuid),public.aprobar_gasto(uuid),public.pagar_gasto(uuid,uuid,uuid,uuid,numeric,uuid,timestamptz),public.cancelar_gasto(uuid,text) TO authenticated,service_role;
