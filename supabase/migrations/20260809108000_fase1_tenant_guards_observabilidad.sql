-- Fase 1 / 09: rechazar referencias cross-hotel nuevas y exponer alertas read-only.
-- Dependencias: tablas operativas existentes.
-- Riesgo: escrituras legacy con referencias inconsistentes nuevas seran rechazadas.
-- Rollback logico: deshabilitar triggers; no toca filas historicas.
-- Tests: fase1-security-migrations.test.cjs y branch multi-hotel.

CREATE OR REPLACE FUNCTION public.fase1_guard_pagos_reserva_hotel() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.reservas r WHERE r.id=NEW.reserva_id AND r.hotel_id=NEW.hotel_id) THEN RAISE EXCEPTION 'Reserva y pago deben pertenecer al mismo hotel' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.metodos_pago m WHERE m.id=NEW.metodo_pago_id AND m.hotel_id=NEW.hotel_id) THEN RAISE EXCEPTION 'Metodo y pago deben pertenecer al mismo hotel' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS fase1_guard_pagos_reserva_hotel_trg ON public.pagos_reserva;
CREATE TRIGGER fase1_guard_pagos_reserva_hotel_trg BEFORE INSERT OR UPDATE OF hotel_id,reserva_id,metodo_pago_id ON public.pagos_reserva FOR EACH ROW EXECUTE FUNCTION public.fase1_guard_pagos_reserva_hotel();

CREATE OR REPLACE FUNCTION public.fase1_guard_caja_hotel() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN
 IF NEW.reserva_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.reservas x WHERE x.id=NEW.reserva_id AND x.hotel_id=NEW.hotel_id) THEN RAISE EXCEPTION 'Caja/reserva cross-hotel' USING ERRCODE='23514'; END IF;
 IF NEW.pago_reserva_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.pagos_reserva x WHERE x.id=NEW.pago_reserva_id AND x.hotel_id=NEW.hotel_id) THEN RAISE EXCEPTION 'Caja/pago cross-hotel' USING ERRCODE='23514'; END IF;
 IF NEW.venta_tienda_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.ventas_tienda x WHERE x.id=NEW.venta_tienda_id AND x.hotel_id=NEW.hotel_id) THEN RAISE EXCEPTION 'Caja/tienda cross-hotel' USING ERRCODE='23514'; END IF;
 IF NEW.venta_restaurante_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.ventas_restaurante x WHERE x.id=NEW.venta_restaurante_id AND x.hotel_id=NEW.hotel_id) THEN RAISE EXCEPTION 'Caja/restaurante cross-hotel' USING ERRCODE='23514'; END IF;
 IF NEW.venta_terraza_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.terraza_pedidos x WHERE x.id=NEW.venta_terraza_id AND x.hotel_id=NEW.hotel_id) THEN RAISE EXCEPTION 'Caja/Terraza cross-hotel' USING ERRCODE='23514'; END IF;
 IF NEW.compra_tienda_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.compras_tienda x WHERE x.id=NEW.compra_tienda_id AND x.hotel_id=NEW.hotel_id) THEN RAISE EXCEPTION 'Caja/compra cross-hotel' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS fase1_guard_caja_hotel_trg ON public.caja;
CREATE TRIGGER fase1_guard_caja_hotel_trg BEFORE INSERT OR UPDATE OF hotel_id,reserva_id,pago_reserva_id,venta_tienda_id,venta_restaurante_id,venta_terraza_id,compra_tienda_id ON public.caja FOR EACH ROW EXECUTE FUNCTION public.fase1_guard_caja_hotel();

CREATE OR REPLACE FUNCTION public.fase1_guard_detalle_tienda_hotel() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ventas_tienda v JOIN public.productos_tienda p ON p.id=NEW.producto_id WHERE v.id=NEW.venta_id AND v.hotel_id=NEW.hotel_id AND p.hotel_id=NEW.hotel_id) THEN RAISE EXCEPTION 'Detalle tienda cross-hotel' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS fase1_guard_detalle_tienda_hotel_trg ON public.detalle_ventas_tienda;
CREATE TRIGGER fase1_guard_detalle_tienda_hotel_trg BEFORE INSERT OR UPDATE ON public.detalle_ventas_tienda FOR EACH ROW EXECUTE FUNCTION public.fase1_guard_detalle_tienda_hotel();

CREATE OR REPLACE FUNCTION public.fase1_guard_rest_item_hotel() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ventas_restaurante v JOIN public.platos p ON p.id=NEW.plato_id WHERE v.id=NEW.venta_id AND p.hotel_id=v.hotel_id) THEN RAISE EXCEPTION 'Item restaurante cross-hotel' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS fase1_guard_rest_item_hotel_trg ON public.ventas_restaurante_items;
CREATE TRIGGER fase1_guard_rest_item_hotel_trg BEFORE INSERT OR UPDATE ON public.ventas_restaurante_items FOR EACH ROW EXECUTE FUNCTION public.fase1_guard_rest_item_hotel();

CREATE OR REPLACE FUNCTION public.fase1_integrity_snapshot(p_since timestamptz DEFAULT now()-interval '1 day') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_hotel uuid;
BEGIN
 SELECT u.hotel_id INTO v_hotel FROM public.usuarios u WHERE u.id=auth.uid() AND u.activo;
 IF v_hotel IS NULL OR NOT public.fase1_actor_tiene_permiso(v_hotel,'finanzas.ver') THEN RAISE EXCEPTION 'Sin permiso' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object(
  'hotel_id',v_hotel,'since',p_since,'generated_at',now(),
  'payments_without_cash',(SELECT count(*) FROM public.pagos_reserva p WHERE p.hotel_id=v_hotel AND p.creado_en>=p_since AND p.source='reservation_payment' AND NOT EXISTS(SELECT 1 FROM public.caja c WHERE c.pago_reserva_id=p.id)),
  'payments_multiple_cash',(SELECT count(*) FROM public.pagos_reserva p WHERE p.hotel_id=v_hotel AND p.creado_en>=p_since AND p.source='reservation_payment' AND 1<(SELECT count(*) FROM public.caja c WHERE c.pago_reserva_id=p.id)),
  'store_sales_without_detail',(SELECT count(*) FROM public.ventas_tienda v WHERE v.hotel_id=v_hotel AND v.creado_en>=p_since AND v.source='store_atomic' AND NOT EXISTS(SELECT 1 FROM public.detalle_ventas_tienda d WHERE d.venta_id=v.id)),
  'store_sales_without_cash',(SELECT count(*) FROM public.ventas_tienda v WHERE v.hotel_id=v_hotel AND v.creado_en>=p_since AND v.source='store_atomic' AND v.estado_pago='pagado' AND NOT EXISTS(SELECT 1 FROM public.caja c WHERE c.venta_tienda_id=v.id)),
  'negative_stock',(SELECT count(*) FROM public.productos_tienda p WHERE p.hotel_id=v_hotel AND p.stock_actual<0)
 );
END $$;
REVOKE ALL ON FUNCTION public.fase1_integrity_snapshot(timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fase1_integrity_snapshot(timestamptz) TO authenticated,service_role;
