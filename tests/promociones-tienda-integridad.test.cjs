const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migrationPath = 'supabase/migrations/20260903203000_promociones_tienda_integridad.sql';
const sql = fs.readFileSync(migrationPath, 'utf8');

test('el esquema admite promociones para productos específicos de tienda', () => {
  assert.match(sql, /ALTER TYPE public\.tipo_aplicabilidad_descuento\s+ADD VALUE IF NOT EXISTS 'productos_tienda'/i);
});

test('crear editar y eliminar promociones queda limitado a administradores', () => {
  assert.match(sql, /CREATE POLICY descuentos_insert_admin[\s\S]*FOR INSERT[\s\S]*TO authenticated[\s\S]*usuario_actual_es_admin_hotel\(hotel_id\)/i);
  assert.match(sql, /CREATE POLICY descuentos_update_admin[\s\S]*FOR UPDATE[\s\S]*usuario_actual_es_admin_hotel\(hotel_id\)/i);
  assert.match(sql, /CREATE POLICY descuentos_delete_admin[\s\S]*FOR DELETE[\s\S]*usuario_actual_es_admin_hotel\(hotel_id\)/i);
  assert.match(sql, /DROP POLICY IF EXISTS "Los usuarios pueden crear descuentos para su hotel"/i);
  assert.match(sql, /DROP POLICY IF EXISTS "Los usuarios pueden actualizar los descuentos de su hotel"/i);
  assert.match(sql, /DROP POLICY IF EXISTS "Los usuarios pueden eliminar los descuentos de su hotel"/i);
});

test('la venta de tienda conserva la firma pública compatible', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.procesar_venta_tienda_atomica\(\s*p_items jsonb,\s*p_pagos jsonb,\s*p_modo text,\s*p_turno_id uuid,\s*p_client_operation_id uuid,\s*p_reserva_id uuid DEFAULT NULL,\s*p_habitacion_id uuid DEFAULT NULL,\s*p_cliente_temporal text DEFAULT NULL,\s*p_descuento_id uuid DEFAULT NULL,\s*p_occurred_at timestamptz DEFAULT now\(\)/is);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.procesar_venta_tienda_atomica\(jsonb,jsonb,text,uuid,uuid,uuid,uuid,text,uuid,timestamptz\)/i);
});

test('el backend valida vigencia completa y bloquea carreras de usos del descuento', () => {
  assert.match(sql, /d\.expiracion IS NULL OR d\.expiracion>=coalesce\(p_occurred_at,now\(\)\)/i);
  assert.match(sql, /d\.usos_maximos=0 OR d\.usos_actuales<d\.usos_maximos/i);
  assert.match(sql, /SELECT \* INTO v_discount_row[\s\S]*FROM public\.descuentos[\s\S]*FOR UPDATE;/i);
  assert.match(sql, /UPDATE public\.descuentos\s+SET usos_actuales=usos_actuales\+1\s+WHERE id=v_discount_row\.id/i);
});

test('tienda solo admite descuentos de código en el flujo manual', () => {
  assert.match(sql, /d\.tipo_descuento_general='codigo'/i);
  assert.match(sql, /d\.codigo IS NOT NULL/i);
  assert.match(sql, /btrim\(d\.codigo\)<>''/i);
});

test('productos específicos descuentan únicamente la base afectada', () => {
  assert.match(sql, /v_discount_row\.aplicabilidad::text='productos_tienda'/i);
  assert.match(sql, /p\.id::text=ANY\(coalesce\(v_discount_row\.habitaciones_aplicables/i);
  assert.match(sql, /INTO v_affected/i);
  assert.match(sql, /v_affected\*v_discount_row\.valor\/100/i);
  assert.match(sql, /least\(v_affected, greatest\(0, v_discount_row\.valor\)\)/i);
  assert.doesNotMatch(sql, /v_subtotal\*v_discount_row\.valor\/100/);
});

test('un descuento de otro ámbito se rechaza en tienda', () => {
  assert.match(sql, /RAISE EXCEPTION 'Descuento no aplicable a tienda'/i);
  assert.match(sql, /RAISE EXCEPTION 'El descuento no aplica a los productos vendidos'/i);
});

test('la función conserva fecha operativa central y seguridad de ejecución', () => {
  assert.match(sql, /public\.hotel_business_date\(v_actor\.hotel_id,coalesce\(p_occurred_at,now\(\)\)\)/i);
  assert.match(sql, /SECURITY DEFINER\s+SET search_path=pg_catalog,public/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC,anon/i);
});

test('Promociones ya expone la opción de productos de tienda que habilita la migración', () => {
  const source = fs.readFileSync('js/modules/descuentos/descuentos.js', 'utf8');
  assert.match(source, /option value="productos_tienda"/i);
});
