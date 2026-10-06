const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {database, asActor, ids, latestFunction} = require('./helpers/p0-database.cjs');

const authorize = (db, hotel = ids.hotelA, roles = [ids.roleCleaner]) => db.query(
  'select p0_autorizar_colaborador($1,$2) as hotel', [hotel,roles]);
const permissions = (db, user = ids.employeeA, items = [{permiso_id:ids.view,checked:true}], hotel = null) => db.query(
  'select p0_actualizar_permisos_usuario($1,$2,$3)', [user,hotel,JSON.stringify(items)]);
const edit = (db, user = ids.employeeA, roles = [ids.roleReceptionist], hotel = ids.hotelA) => db.query(
  'select p0_editar_colaborador($1,$2,$3,$4,true)', [user,hotel,roles,'Updated employee']);
const finalize = (db, user = ids.pending, hotel = ids.hotelA, roles = [ids.roleCleaner]) => db.query(
  'select p0_finalizar_colaborador($1,$2,$3,$4,true)', [user,hotel,roles,'New employee']);
const denied = promise => assert.rejects(promise, error => error.code === '42501');

test('P0: PostgreSQL real ejecuta migración, RLS y autorización multi-hotel', async t => {
  const db = await database();
  t.after(() => db.close());
  const run = (name, actor, action) => t.test(name, () => asActor(db,actor,action));

  await t.test('ACL: sin privilegios auxiliares de tablas ni EXECUTE público/privilegiado en RPC P0',async()=>{
    for (const table of ['usuarios','usuarios_roles','usuarios_permisos','roles','roles_permisos','permisos']) {
      for (const privilege of ['TRUNCATE','REFERENCES','TRIGGER']) {
        assert.equal((await db.query("select has_table_privilege('authenticated',$1,$2) as allowed",[`public.${table}`,privilege])).rows[0].allowed,false);
      }
    }
    const rows=(await db.query(`select n.nspname,p.proname,p.proconfig,
      has_function_privilege('anon',p.oid,'execute') as anon_execute,
      has_function_privilege('service_role',p.oid,'execute') as service_execute,
      has_function_privilege('authenticated',p.oid,'execute') as user_execute
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='p0_private' or (n.nspname='public' and p.proname like 'p0_%')`)).rows;
    assert.ok(rows.length>=10);
    for(const row of rows) {
      assert.equal(row.anon_execute,false,row.proname);
      assert.equal(row.service_execute,false,row.proname);
      assert.equal(row.user_execute,row.nspname==='public',row.proname);
      assert.ok(row.proconfig.some(v=>v.startsWith('search_path=')),row.proname);
    }
  });

  await run('Admin A: deriva Hotel A sin confiar en request', 'adminA', async db => {
    assert.equal((await authorize(db,null)).rows[0].hotel, ids.hotelA);
  });
  await run('Admin A: crea perfil y roles en Hotel A y consume prueba Auth', 'adminA', async db => {
    await finalize(db);
    const row = (await db.query('select hotel_id from usuarios where id=$1',[ids.pending])).rows[0];
    assert.equal(row.hotel_id,ids.hotelA);
    assert.equal((await db.query('select count(*)::int as n from usuarios_roles where usuario_id=$1 and hotel_id=$2',[ids.pending,ids.hotelA])).rows[0].n,1);
  });
  await run('Admin A: permite rol Administrador cuando no supera sus permisos', 'adminA', db => authorize(db,ids.hotelA,[ids.roleAdmin]));
  await run('Admin A: permisos personalizados concedidos, revocados y restaurados', 'adminA', async db => {
    await permissions(db);
    await permissions(db);
    assert.equal((await db.query('select count(*)::int as n from usuarios_permisos where usuario_id=$1',[ids.employeeA])).rows[0].n,1);
    await permissions(db,ids.employeeA,[{permiso_id:ids.clean,checked:false}]);
    assert.equal((await db.query('select permitido from usuarios_permisos where usuario_id=$1 and permiso_id=$2',[ids.employeeA,ids.clean])).rows[0].permitido,false);
    await permissions(db,ids.employeeA,[{permiso_id:ids.clean,checked:true}]);
    assert.equal((await db.query('select count(*)::int as n from usuarios_permisos where usuario_id=$1 and permiso_id=$2',[ids.employeeA,ids.clean])).rows[0].n,0);
  });
  await run('Admin A: edición atómica de roles y perfil', 'adminA', async db => {
    await edit(db);
    assert.equal((await db.query('select rol_id from usuarios_roles where usuario_id=$1',[ids.employeeA])).rows[0].rol_id,ids.roleReceptionist);
  });
  await run('Regresión: asignar y retirar mantenimiento conserva sincronización legacy', 'adminA', async db => {
    await edit(db,ids.employeeA,[ids.roleMaintenance]);
    assert.equal((await db.query('select rol from usuarios where id=$1',[ids.employeeA])).rows[0].rol,'mantenimiento');
    await edit(db);
    assert.equal((await db.query('select rol from usuarios where id=$1',[ids.employeeA])).rows[0].rol,'usuario');
  });
  for (const [name, actor, action] of [
    ['Admin A no crea en B','adminA',db=>authorize(db,ids.hotelB)],
    ['Admin A no modifica permisos B','adminA',db=>permissions(db,ids.employeeB)],
    ['Admin A no edita roles B con hotel A falsificado','adminA',db=>edit(db,ids.employeeB)],
    ['Admin B no modifica A','adminB',db=>permissions(db)],
    ['Recepcionista no crea','receptionist',db=>authorize(db)],
    ['Recepcionista no modifica permisos','receptionist',db=>permissions(db)],
    ['Recepcionista no modifica roles','receptionist',db=>edit(db)],
    ['Recepcionista no accede a B','receptionist',db=>authorize(db,ids.hotelB)],
    ['Admin A no cambia permisos propios','adminA',db=>permissions(db,ids.adminA)],
    ['Admin A no cambia roles propios','adminA',db=>edit(db,ids.adminA,[ids.roleAdmin])],
    ['Admin A no asigna rol SaaS','adminA',db=>authorize(db,ids.hotelA,[ids.roleSaas])],
    ['Admin A no asigna permisos superiores','adminA',db=>permissions(db,ids.employeeA,[{permiso_id:ids.terrace,checked:true}])],
    ['Admin A no asigna Mesero sin permisos Terraza','adminA',db=>authorize(db,ids.hotelA,[ids.roleWaiter])],
    ['Admin A no modifica superadmin','adminA',db=>permissions(db,ids.saas)],
    ['Admin A no modifica roles superadmin','adminA',db=>edit(db,ids.saas)],
    ['Admin inactivo es rechazado','inactive',db=>authorize(db)],
    ['ID usuario inexistente rechazado','adminA',db=>permissions(db,ids.unknown)],
    ['rol_id inexistente rechazado','adminA',db=>authorize(db,ids.hotelA,[ids.unknown])],
    ['permiso_id inexistente rechazado','adminA',db=>permissions(db,ids.employeeA,[{permiso_id:ids.unknown,checked:true}])],
    ['hotel_id manipulado en permisos rechazado','adminA',db=>permissions(db,ids.employeeA,[],ids.hotelB)],
    ['No permite reclamar Auth ajeno con user_metadata falsificado','adminA',db=>finalize(db,ids.foreignAuth)],
    ['No permite finalizar Auth para otro hotel','adminB',db=>finalize(db,ids.pending,ids.hotelB)],
  ]) await run(name,actor,db=>denied(action(db)));

  for (const actor of ['adminA','receptionist']) {
    for (const [name, sql, args] of [
      ['INSERT permisos','insert into usuarios_permisos(usuario_id,permiso_id) values ($1,$2)',[ids.adminA,ids.terrace]],
      ['DELETE permisos','delete from usuarios_permisos where usuario_id=$1',[ids.adminA]],
      ['UPDATE permisos','update usuarios_permisos set permitido=true where usuario_id=$1',[ids.adminA]],
      ['INSERT rol cross-hotel disfrazado','insert into usuarios_roles(usuario_id,rol_id,hotel_id) values ($1,$2,$3)',[ids.employeeB,ids.roleAdmin,ids.hotelA]],
      ['DELETE roles','delete from usuarios_roles where usuario_id=$1',[ids.adminA]],
      ['UPDATE roles','update usuarios_roles set rol_id=$1 where usuario_id=$2',[ids.roleSaas,ids.adminA]],
    ]) await run(`${actor}: bypass REST ${name} denegado`,actor,db=>denied(db.query(sql,args)));
  }
  await run('Recepcionista no lee usuarios Hotel B', 'receptionist', async db => {
    assert.equal((await db.query('select id from usuarios where hotel_id=$1',[ids.hotelB])).rows.length,0);
  });
  await run('SaaS activo crea colaboradores en Hotel B explícitamente', 'saas', async db => {
    assert.equal((await authorize(db,ids.hotelB,[ids.roleWaiter])).rows[0].hotel,ids.hotelB);
  });
  await run('SaaS activo administra permisos A sin hotel en request', 'saas', db=>permissions(db));
  await run('SaaS real por correo confirmado Auth conserva acceso global', 'whitelistSaas', db=>authorize(db,ids.hotelB));
  await run('SaaS no crea más superadministradores por este flujo', 'saas', db=>denied(authorize(db,ids.hotelB,[ids.roleSaas])));
  await run('Bootstrap del propietario inicial se conserva', 'owner', db=>db.query(
    'insert into usuarios_roles(usuario_id,rol_id,hotel_id) values ($1,$2,$3)',[ids.owner,ids.roleAdmin,ids.hotelA]));
  await t.test('Sin JWT: RPC rechaza auth.uid nulo', () => asActor(db,null,db=>assert.rejects(authorize(db),e=>e.code==='28000')));
  await t.test('anon no tiene EXECUTE de RPC', () => asActor(db,null,db=>denied(authorize(db)),'anon'));
  await t.test('service_role sin actor no puede llamar RPC pública', () => asActor(db,null,db=>denied(authorize(db)),'service_role'));
  await run('No se invoca helper privado por API', 'adminA', db=>denied(db.query('select p0_private.actor_hotel($1)',[ids.hotelA])));
  await t.test('Denegación personalizada editar_usuarios revoca administración', async () => {
    await db.query('insert into usuarios_permisos(usuario_id,permiso_id,permitido) values ($1,$2,false)',[ids.adminA,ids.edit]);
    try { await asActor(db,'adminA',db=>denied(authorize(db))); }
    finally { await db.query('delete from usuarios_permisos where usuario_id=$1',[ids.adminA]); }
  });
  await t.test('Error posterior conserva permisos previos y evita éxito parcial', async () => {
    await asActor(db,'adminA',async db => {
      await db.exec('savepoint mutation');
      await denied(permissions(db,ids.employeeA,[{permiso_id:ids.view,checked:true},{permiso_id:ids.terrace,checked:true}]));
      await db.exec('rollback to savepoint mutation');
      assert.equal((await db.query('select count(*)::int as n from usuarios_permisos where usuario_id=$1',[ids.employeeA])).rows[0].n,0);
    });
  });
  await t.test('Rol inválido no borra roles anteriores', async () => {
    await asActor(db,'adminA',async db => {
      await db.exec('savepoint mutation');
      await denied(edit(db,ids.employeeA,[ids.roleSaas]));
      await db.exec('rollback to savepoint mutation');
      assert.equal((await db.query('select rol_id from usuarios_roles where usuario_id=$1',[ids.employeeA])).rows[0].rol_id,ids.roleCleaner);
    });
  });
  await t.test('Fallo SQL al insertar roles revierte también el perfil nuevo', async () => {
    await db.exec(`alter table usuarios_roles add constraint p0_test_failure check (usuario_id <> '${ids.pending}')`);
    try {
      await asActor(db,'adminA',async db=>{
        await db.exec('savepoint mutation');
        await assert.rejects(finalize(db),e=>e.code==='23514');
        await db.exec('rollback to savepoint mutation');
        assert.equal((await db.query('select id from usuarios where id=$1',[ids.pending])).rows.length,0);
      });
    } finally { await db.exec('alter table usuarios_roles drop constraint p0_test_failure'); }
    assert.equal((await db.query('select id from configuracion_turnos where usuario_id=$1',[ids.pending])).rows.length,0);
  });
  await t.test('Correo del perfil o JWT manipulado no concede superadministración', async () => {
    const whitelistEmail=latestFunction('is_whitelisted_saas_superadmin_email').match(/IN\s*\('([^']+)'/i)[1];
    await db.query('update usuarios set correo=$1 where id=$2',[whitelistEmail,ids.owner]);
    try {
      await asActor(db,'owner',async db=>{
        await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:ids.owner,email:whitelistEmail,role:'authenticated'})]);
        assert.equal((await db.query('select actor_is_saas_superadmin() as allowed')).rows[0].allowed,false);
        await denied(authorize(db,ids.hotelB));
      });
    } finally { await db.query("update usuarios set correo='owner@example.test' where id=$1",[ids.owner]); }
  });
  await t.test('SaaS inactivo rechazado aunque conserve identidad verificada',async()=>{
    await db.query('update usuarios set activo=false where id=$1',[ids.whitelistSaas]);
    try { await asActor(db,'whitelistSaas',db=>denied(authorize(db,ids.hotelB))); }
    finally { await db.query('update usuarios set activo=true where id=$1',[ids.whitelistSaas]); }
  });
  await t.test('Administrador no actualiza ni elimina superadmin del mismo hotel por REST',async()=>{
    await db.query('update usuarios set hotel_id=$1 where id=$2',[ids.hotelA,ids.saas]);
    try {
      await asActor(db,'adminA',async db=>{
        assert.equal((await db.query('update usuarios set activo=false where id=$1 returning id',[ids.saas])).rows.length,0);
        assert.equal((await db.query('delete from usuarios where id=$1 returning id',[ids.saas])).rows.length,0);
      });
    } finally { await db.query('update usuarios set hotel_id=null where id=$1',[ids.saas]); }
  });
  for (const items of [[{permiso_id:ids.view,checked:'true'}], [{permiso_id:ids.view,checked:true,rol:'superadmin'}],
    [{permiso_id:ids.view,checked:true},{permiso_id:ids.view,checked:false}], {}, null]) {
    await run(`Payload permisos inválido: ${JSON.stringify(items)}`, 'adminA', db=>assert.rejects(permissions(db,ids.employeeA,items),e=>e.code==='22023'));
  }
});

test('P0: configuración JWT y contrato frontend seguro', () => {
  const root = path.resolve(__dirname,'..');
  const config = fs.readFileSync(path.join(root,'supabase/config.toml'),'utf8');
  for (const name of ['crear_colaborador','actualizar_permisos_usuario']) assert.match(config,new RegExp(`\\[functions\\.${name}\\]\\s*verify_jwt = true`));
  const source = fs.readFileSync(path.join(root,'js/modules/usuarios/usuarios.js'),'utf8');
  assert.match(source,/rpc\('p0_editar_colaborador'/);
  assert.doesNotMatch(source,/auth\.signUp|from\('usuarios_roles'\)\.delete/);
});
