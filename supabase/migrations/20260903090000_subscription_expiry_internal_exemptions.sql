-- Ciclo de suscripcion: vencimiento automatico + hoteles internos exentos.
-- La fecha de fin sigue siendo la autoridad temporal. El estado se sincroniza
-- cada hora para que el frontend existente aplique los 2 dias de gracia y,
-- posteriormente, el bloqueo de acceso.

alter table public.hoteles
  add column if not exists suscripcion_exenta boolean not null default false;

alter table public.hoteles
  add column if not exists suscripcion_exenta_motivo text;

comment on column public.hoteles.suscripcion_exenta is
  'Excluye al hotel del vencimiento y bloqueo automatico de suscripcion. Solo para cuentas internas/cortesia autorizadas.';

comment on column public.hoteles.suscripcion_exenta_motivo is
  'Motivo administrativo de la exencion de cobro/bloqueo.';

create or replace function public.proteger_suscripcion_exenta_hotel()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if coalesce(new.suscripcion_exenta, false) then
    new.estado_suscripcion := 'activo';
  end if;
  return new;
end;
$$;

revoke execute on function public.proteger_suscripcion_exenta_hotel()
  from public, anon, authenticated;

drop trigger if exists trg_proteger_suscripcion_exenta_hotel on public.hoteles;
create trigger trg_proteger_suscripcion_exenta_hotel
before insert or update on public.hoteles
for each row
execute function public.proteger_suscripcion_exenta_hotel();

create or replace function public.sincronizar_estados_suscripcion()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  filas_actualizadas integer := 0;
begin
  update public.hoteles
     set estado_suscripcion = 'vencido'
   where coalesce(suscripcion_exenta, false) = false
     and estado_suscripcion in ('trial', 'activo')
     and coalesce(suscripcion_fin, trial_fin) is not null
     and coalesce(suscripcion_fin, trial_fin) < now();

  get diagnostics filas_actualizadas = row_count;
  return filas_actualizadas;
end;
$$;

revoke execute on function public.sincronizar_estados_suscripcion()
  from public, anon, authenticated;
grant execute on function public.sincronizar_estados_suscripcion() to postgres;

-- Hoteles del propietario: acceso permanente, sin cobro ni bloqueo.
-- Se identifican por UUID para que un cambio de nombre no quite la exencion.
update public.hoteles
   set suscripcion_exenta = true,
       suscripcion_exenta_motivo = 'Hotel interno del propietario - acceso permanente sin cobro',
       estado_suscripcion = 'activo'
 where id in (
   '38373fa5-b953-4aa9-b4e9-25b9739be5f2', -- Hotel Marena San Isidro
   'ac5e4c9d-a8cc-4c53-ab03-0e4ed1549195', -- Hotel Corales del Mar
   '8434a618-0f58-46c9-ad91-da23987b7e99', -- Hotel Dora Smith
   'a32ecc1f-9821-4448-8d36-8463bf542149'  -- Hotel Dora Smith de prueba
 );

-- cron.schedule hace upsert cuando el nombre del job ya existe.
select cron.schedule(
  'sincronizar-estados-suscripcion-cada-hora',
  '17 * * * *',
  'select public.sincronizar_estados_suscripcion();'
);

-- Corrige inmediatamente cualquier estado historico atrasado al aplicar la migracion.
select public.sincronizar_estados_suscripcion();
