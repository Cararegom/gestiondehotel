create index if not exists ix_bitacora_hotel_creado_en
  on public.bitacora (hotel_id, creado_en desc);

create index if not exists ix_bitacora_usuario_id
  on public.bitacora (usuario_id)
  where usuario_id is not null;

create or replace view public.bitacora_operativa
with (security_invoker = true) as
select
  b.id,
  b.hotel_id,
  b.usuario_id,
  b.modulo,
  b.accion,
  b.detalles,
  b.creado_en,
  b.creado_en at time zone 'UTC' as creado_en_instante,
  public.hotel_business_date(
    b.hotel_id,
    b.creado_en at time zone 'UTC'
  ) as business_date,
  public.hotel_time_zone(b.hotel_id) as zona_horaria,
  u.nombre as usuario_nombre,
  u.correo as usuario_correo
from public.bitacora b
left join public.usuarios u
  on u.id = b.usuario_id;

revoke all on public.bitacora_operativa from public, anon;
grant select on public.bitacora_operativa to authenticated, service_role;

comment on view public.bitacora_operativa is
  'Proyeccion de bitacora con instante UTC, fecha operativa y zona horaria resueltas por cada hotel desde Configuracion.';
