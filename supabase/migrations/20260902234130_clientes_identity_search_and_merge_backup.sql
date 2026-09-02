set lock_timeout = '30s';
set statement_timeout = '90s';

create table if not exists app_private.clientes_merge_backup_20260902 (
  duplicate_id uuid primary key,
  canonical_id uuid not null,
  hotel_id uuid not null,
  merge_reason text not null,
  cliente_snapshot jsonb not null,
  merged_at timestamptz not null default now()
);

create table if not exists app_private.clientes_merge_fk_backup_20260902 (
  table_name text not null,
  row_id uuid not null,
  original_cliente_id uuid not null,
  canonical_id uuid not null,
  merged_at timestamptz not null default now(),
  primary key (table_name, row_id)
);

revoke all on table app_private.clientes_merge_backup_20260902 from public, anon, authenticated;
revoke all on table app_private.clientes_merge_fk_backup_20260902 from public, anon, authenticated;

create or replace function public.buscar_clientes_similares(
  p_hotel_id uuid,
  p_nombre text default null,
  p_documento text default null,
  p_telefono text default null,
  p_limite integer default 5
)
returns table (
  id uuid,
  nombre text,
  documento text,
  telefono text,
  email text,
  score integer,
  es_coincidencia_segura boolean
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
with input as (
  select
    regexp_replace(lower(translate(trim(coalesce(p_nombre,'')),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')),'[^a-z0-9]+','','g') as name_norm,
    nullif(regexp_replace(coalesce(p_documento,''),'[^0-9A-Za-z]','','g'),'') as doc_norm,
    nullif(regexp_replace(coalesce(p_telefono,''),'[^0-9]','','g'),'') as tel_norm
), stats as (
  select
    i.*,
    case when i.doc_norm is null then 999 else (
      select count(distinct regexp_replace(lower(translate(trim(coalesce(c2.nombre,'')),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')),'[^a-z0-9]+','','g'))
      from public.clientes c2
      where c2.hotel_id = p_hotel_id
        and nullif(regexp_replace(coalesce(c2.documento,''),'[^0-9A-Za-z]','','g'),'') = i.doc_norm
    ) end as doc_names_count,
    case when i.tel_norm is null then 999 else (
      select count(distinct regexp_replace(lower(translate(trim(coalesce(c3.nombre,'')),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')),'[^a-z0-9]+','','g'))
      from public.clientes c3
      where c3.hotel_id = p_hotel_id
        and nullif(regexp_replace(coalesce(c3.telefono,''),'[^0-9]','','g'),'') = i.tel_norm
    ) end as tel_names_count
  from input i
), candidates as (
  select
    c.id,
    c.nombre,
    c.documento,
    c.telefono,
    c.email,
    c.fecha_creado,
    s.name_norm,
    s.doc_norm,
    s.tel_norm,
    regexp_replace(lower(translate(trim(coalesce(c.nombre,'')),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')),'[^a-z0-9]+','','g') as c_name_norm,
    nullif(regexp_replace(coalesce(c.documento,''),'[^0-9A-Za-z]','','g'),'') as c_doc_norm,
    nullif(regexp_replace(coalesce(c.telefono,''),'[^0-9]','','g'),'') as c_tel_norm,
    (length(coalesce(s.doc_norm,'')) >= 6 and coalesce(s.doc_names_count,999) <= 5 and s.doc_norm !~ '^([0-9A-Za-z])\1+$') as doc_reliable,
    (length(coalesce(s.tel_norm,'')) = 10 and s.tel_norm ~ '^3[0-9]{9}$' and coalesce(s.tel_names_count,999) <= 5 and s.tel_norm !~ '^([0-9])\1+$') as tel_reliable
  from public.clientes c
  cross join stats s
  where c.hotel_id = p_hotel_id
    and coalesce(c.activo,true)
), scored as (
  select
    c.*,
    (c.c_name_norm = c.name_norm and length(c.name_norm) >= 3) as name_exact,
    (c.doc_norm is not null and c.c_doc_norm = c.doc_norm) as doc_exact,
    (c.tel_norm is not null and c.c_tel_norm = c.tel_norm) as tel_exact,
    ((case when c.c_name_norm = c.name_norm and length(c.name_norm) >= 3 then 80 else 0 end)
      + (case when c.doc_reliable and c.c_doc_norm = c.doc_norm then 90 else 0 end)
      + (case when c.tel_reliable and c.c_tel_norm = c.tel_norm then 80 else 0 end)
      + (case when length(c.name_norm) >= 3 and c.c_name_norm like '%' || c.name_norm || '%' then 20 else 0 end)
      + (case when length(coalesce(c.doc_norm,'')) >= 4 and c.c_doc_norm like c.doc_norm || '%' then 10 else 0 end)
      + (case when length(coalesce(c.tel_norm,'')) >= 4 and c.c_tel_norm like c.tel_norm || '%' then 10 else 0 end))::integer as match_score
  from candidates c
)
select
  s.id,
  s.nombre,
  s.documento,
  s.telefono,
  s.email,
  s.match_score as score,
  ((s.name_exact and ((s.doc_reliable and s.doc_exact) or (s.tel_reliable and s.tel_exact)))
    or ((s.doc_reliable and s.doc_exact) and (s.tel_reliable and s.tel_exact))) as es_coincidencia_segura
from scored s
where
  (length(s.name_norm) >= 3 and s.c_name_norm like '%' || s.name_norm || '%')
  or (length(coalesce(s.doc_norm,'')) >= 4 and s.c_doc_norm like s.doc_norm || '%')
  or (length(coalesce(s.tel_norm,'')) >= 4 and s.c_tel_norm like s.tel_norm || '%')
order by es_coincidencia_segura desc, match_score desc, s.fecha_creado asc nulls last, s.id
limit greatest(1, least(coalesce(p_limite,5), 10));
$$;

revoke all on function public.buscar_clientes_similares(uuid,text,text,text,integer) from public, anon;
grant execute on function public.buscar_clientes_similares(uuid,text,text,text,integer) to authenticated;
