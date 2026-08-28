-- Fases 16-17: prueba de comportamiento real de conciliacion bancaria.
-- Ejecutar solo en staging. Todos los fixtures son simulation/is_test y el script termina en ROLLBACK.
-- Aceptacion: 18/18 aserciones antes del ROLLBACK.

begin;
select set_config('request.jwt.claim.role','service_role',true);

create temporary table fase16_17_results (
  test_no integer primary key,
  label text not null
) on commit drop;

create or replace function pg_temp.assert_true(p_no integer, p_label text, p_condition boolean)
returns void language plpgsql as $f$
begin
  if coalesce(p_condition,false) is not true then
    raise exception 'TEST_FAIL %: %', p_no, p_label;
  end if;
  insert into fase16_17_results(test_no,label) values (p_no,p_label);
end;
$f$;

create or replace function pg_temp.expect_sqlstate(p_sql text, p_expected text)
returns boolean language plpgsql as $f$
begin
  begin
    execute p_sql;
    return false;
  exception when others then
    return sqlstate = p_expected;
  end;
end;
$f$;

-- Fixtures aislados: dos hoteles, tres usuarios Auth de staging, metodos,
-- habitaciones, reservas, ventas y eventos simulation. Todo se revierte al final.
insert into public.hoteles (id,nombre,activo) values
 ('11111111-1111-4111-8111-111111111111','Hotel Marena San Isidro',true),
 ('44444444-4444-4444-8444-444444444444','Hotel Otro Fixture',true);

insert into public.usuarios (id,nombre,hotel_id,activo,rol,correo,email) values
 ('5563e53a-5ae8-44f1-862c-2798adea1be6','Admin Marena Fixture','11111111-1111-4111-8111-111111111111',true,'admin','admin.a@staging.gestiondehotel.test','admin.a@staging.gestiondehotel.test'),
 ('26ebea62-efc9-428b-9f29-217642430aed','Recepcion Marena Fixture','11111111-1111-4111-8111-111111111111',true,'recepcionista','recepcion.a@staging.gestiondehotel.test','recepcion.a@staging.gestiondehotel.test'),
 ('a80a608d-ef1d-4d50-8645-61aaf5db3470','Admin Otro Fixture','44444444-4444-4444-8444-444444444444',true,'admin','admin.b@staging.gestiondehotel.test','admin.b@staging.gestiondehotel.test');

insert into public.metodos_pago (id,hotel_id,nombre,activo) values
 ('70000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Bancolombia',true),
 ('70000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','Efectivo',true);

insert into public.habitaciones (id,hotel_id,nombre,precio,estado) values
 ('10000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','T-101',100000,'libre'),
 ('10000000-0000-4000-8000-000000000002','44444444-4444-4444-8444-444444444444','O-201',100000,'libre');

insert into public.reservas (id,hotel_id,habitacion_id,cliente_nombre,fecha_inicio,fecha_fin,monto_total,monto_pagado,estado,usuario_id) values
 ('20000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000001','Reserva Piloto',now(),now()+interval '1 day',500000,0,'activa','5563e53a-5ae8-44f1-862c-2798adea1be6'),
 ('20000000-0000-4000-8000-000000000002','44444444-4444-4444-8444-444444444444','10000000-0000-4000-8000-000000000002','Reserva Otro Hotel',now(),now()+interval '1 day',100000,0,'activa','a80a608d-ef1d-4d50-8645-61aaf5db3470');

insert into public.ventas_tienda (id,hotel_id,total_venta,metodo_pago_id,usuario_id,estado_pago,cliente_temporal,fecha) values
 ('50000000-0000-4000-8000-000000000040','11111111-1111-4111-8111-111111111111',40000,'70000000-0000-4000-8000-000000000001','5563e53a-5ae8-44f1-862c-2798adea1be6','pagado','Venta 40',now()),
 ('50000000-0000-4000-8000-000000000020','11111111-1111-4111-8111-111111111111',20000,'70000000-0000-4000-8000-000000000001','5563e53a-5ae8-44f1-862c-2798adea1be6','pagado','Venta 20',now()),
 ('50000000-0000-4000-8000-000000000025','11111111-1111-4111-8111-111111111111',25000,'70000000-0000-4000-8000-000000000001','5563e53a-5ae8-44f1-862c-2798adea1be6','pagado','Venta 25 disponible',now()),
 ('50000000-0000-4000-8000-000000000030','11111111-1111-4111-8111-111111111111',30000,'70000000-0000-4000-8000-000000000001','5563e53a-5ae8-44f1-862c-2798adea1be6','pagado','Venta 30 completa',now());

insert into public.terraza_mesas (id,hotel_id,numero,nombre,sillas,tipo,activo) values
 ('60000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',901,'Mesa Fixture',2,'mesa',true);
insert into public.terraza_pedidos (id,hotel_id,mesa_id,usuario_id,estado,cliente_nombre,total,metodo_pago_id,fecha_apertura,fecha_cierre) values
 ('60000000-0000-4000-8000-000000000020','11111111-1111-4111-8111-111111111111','60000000-0000-4000-8000-000000000001','5563e53a-5ae8-44f1-862c-2798adea1be6','pagado','Terraza 20',20000,'70000000-0000-4000-8000-000000000001',now()-interval '10 minutes',now());

insert into public.bank_payment_events (id,hotel_id,provider,gmail_message_id,amount_cop,status,metadata) values
 ('31000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','simulation','f16-e1',100000,'detected','{"is_test":true}'::jsonb),
 ('31000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','simulation','f16-e2',100000,'detected','{"is_test":true}'::jsonb),
 ('31000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','simulation','f16-e3',100000,'detected','{"is_test":true}'::jsonb),
 ('31000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','simulation','f16-cross-target',100000,'detected','{"is_test":true}'::jsonb),
 ('31000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','simulation','f16-reception',100000,'detected','{"is_test":true}'::jsonb),
 ('31000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','simulation','f16-other-admin',100000,'detected','{"is_test":true}'::jsonb),
 ('31000000-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','simulation','f16-audit',50000,'detected','{"is_test":true}'::jsonb),
 ('31000000-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111','simulation','f16-sale-first',30000,'detected','{"is_test":true}'::jsonb),
 ('31000000-0000-4000-8000-000000000009','11111111-1111-4111-8111-111111111111','simulation','f16-sale-second',30000,'detected','{"is_test":true}'::jsonb),
 ('31000000-0000-4000-8000-000000000010','11111111-1111-4111-8111-111111111111','simulation','f16-blank-reason',50000,'detected','{"is_test":true}'::jsonb),
 ('31000000-0000-4000-8000-000000000011','11111111-1111-4111-8111-111111111111','simulation','f16-duplicate-key',15000,'detected','{"is_test":true}'::jsonb);

-- 1) 100k -> 60k reserva + 40k tienda.
select public.replace_bank_payment_allocations(
 '31000000-0000-4000-8000-000000000001','5563e53a-5ae8-44f1-862c-2798adea1be6',
 '[{"type":"reservation","reservationId":"20000000-0000-4000-8000-000000000001","amountCop":60000},{"type":"sale","saleId":"50000000-0000-4000-8000-000000000040","saleType":"tienda","amountCop":40000}]'::jsonb,
 'link','Distribucion 60/40','Hotel Marena San Isidro');
select pg_temp.assert_true(1,'60k reserva + 40k tienda aceptados',
 (select status='matched' and (select count(*) from public.bank_payment_allocations a where a.payment_event_id=e.id)=2 and (select sum(amount_cop) from public.bank_payment_allocations a where a.payment_event_id=e.id)=100000 from public.bank_payment_events e where e.id='31000000-0000-4000-8000-000000000001'));

-- 2) 100k -> 60k reserva + 20k tienda + 20k terraza.
select public.replace_bank_payment_allocations(
 '31000000-0000-4000-8000-000000000002','5563e53a-5ae8-44f1-862c-2798adea1be6',
 '[{"type":"reservation","reservationId":"20000000-0000-4000-8000-000000000001","amountCop":60000},{"type":"sale","saleId":"50000000-0000-4000-8000-000000000020","saleType":"tienda","amountCop":20000},{"type":"sale","saleId":"60000000-0000-4000-8000-000000000020","saleType":"terraza","amountCop":20000}]'::jsonb,
 'link','Distribucion triple','Hotel Marena San Isidro');
select pg_temp.assert_true(2,'triple allocation 60/20/20 aceptada',
 (select count(*)=3 and sum(amount_cop)=100000 from public.bank_payment_allocations where payment_event_id='31000000-0000-4000-8000-000000000002'));

-- Base estable para pruebas de atomicidad.
select public.replace_bank_payment_allocations(
 '31000000-0000-4000-8000-000000000003','5563e53a-5ae8-44f1-862c-2798adea1be6',
 '[{"type":"reservation","reservationId":"20000000-0000-4000-8000-000000000001","amountCop":100000}]'::jsonb,
 'link','Base atomicidad','Hotel Marena San Isidro');
create temporary table f16_snapshot as
select to_jsonb(e) as event_json,
       (select jsonb_agg(to_jsonb(a) order by a.id) from public.bank_payment_allocations a where a.payment_event_id=e.id) as allocations_json
from public.bank_payment_events e where e.id='31000000-0000-4000-8000-000000000003';

-- 3-4) Sumas incorrectas son rechazadas y no mutan estado.
select pg_temp.assert_true(3,'suma 90k rechazada y estado intacto',
 pg_temp.expect_sqlstate($sql$select public.replace_bank_payment_allocations('31000000-0000-4000-8000-000000000003','5563e53a-5ae8-44f1-862c-2798adea1be6','[{"type":"reservation","reservationId":"20000000-0000-4000-8000-000000000001","amountCop":90000}]'::jsonb,'link','Intento 90k','Hotel Marena San Isidro')$sql$,'22023')
 and (select to_jsonb(e)=(select event_json from f16_snapshot) from public.bank_payment_events e where e.id='31000000-0000-4000-8000-000000000003')
 and (select jsonb_agg(to_jsonb(a) order by a.id)=(select allocations_json from f16_snapshot) from public.bank_payment_allocations a where a.payment_event_id='31000000-0000-4000-8000-000000000003'));
select pg_temp.assert_true(4,'suma 110k rechazada y estado intacto',
 pg_temp.expect_sqlstate($sql$select public.replace_bank_payment_allocations('31000000-0000-4000-8000-000000000003','5563e53a-5ae8-44f1-862c-2798adea1be6','[{"type":"reservation","reservationId":"20000000-0000-4000-8000-000000000001","amountCop":110000}]'::jsonb,'link','Intento 110k','Hotel Marena San Isidro')$sql$,'22023')
 and (select to_jsonb(e)=(select event_json from f16_snapshot) from public.bank_payment_events e where e.id='31000000-0000-4000-8000-000000000003'));

-- 5-7) Aislamiento tenant y matriz de permisos.
select pg_temp.assert_true(5,'destino cross-hotel bloqueado',
 pg_temp.expect_sqlstate($sql$select public.replace_bank_payment_allocations('31000000-0000-4000-8000-000000000004','5563e53a-5ae8-44f1-862c-2798adea1be6','[{"type":"reservation","reservationId":"20000000-0000-4000-8000-000000000002","amountCop":100000}]'::jsonb,'link','Intento cross hotel','Hotel Marena San Isidro')$sql$,'22023')
 and (select status='detected' from public.bank_payment_events where id='31000000-0000-4000-8000-000000000004'));
select pg_temp.assert_true(6,'recepcionista bloqueada en redistribucion',
 pg_temp.expect_sqlstate($sql$select public.replace_bank_payment_allocations('31000000-0000-4000-8000-000000000005','26ebea62-efc9-428b-9f29-217642430aed','[{"type":"reservation","reservationId":"20000000-0000-4000-8000-000000000001","amountCop":100000}]'::jsonb,'link','Recepcion intenta conciliar','Hotel Marena San Isidro')$sql$,'42501')
 and not exists(select 1 from public.bank_payment_allocations where payment_event_id='31000000-0000-4000-8000-000000000005'));
select pg_temp.assert_true(7,'admin de otro hotel bloqueado',
 pg_temp.expect_sqlstate($sql$select public.replace_bank_payment_allocations('31000000-0000-4000-8000-000000000006','a80a608d-ef1d-4d50-8645-61aaf5db3470','[{"type":"reservation","reservationId":"20000000-0000-4000-8000-000000000001","amountCop":100000}]'::jsonb,'link','Admin otro hotel intenta','Hotel Marena San Isidro')$sql$,'42501'));

-- 8) Admin Marena permitido + auditoria normalizada, minima y trazable.
select public.review_bank_payment_event('31000000-0000-4000-8000-000000000007','mark_reviewed','5563e53a-5ae8-44f1-862c-2798adea1be6',null,null,null,null,null,'Revision administrativa trazable','Hotel Marena San Isidro');
select pg_temp.assert_true(8,'admin Marena genera before/after, actor y motivo sin datos sensibles',
 exists(select 1 from public.bank_payment_audit_log a where a.payment_event_id='31000000-0000-4000-8000-000000000007' and a.action='manual_reconciliation_state_changed'
   and a.user_id='5563e53a-5ae8-44f1-862c-2798adea1be6'
   and a.details->>'actor_id'='5563e53a-5ae8-44f1-862c-2798adea1be6'
   and a.details->>'action'='mark_reviewed'
   and a.details->>'reason'='Revision administrativa trazable'
   and a.details ? 'before' and a.details ? 'after'
   and a.details::text !~ '(transaction_reference|gmail_message|email_subject|sender_email|raw_content|fingerprint|token)'));

-- 9-10) Reabrir distribucion conserva todas las allocations y la reserva solo recibe su parte.
select pg_temp.assert_true(9,'triple allocation persistida completa',
 (select count(*)=3 and sum(amount_cop)=100000 and count(distinct allocation_type||':'||coalesce(sale_type,'reservation'))>=2 from public.bank_payment_allocations where payment_event_id='31000000-0000-4000-8000-000000000002'));
select pg_temp.assert_true(10,'credito directo de reserva es 60k, no 100k',
 (select sum(amount_cop)=60000 from public.bank_payment_allocations where payment_event_id='31000000-0000-4000-8000-000000000002' and allocation_type='reservation' and reservation_id='20000000-0000-4000-8000-000000000001'));

-- 11-12) Venta pagada bancaria sigue conciliable; doble conciliacion queda bloqueada.
select pg_temp.assert_true(11,'venta pagada por banco sigue conciliable sin segundo cobro',
 public.bank_email_sale_is_reconcilable('tienda','50000000-0000-4000-8000-000000000025','11111111-1111-4111-8111-111111111111')
 and public.bank_email_sale_available_amount_cop('tienda','50000000-0000-4000-8000-000000000025','11111111-1111-4111-8111-111111111111',null)=25000);
select public.replace_bank_payment_allocations('31000000-0000-4000-8000-000000000008','5563e53a-5ae8-44f1-862c-2798adea1be6','[{"type":"sale","saleId":"50000000-0000-4000-8000-000000000030","saleType":"tienda","amountCop":30000}]'::jsonb,'link','Concilia venta completa','Hotel Marena San Isidro');
select pg_temp.assert_true(12,'doble conciliacion de venta bloqueada',
 public.bank_email_sale_available_amount_cop('tienda','50000000-0000-4000-8000-000000000030','11111111-1111-4111-8111-111111111111',null)=0
 and pg_temp.expect_sqlstate($sql$select public.replace_bank_payment_allocations('31000000-0000-4000-8000-000000000009','5563e53a-5ae8-44f1-862c-2798adea1be6','[{"type":"sale","saleId":"50000000-0000-4000-8000-000000000030","saleType":"tienda","amountCop":30000}]'::jsonb,'link','Segundo intento venta completa','Hotel Marena San Isidro')$sql$,'22023')
 and not exists(select 1 from public.bank_payment_allocations where payment_event_id='31000000-0000-4000-8000-000000000009'));

-- 13-14) Atomicidad + motivo obligatorio incluso para dos acciones en la misma transaccion.
select pg_temp.assert_true(13,'fallo de allocation conserva distribución anterior',
 pg_temp.expect_sqlstate($sql$select public.replace_bank_payment_allocations('31000000-0000-4000-8000-000000000003','5563e53a-5ae8-44f1-862c-2798adea1be6','[{"type":"reservation","reservationId":"20000000-0000-4000-8000-000000000001","amountCop":50000},{"type":"reservation","reservationId":"20000000-0000-4000-8000-000000000001","amountCop":50000}]'::jsonb,'link','Allocation repetida','Hotel Marena San Isidro')$sql$,'22023')
 and (select to_jsonb(e)=(select event_json from f16_snapshot) from public.bank_payment_events e where e.id='31000000-0000-4000-8000-000000000003')
 and (select jsonb_agg(to_jsonb(a) order by a.id)=(select allocations_json from f16_snapshot) from public.bank_payment_allocations a where a.payment_event_id='31000000-0000-4000-8000-000000000003'));
select public.review_bank_payment_event('31000000-0000-4000-8000-000000000010','mark_reviewed','5563e53a-5ae8-44f1-862c-2798adea1be6',null,null,null,null,null,'Primera revision valida','Hotel Marena San Isidro');
select pg_temp.assert_true(14,'motivo obligatorio aun en segunda acción de la misma transacción',
 pg_temp.expect_sqlstate($sql$select public.review_bank_payment_event('31000000-0000-4000-8000-000000000010','mark_reviewed','5563e53a-5ae8-44f1-862c-2798adea1be6',null,null,null,null,null,null,'Hotel Marena San Isidro')$sql$,'22023')
 and (select review_reason='Primera revision valida' from public.bank_payment_events where id='31000000-0000-4000-8000-000000000010')
 and (select count(*)=1 from public.bank_payment_audit_log where payment_event_id='31000000-0000-4000-8000-000000000010' and action='manual_reconciliation_state_changed'));

-- 15) Duplicado Gmail: un solo evento.
select pg_temp.assert_true(15,'gmail_message_id duplicado deja un solo evento',
 pg_temp.expect_sqlstate($sql$insert into public.bank_payment_events(id,hotel_id,provider,gmail_message_id,amount_cop,status,metadata) values('31000000-0000-4000-8000-000000000012','11111111-1111-4111-8111-111111111111','simulation','f16-duplicate-key',15000,'detected','{"is_test":true}'::jsonb)$sql$,'23505')
 and (select count(*)=1 from public.bank_payment_events where hotel_id='11111111-1111-4111-8111-111111111111' and gmail_message_id='f16-duplicate-key'));

-- 16) Gmail ausente no bloquea Caja ni su proyeccion de ledger.
insert into public.caja (id,hotel_id,tipo,monto,concepto,metodo_pago_id,usuario_id,source,business_date)
values ('80000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','ingreso',1000,'Fixture caja sin Gmail','70000000-0000-4000-8000-000000000002','5563e53a-5ae8-44f1-862c-2798adea1be6','fase16_fixture',current_date);
select pg_temp.assert_true(16,'Gmail ausente no bloquea Caja/ledger',
 not exists(select 1 from public.bank_email_integrations where hotel_id='11111111-1111-4111-8111-111111111111')
 and exists(select 1 from public.caja where id='80000000-0000-4000-8000-000000000001' and monto=1000)
 and exists(select 1 from public.account_movements where caja_id='80000000-0000-4000-8000-000000000001' and source='caja_shadow' and amount=1000 and direction='in'));

-- 17) RPC administrativos: service_role-only.
select pg_temp.assert_true(17,'ACL de RPC administrativos es service_role-only',
 not has_function_privilege('anon','public.review_bank_payment_event(uuid,text,uuid,uuid,uuid,uuid,text,uuid,text,text)','EXECUTE')
 and not has_function_privilege('authenticated','public.review_bank_payment_event(uuid,text,uuid,uuid,uuid,uuid,text,uuid,text,text)','EXECUTE')
 and has_function_privilege('service_role','public.review_bank_payment_event(uuid,text,uuid,uuid,uuid,uuid,text,uuid,text,text)','EXECUTE')
 and not has_function_privilege('anon','public.replace_bank_payment_allocations(uuid,uuid,jsonb,text,text,text)','EXECUTE')
 and not has_function_privilege('authenticated','public.replace_bank_payment_allocations(uuid,uuid,jsonb,text,text,text)','EXECUTE')
 and has_function_privilege('service_role','public.replace_bank_payment_allocations(uuid,uuid,jsonb,text,text,text)','EXECUTE'));

-- 18) Helpers privilegiados fuera de la API publica.
select pg_temp.assert_true(18,'helpers privilegiados fuera de la API pública',
 to_regprocedure('public.bank_email_user_has_pilot_access(uuid)') is null
 and to_regprocedure('app_private.bank_email_user_has_pilot_access(uuid)') is not null
 and to_regprocedure('app_private.bank_email_actor_is_pilot_admin(uuid,uuid)') is not null
 and not has_schema_privilege('anon','app_private','USAGE')
 and not has_function_privilege('authenticated','app_private.bank_email_actor_is_pilot_admin(uuid,uuid)','EXECUTE'));

select jsonb_build_object(
  'status','PASS',
  'passed',(select count(*) from fase16_17_results),
  'expected',18,
  'tests',(select jsonb_agg(jsonb_build_object('no',test_no,'label',label) order by test_no) from fase16_17_results)
) as fase16_17_result;

rollback;
