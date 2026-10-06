const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');
const { build } = require('esbuild');

const compiled = new Map();
async function harness(name, options = {}) {
  if (!compiled.has(name)) {
    const result = await build({
      entryPoints:[path.resolve(__dirname,`../supabase/functions/${name}/index.ts`)],
      bundle:true, write:false, format:'cjs', platform:'node', external:['npm:*'],
      define:{'import.meta.main':'false'},
    });
    compiled.set(name,result.outputFiles[0].text);
  }
  const calls = [];
  const client = {
    auth:{getUser: async token => {
      calls.push(['getUser',token]);
      return options.invalidToken || token !== 'valid-user-jwt'
        ? {data:{user:null},error:{message:'sensitive-auth-error'}}
        : {data:{user:{id:'trusted-actor',is_anonymous:!!options.anonymous}},error:null};
    }},
    rpc:async (name,args) => {
      calls.push([name,args]);
      const error = name === 'p0_autorizar_colaborador' ? options.authorizationError : options.mutationError;
      if (options.transportFailure) throw new Error('sensitive-transport-error');
      return {data:name === 'p0_autorizar_colaborador' ? 'trusted-hotel' : null,error:error || null};
    },
  };
  const admin = {
    auth:{admin:{
      createUser:async args=>{calls.push(['createUser',args]);return {data:{user:{id:'new-user'}},error:options.createError || null};},
      updateUserById:async (...args)=>{calls.push(['enable',...args]);return {error:options.enableError || null};},
      deleteUser:async id=>{
        calls.push(['deleteAuth',id]);
        if (options.rollbackTransportError) throw new Error('sensitive-delete-error');
        return {error:options.rollbackError || null};
      },
    }},
    from:table=>({delete:()=>{
      const filters = [];
      const query = {eq:(key,value)=>{filters.push([key,value]);return query;},then:resolve=>{
        calls.push(['deleteTable',table,filters]);return Promise.resolve(resolve({error:null}));
      }};
      return query;
    }}),
  };
  const exported = {exports:{}};
  const sdk = {createClient:(url,key,config)=>{
    calls.push(['client',key,config]);return key === 'test-anon-key' ? client : admin;
  }};
  vm.runInNewContext(compiled.get(name),{
    module:exported,exports:exported.exports,require:()=>sdk,
    Request,Response,Headers,Error,SyntaxError,console:{error:(...args)=>calls.push(['log',...args])},
    Deno:{env:{get:key=>({SUPABASE_URL:'https://test.invalid',SUPABASE_ANON_KEY:'test-anon-key',SUPABASE_SERVICE_ROLE_KEY:'test-service-key'})[key]}},
  });
  return {handler:exported.exports.createHandler(),calls};
}
const createBody = {correo:'employee@example.test',password:'test-password',nombre:'Employee',hotel_id:'request-hotel',roles:['role-id']};
const permissionBody = {usuario_id:'target-id',permisos:[{permiso_id:'permission-id',checked:true}]};
const request = (body, token='valid-user-jwt', method='POST') => new Request('https://test.invalid',{
  method,headers:token ? {Authorization:`Bearer ${token}`} : {},
  ...(method === 'POST' ? {body:JSON.stringify(body)} : {}),
});
const privileged = calls=>calls.some(call=>call[0] === 'client' && call[1] === 'test-service-key');

for (const name of ['crear_colaborador','actualizar_permisos_usuario']) {
  const input = name === 'crear_colaborador' ? createBody : permissionBody;
  for (const [label,token,opts] of [['sin JWT',null,{}],['JWT inválido','bad-jwt',{}],['anon key','anon-public-key',{}],
    ['JWT expirado','valid-user-jwt',{invalidToken:true}],['sesión anónima','valid-user-jwt',{anonymous:true}]]) {
    test(`${name}: ${label} => 401 antes de cualquier mutación`,async()=>{
      const {handler,calls}=await harness(name,opts);
      const response=await handler(request(input,token));
      assert.equal(response.status,401);
      assert.equal(privileged(calls),false);
      assert.equal(calls.some(c=>c[0].startsWith('p0_')),false);
    });
  }
  test(`${name}: JWT válido sin permiso => 403 sin service_role`,async()=>{
    const {handler,calls}=await harness(name,{authorizationError:{code:'42501'},mutationError:{code:'42501'}});
    assert.equal((await handler(request(input))).status,403);
    assert.equal(privileged(calls),false);
  });
  test(`${name}: request manipulado con rol/rol_id/actor rechazado`,async()=>{
    for (const injected of [{rol:'superadmin'},{rol_id:'forged'},{actor_id:'forged'},{is_superadmin:true}]) {
      const {handler,calls}=await harness(name);
      assert.equal((await handler(request({...input,...injected}))).status,400);
      assert.equal(privileged(calls),false);
    }
  });
  test(`${name}: OPTIONS permite CORS y GET no muta`,async()=>{
    const {handler,calls}=await harness(name);
    const response=await handler(request(null,null,'OPTIONS'));
    assert.equal(response.status,200);
    assert.match(response.headers.get('Access-Control-Allow-Headers'),/apikey/);
    assert.equal((await handler(request(null,null,'GET'))).status,405);
    assert.equal(calls.length,0);
  });
  test(`${name}: no filtra errores del proveedor`,async()=>{
    const {handler}=await harness(name,{transportFailure:true});
    const response=await handler(request(input));
    assert.equal(response.status,500);
    assert.doesNotMatch(await response.text(),/sensitive|test-service-key|test-password/);
  });
}

test('crear_colaborador: orden autenticación/autorización/Auth/finalización/habilitación y contrato',async()=>{
  const {handler,calls}=await harness('crear_colaborador');
  const response=await handler(request(createBody));
  assert.equal(response.status,200);
  assert.equal((await response.json()).userId,'new-user');
  const order=calls.map(c=>c[0]);
  for (const [a,b] of [['getUser','p0_autorizar_colaborador'],['p0_autorizar_colaborador','createUser'],
    ['createUser','p0_finalizar_colaborador'],['p0_finalizar_colaborador','enable']]) assert.ok(order.indexOf(a)<order.indexOf(b));
  const attrs=calls.find(c=>c[0]==='createUser')[1];
  assert.equal(attrs.ban_duration,'876000h');
  assert.equal(attrs.app_metadata.p0_created_by,'trusted-actor');
  assert.equal(attrs.app_metadata.p0_hotel_id,'trusted-hotel');
  assert.equal(calls.find(c=>c[0]==='p0_finalizar_colaborador')[1].p_hotel_id,'trusted-hotel');
  assert.deepEqual(calls.filter(c=>c[0]==='deleteAuth'),[]);
});
test('crear_colaborador: inactivo conserva Auth bloqueado',async()=>{
  const {handler,calls}=await harness('crear_colaborador');
  assert.equal((await handler(request({...createBody,activo:false}))).status,200);
  assert.equal(calls.some(c=>c[0]==='enable'),false);
  assert.equal(calls.find(c=>c[0]==='p0_finalizar_colaborador')[1].p_activo,false);
});
for (const [label,opts] of [['perfil/roles',{mutationError:{code:'23503',message:'sensitive-sql'}}],
  ['autorización revocada durante creación',{mutationError:{code:'42501'}}],['habilitación Auth',{enableError:{message:'sensitive-auth'}}]]) {
  test(`crear_colaborador: fallo ${label} compensa Auth/perfil/configuración por hotel`,async()=>{
    const {handler,calls}=await harness('crear_colaborador',opts);
    const response=await handler(request(createBody));
    assert.equal(response.status,opts.mutationError?.code === '42501' ? 403 : 500);
    assert.equal(calls.some(c=>c[0]==='deleteAuth' && c[1]==='new-user'),true);
    for(const table of ['usuarios','configuracion_turnos']) {
      const deletion=calls.find(c=>c[0]==='deleteTable' && c[1]===table);
      assert.ok(deletion[2].some(([key,value])=>key==='hotel_id' && value==='trusted-hotel'));
    }
    assert.doesNotMatch(await response.text(),/sensitive/);
  });
}
for (const opts of [{rollbackError:{message:'sensitive'}},{rollbackTransportError:true}]) {
  test('crear_colaborador: compensación incompleta intenta todas las limpiezas y registra código seguro',async()=>{
    const {handler,calls}=await harness('crear_colaborador',{mutationError:{code:'23503'},...opts});
    const response=await handler(request(createBody));
    assert.equal(response.status,500);
    assert.match(await response.text(),/revisión/);
    assert.ok(calls.some(c=>c[0]==='deleteTable' && c[1]==='usuarios'));
    assert.deepEqual(calls.filter(c=>c[0]==='log').map(c=>c[1]),['[crear_colaborador] ROLLBACK_INCOMPLETE']);
  });
}
test('crear_colaborador: fallo Auth no intenta guardar perfil y no expone correo existente',async()=>{
  const {handler,calls}=await harness('crear_colaborador',{createError:{message:'sensitive existing user'}});
  const response=await handler(request(createBody));
  assert.equal(response.status,400);
  assert.equal(calls.some(c=>c[0]==='p0_finalizar_colaborador'),false);
  assert.doesNotMatch(await response.text(),/sensitive|existing/);
});
test('actualizar_permisos_usuario: éxito conserva contrato y nunca obtiene service_role',async()=>{
  const {handler,calls}=await harness('actualizar_permisos_usuario');
  const response=await handler(request(permissionBody));
  assert.equal(response.status,200);
  assert.equal((await response.json()).success,true);
  assert.equal(privileged(calls),false);
});

for (const [editing, failing] of [[false,false],[true,false],[true,true]]) {
  test(`Frontend real: ${editing ? 'edición' : 'creación'} ${failing ? 'rechazada conserva formulario' : 'exitosa actualiza lista'}`,async()=>{
    const source=fs.readFileSync(path.resolve(__dirname,'../js/modules/usuarios/usuarios.js'),'utf8');
    const functionSource=source.slice(source.indexOf('async function formSubmitHandler('),source.indexOf('// ----------- Unmount -----------'));
    const calls=[];
    const button={disabled:false};
    const form={querySelector:selector=>selector === '#usuario-correo' ? {value:'employee@example.test'} : button};
    const fields={usuarioIdEdit:editing ? 'target-id' : '',nombre:'Employee',password:'test-password',activo:'on'};
    const result={data:{userId:'created-id'},error:failing ? {message:'Operación no autorizada.'} : null};
    const context={
      FormData:class {get(key){return fields[key];}},
      currentHotelId:'hotel-hint',currentModuleUser:{id:'actor-id'},
      currentSupabaseInstance:{
        rpc:async (...args)=>{calls.push(['rpc',...args]);return result;},
        functions:{invoke:async (...args)=>{calls.push(['invoke',...args]);return result;}},
        from:()=>{throw new Error('Unexpected direct table mutation');},
      },
      clearUsuariosFeedback:()=>{},
      showUsuariosFeedback:(_el,message,type)=>calls.push(['feedback',message,type]),
      registrarAccionSensible:async()=>calls.push(['audit']),getRoleNamesFromSelection:()=>['Recepcionista'],
      cargarYRenderizarUsuarios:async()=>calls.push(['refresh']),renderHorarioTurnosSemanal:async()=>{},
      resetearFormularioUsuario:()=>calls.push(['reset']),
    };
    vm.createContext(context);
    vm.runInContext(functionSource,context);
    await context.formSubmitHandler({preventDefault(){}},form,{selectedOptions:[{value:'role-id'}]},{});
    const mutation=calls.find(c=>c[0]===(editing ? 'rpc' : 'invoke'));
    assert.equal(mutation[1],editing ? 'p0_editar_colaborador' : 'crear_colaborador');
    assert.equal(editing ? mutation[2].p_usuario_id : mutation[2].body.activo,editing ? 'target-id' : true);
    assert.equal(calls.some(c=>c[0]==='reset'),!failing);
    assert.equal(calls.some(c=>c[0]==='refresh'),!failing);
    assert.equal(button.disabled,false);
    assert.ok(calls.some(c=>c[0]==='feedback' && c[2]===(failing ? 'error-indicator' : 'success-indicator')));
  });
}
