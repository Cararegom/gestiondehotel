const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '../..');
const migrationDirectory = path.join(root, 'supabase/migrations');
const migrationFiles = fs.readdirSync(migrationDirectory).filter(f => f.endsWith('.sql')).sort();
const migration = migrationFiles.find(f => f.endsWith('_p0_user_management_authorization.sql'));
const sources = migrationFiles.filter(f => f < migration).map(f => fs.readFileSync(path.join(migrationDirectory, f), 'utf8'));

// Load actual versioned helper bodies, not a JavaScript reimplementation of authorization.
function latestFunction(name) {
  let definition;
  const pattern = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\([\\s\\S]*?\\bAS\\s+(\\$[a-zA-Z_0-9]*\\$)[\\s\\S]*?\\1\\s*;`, 'ig');
  for (const source of sources) for (const match of source.matchAll(pattern)) definition = match[0];
  if (!definition) throw new Error(`Missing real helper: ${name}`);
  return definition;
}
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = {
  hotelA: id(1), hotelB: id(2), adminA: id(10), adminB: id(11), receptionist: id(12),
  employeeA: id(13), employeeB: id(14), saas: id(15), inactive: id(16), pending: id(17),
  owner: id(18), foreignAuth: id(19), whitelistSaas: id(20), roleAdmin: id(30), roleReceptionist: id(31),
  roleCleaner: id(32), roleSaas: id(33), roleWaiter: id(34), roleMaintenance: id(35),
  edit: id(50), view: id(51), clean: id(52), terrace: id(53), unknown: id(999),
};
async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid $$;
  `);
  await db.exec(`
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema auth to authenticated, anon, service_role;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, raw_app_meta_data jsonb default '{}',
      raw_user_meta_data jsonb default '{}', banned_until timestamptz);
    create table public.hoteles(id uuid primary key, creado_por uuid);
  `);
  const baseline = fs.readFileSync(path.join(migrationDirectory, '20260326191500_baseline_public_schema.sql'), 'utf8');
  for (const table of ['usuarios', 'roles', 'permisos', 'usuarios_roles', 'roles_permisos', 'usuarios_permisos', 'configuracion_turnos']) {
    const ddl = baseline.match(new RegExp(`CREATE TABLE "public"\\."${table}" \\([\\s\\S]*?\\n\\);`))?.[0];
    if (!ddl) throw new Error(`Missing real table: ${table}`);
    await db.exec(ddl + ` alter table public.${table} add primary key(id); alter table public.${table} enable row level security;`);
  }
  // Constraints checked against production on 2026-09-08; notably no unique override pair.
  await db.exec(`
    alter table usuarios add foreign key(id) references auth.users(id) on delete cascade;
    alter table usuarios add foreign key(hotel_id) references hoteles(id);
    alter table usuarios_roles add foreign key(usuario_id) references usuarios(id) on delete cascade;
    alter table usuarios_roles add foreign key(rol_id) references roles(id) on delete cascade;
    alter table usuarios_roles add foreign key(hotel_id) references hoteles(id) on delete cascade;
    alter table usuarios_permisos add foreign key(usuario_id) references usuarios(id) on delete cascade;
    alter table usuarios_permisos add foreign key(permiso_id) references permisos(id) on delete cascade;
  `);
  for (const name of ['is_whitelisted_saas_superadmin_email', 'actor_is_saas_superadmin',
    'fase1_actor_es_miembro_activo', 'usuario_actual_es_admin_hotel', 'fase1_actor_tiene_permiso',
    'pre_fase14_can_bootstrap_profile', 'pre_fase14_can_bootstrap_admin_role',
    'es_nombre_rol_mantenimiento_conserje', 'sincronizar_rol_legacy_mantenimiento_conserje',
    'pre_fase14_protect_user_authority', 'crear_configuracion_turno_default']) await db.exec(latestFunction(name));
  const hardening = fs.readFileSync(path.join(migrationDirectory, '20260827065614_pre_fase14_critical_rls_hardening.sql'), 'utf8');
  for (const match of hardening.matchAll(/create policy\s+[\s\S]*?;/gi)) {
    if (/on public\.(usuarios|usuarios_roles|usuarios_permisos|roles|permisos|roles_permisos)\s/i.test(match[0])) await db.exec(match[0]);
  }
  await db.exec(`
    grant select, insert, update, delete on usuarios, usuarios_roles, usuarios_permisos to authenticated;
    grant select on roles, permisos, roles_permisos, hoteles to authenticated;
    create trigger pre_fase14_protect_user_authority before update on usuarios
      for each row execute function pre_fase14_protect_user_authority();
    create trigger trg_sync_rol_legacy_mantenimiento_conserje after insert or delete or update of rol_id,usuario_id,hotel_id
      on usuarios_roles for each row execute function sincronizar_rol_legacy_mantenimiento_conserje();
  `);
  for (const [key, name] of [['roleAdmin','Administrador'],['roleReceptionist','Recepcionista'],['roleCleaner','Aseador'],
    ['roleSaas','Superadministrador SaaS'],['roleWaiter','Mesero/a'],['roleMaintenance','Mantenimiento / Conserje']]) {
    await db.query('insert into roles(id,nombre) values ($1,$2)', [ids[key], name]);
  }
  for (const [key, name] of [['edit','editar_usuarios'],['view','ver_usuarios'],['clean','ver_limpieza'],['terrace','terraza.cobrar']]) {
    await db.query('insert into permisos(id,nombre) values ($1,$2)', [ids[key], name]);
  }
  for (const [role, permissions] of [['roleAdmin',['edit','view','clean']], ['roleReceptionist',['view']],
    ['roleCleaner',['clean']], ['roleWaiter',['terrace']], ['roleMaintenance',['clean']]]) {
    for (const permission of permissions) await db.query('insert into roles_permisos(rol_id,permiso_id) values ($1,$2)', [ids[role], ids[permission]]);
  }
  await db.query('insert into hoteles values ($1,$3),($2,$4)', [ids.hotelA,ids.hotelB,ids.owner,ids.adminB]);
  for (const [user, hotel, role, active] of [['adminA','hotelA','roleAdmin',true],['adminB','hotelB','roleAdmin',true],
    ['receptionist','hotelA','roleReceptionist',true],['employeeA','hotelA','roleCleaner',true],
    ['employeeB','hotelB','roleCleaner',true],['saas',null,null,true],['inactive','hotelA','roleAdmin',false],['owner','hotelA',null,true]]) {
    await db.query('insert into auth.users(id,email) values ($1,$2)', [ids[user],`${user}@example.test`]);
    await db.query('insert into usuarios(id,hotel_id,nombre,correo,rol,activo) values ($1,$2,$3,$4,$5,$6)',
      [ids[user],ids[hotel] || null,user,`${user}@example.test`,user === 'saas' ? 'superadmin' : 'usuario',active]);
    if (role) await db.query('insert into usuarios_roles(usuario_id,rol_id,hotel_id) values ($1,$2,$3)', [ids[user],ids[role],ids[hotel]]);
  }
  await db.query("insert into auth.users(id,email,raw_app_meta_data,banned_until) values ($1,'pending@example.test',$2,now()+interval '1 day')",
    [ids.pending, {p0_created_by:ids.adminA,p0_hotel_id:ids.hotelA}]);
  await db.query("insert into auth.users(id,email,raw_user_meta_data,banned_until) values ($1,'foreign@example.test',$2,now()+interval '1 day')",
    [ids.foreignAuth, {p0_created_by:ids.adminA,p0_hotel_id:ids.hotelA}]);
  const whitelistEmail = latestFunction('is_whitelisted_saas_superadmin_email').match(/IN\s*\('([^']+)'/i)[1];
  await db.query('insert into auth.users(id,email,email_confirmed_at) values ($1,$2,now())',[ids.whitelistSaas,whitelistEmail]);
  await db.query("insert into usuarios(id,nombre,correo,activo) values ($1,'SaaS whitelist',$2,true)",[ids.whitelistSaas,whitelistEmail]);
  await db.exec('create trigger trg_auto_configuracion_turno after insert on usuarios for each row execute function crear_configuracion_turno_default()');
  await db.exec(fs.readFileSync(path.join(migrationDirectory, migration), 'utf8'));
  return db;
}
async function asActor(db, actor, action, role = 'authenticated') {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(actor ? {sub:ids[actor] || actor,email:`${actor}@example.test`,role} : {role})]);
    await db.exec(`set local role ${role}`);
    return await action(db);
  } finally { await db.exec('rollback'); }
}
module.exports = {database, asActor, ids, latestFunction};
