revoke all on public.bitacora_operativa from public, anon, authenticated, service_role;
grant select on public.bitacora_operativa to authenticated, service_role;

comment on view public.bitacora_operativa is
  'Proyeccion de bitacora solo lectura con instante UTC, fecha operativa y zona horaria resueltas por cada hotel desde Configuracion.';
