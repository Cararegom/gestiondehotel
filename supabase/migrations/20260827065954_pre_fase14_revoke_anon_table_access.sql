-- Ninguna tabla de public es una API anonima. Los formularios publicos usan Edge Functions.
do $$
declare r record;
begin
  for r in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('revoke all on table public.%I from anon', r.relname);
  end loop;
end $$;

revoke all on all sequences in schema public from anon;
