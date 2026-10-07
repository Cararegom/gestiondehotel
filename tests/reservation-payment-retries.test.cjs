const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const storage = new Map();
global.window={sessionStorage:{ getItem:(key)=>storage.get(key),
  setItem:(key,value)=>storage.set(key,value),removeItem:(key)=>storage.delete(key) }};
const modules=async()=>({
  payments:await import(pathToFileURL(resolve('js/services/fase1OperationService.js')).href),
  lifecycle:await import(pathToFileURL(resolve('js/services/reservationLifecycleService.js')).href)
});
const extension={reservaId:'reserva-test',fechaFinAnterior:'2026-10-07T17:00:00Z',
  nuevaFechaFin:'2026-10-08T17:00:00Z',monto:60000,descripcion:'1 noche',
  pagos:[{metodo_pago_id:'method',monto:60000}],turnoId:'shift'};

test('dos confirmaciones simultaneas de extension envian una sola solicitud', async()=>{
  const {lifecycle}=await modules();
  let calls=0,finish;
  const supabase={rpc:async()=>{calls++;return new Promise((resolve)=>{finish=resolve;});}};
  const first=lifecycle.extenderEstanciaReservaAtomica(supabase,extension);
  const second=lifecycle.extenderEstanciaReservaAtomica(supabase,extension);
  assert.equal(calls,1);
  finish({data:{reserva:{id:extension.reservaId},pagos:[{pago_id:'single'}]},error:null});
  assert.deepEqual(await first,await second);
});
test('la respuesta perdida conserva el UUID al reintentar incluso con storage deshabilitado',async()=>{
  const {lifecycle}=await modules();
  const normal=window.sessionStorage;
  window.sessionStorage={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');},removeItem(){throw new Error('blocked');}};
  const attempts=[];
  const supabase={rpc:async(name,payload)=>{
    attempts.push(payload);
    return attempts.length===1 ? {error:{message:'network response lost'}} : {data:{reserva:{id:'ok'}},error:null};
  }};
  try {
    const options={...extension,reservaId:'network-retry'};
    await assert.rejects(lifecycle.extenderEstanciaReservaAtomica(supabase,options),/network response lost/);
    await lifecycle.extenderEstanciaReservaAtomica(supabase,options);
    assert.equal(attempts[0].p_client_operation_id,attempts[1].p_client_operation_id);
  } finally {window.sessionStorage=normal;}
});
test('un pago mixto incompleto conserva el UUID de la parte ya cobrada',async()=>{
  const {payments}=await modules();
  const seen=[],saved=new Map();
  let failSecond=true;
  const supabase={rpc:async(name,payload)=>{
    seen.push(payload);
    if(payload.p_metodo_pago_id==='second'&&failSecond){failSecond=false;return {error:{message:'offline'}};}
    if(!saved.has(payload.p_client_operation_id))saved.set(payload.p_client_operation_id,`payment-${saved.size+1}`);
    return {data:{pago_id:saved.get(payload.p_client_operation_id),caja_id:'cash'},error:null};
  }};
  const options={reservaId:'mixed-retry',pagos:[{metodo_pago_id:'first',monto:20000},
    {metodo_pago_id:'second',monto:40000}],turnoId:'shift',concepto:'Abono',operationKey:'business-op'};
  await assert.rejects(payments.procesarPagosReservaAtomicos(supabase,options),(error)=>error.message==='offline');
  await payments.procesarPagosReservaAtomicos(supabase,options);
  assert.equal(seen[0].p_client_operation_id,seen[2].p_client_operation_id);
  assert.equal(seen[1].p_client_operation_id,seen[3].p_client_operation_id);
  assert.equal(saved.size,2);
});
test('dos envios simultaneos del mismo abono comparten respuesta y UUID',async()=>{
  const {payments}=await modules();
  let calls=0,finish;
  const supabase={rpc:async()=>{calls++;return new Promise(resolve=>{finish=resolve;});}};
  const options={reservaId:'parallel-payment',monto:60000,metodoPagoId:'method',turnoId:'shift',concepto:'Abono'};
  const first=payments.procesarPagoReservaAtomico(supabase,options);
  const second=payments.procesarPagoReservaAtomico(supabase,options);
  assert.equal(calls,1);
  finish({data:{pago_id:'single',caja_id:'single'},error:null});
  assert.deepEqual(await first,await second);
});
