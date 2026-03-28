-- Baseline del schema public de Gestion de Hotel
-- Generado automaticamente desde snapshots del proyecto remoto Supabase.
-- Fecha de generacion: 2026-03-26

BEGIN;
SET check_function_bodies = off;

CREATE SCHEMA IF NOT EXISTS public;

CREATE EXTENSION IF NOT EXISTS "citext" WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

CREATE TYPE "public"."amenidad_update" AS (
  "item_id" uuid,
  "default_qty" integer,
  "min_alert_qty" integer
);

CREATE TYPE "public"."tipo_estado_habitacion" AS ENUM ('bloqueada', 'disponible', 'limpieza', 'mantenimiento', 'ocupada');

CREATE TYPE "public"."tipo_descuento" AS ENUM ('fijo', 'porcentaje');

CREATE TYPE "public"."plan_hotel_enum" AS ENUM ('lite', 'max', 'pro', 'prueba');

CREATE TYPE "public"."rol_usuario_enum" AS ENUM ('admin', 'camarera', 'conserje', 'mantenimiento', 'recepcionista', 'superadmin');

CREATE TYPE "public"."estado_habitacion_enum" AS ENUM ('bloqueada', 'libre', 'limpieza', 'mantenimiento', 'ocupada', 'reservada', 'tiempo agotado');

CREATE TYPE "public"."estado_reserva_enum" AS ENUM ('activa', 'cancelada', 'cancelada_mantenimiento', 'check_in', 'check_out', 'completada', 'confirmada', 'facturada_pagada', 'finalizada', 'finalizada_auto', 'no_show', 'ocupada', 'pendiente', 'reservada', 'tiempo agotado');

CREATE TYPE "public"."tipo_movimiento_caja_enum" AS ENUM ('ajuste', 'apertura', 'cierre', 'egreso', 'ingreso');

CREATE TYPE "public"."estado_tarea_enum" AS ENUM ('cancelada', 'completada', 'en_progreso', 'pendiente');

CREATE TYPE "public"."tipo_tarea_enum" AS ENUM ('general', 'habitacion', 'otro', 'piscina');

CREATE TYPE "public"."frecuencia_tarea_enum" AS ENUM ('diaria', 'mensual', 'personalizada', 'semanal', 'unica');

CREATE TYPE "public"."tipo_notificacion_enum" AS ENUM ('cambio_estado_mantenimiento', 'check_in_realizado', 'check_out_realizado', 'general_info', 'limpieza_completada', 'mantenimiento', 'mantenimiento_completado', 'mantenimiento_requerido', 'nueva_reserva_manual', 'nueva_reserva_web', 'piscina_tarea_completada', 'piscina_tarea_vencida', 'reserva_actualizada', 'reserva_cancelada', 'sistema_alerta', 'stock_bajo_tienda', 'tarea_mantenimiento', 'urgencia_operativa');

CREATE TYPE "public"."tipo_estado_reserva" AS ENUM ('activa', 'cancelada', 'cancelada_mantenimiento', 'check_in', 'check_out', 'completada', 'confirmada', 'facturada_pagada', 'finalizada_auto', 'reservada', 'tiempo agotado');

CREATE TYPE "public"."tipo_aplicabilidad_descuento" AS ENUM ('categorias_restaurante', 'habitaciones_especificas', 'por_codigo', 'reserva_total', 'servicios_adicionales', 'tiempos_estancia_especificos', 'todas_las_habitaciones');

CREATE TYPE "public"."tipo_accion_articulo" AS ENUM ('devuelto', 'perdido', 'prestado');

CREATE SEQUENCE "public"."planes_id_seq" AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE SEQUENCE "public"."caja_movimientos_eliminados_id_seq" AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE "public"."inventario_prestables" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid NOT NULL,
  "nombre_item" text NOT NULL,
  "stock_total" integer DEFAULT 0 NOT NULL,
  "stock_disponible" integer DEFAULT 0 NOT NULL,
  "stock_minimo_alerta" integer DEFAULT 1
);

CREATE TABLE "public"."historial_chat" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "telefono" text NOT NULL,
  "rol" text NOT NULL,
  "mensaje" text NOT NULL,
  "timestamp" timestamp with time zone DEFAULT now()
);

CREATE TABLE "public"."turnos" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid NOT NULL,
  "usuario_id" uuid NOT NULL,
  "fecha_apertura" timestamp with time zone DEFAULT now() NOT NULL,
  "fecha_cierre" timestamp with time zone,
  "estado" character varying(20) DEFAULT 'abierto'::character varying NOT NULL,
  "balance_final" numeric(10,2)
);

CREATE TABLE "public"."servicios_adicionales" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid NOT NULL,
  "tipo_id" uuid,
  "nombre" text NOT NULL,
  "descripcion" text,
  "precio" numeric NOT NULL,
  "activo" boolean DEFAULT true,
  "creado_en" timestamp with time zone DEFAULT now(),
  "actualizado_en" timestamp with time zone DEFAULT now()
);

CREATE TABLE "public"."roles" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "nombre" text NOT NULL,
  "descripcion" text,
  "creado_en" timestamp with time zone DEFAULT now()
);

CREATE TABLE "public"."roles_permisos" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "rol_id" uuid,
  "permiso_id" uuid
);

CREATE TABLE "public"."tipos_servicio" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid,
  "nombre" text NOT NULL,
  "activo" boolean DEFAULT true,
  "creado_en" timestamp with time zone DEFAULT now(),
  "actualizado_en" timestamp with time zone DEFAULT now()
);

CREATE TABLE "public"."inventario_lenceria" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid NOT NULL,
  "nombre_item" text NOT NULL,
  "stock_total" integer DEFAULT 0 NOT NULL,
  "stock_limpio_almacen" integer DEFAULT 0 NOT NULL,
  "stock_en_lavanderia" integer DEFAULT 0 NOT NULL,
  "stock_minimo_alerta" integer DEFAULT 10
);

CREATE TABLE "public"."categorias_producto" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid NOT NULL,
  "nombre" text NOT NULL,
  "descripcion" text,
  "activa" boolean DEFAULT true,
  "creado_en" timestamp with time zone DEFAULT now(),
  "actualizado_en" timestamp with time zone DEFAULT now()
);

CREATE TABLE "public"."detalle_ventas_tienda" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "venta_id" uuid NOT NULL,
  "producto_id" uuid NOT NULL,
  "cantidad" integer NOT NULL,
  "precio_unitario_venta" numeric NOT NULL,
  "subtotal" numeric NOT NULL,
  "hotel_id" uuid NOT NULL,
  "creado_en" timestamp with time zone DEFAULT now()
);

CREATE TABLE "public"."platos" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid NOT NULL,
  "nombre" text NOT NULL,
  "descripcion" text,
  "precio" numeric NOT NULL,
  "activo" boolean DEFAULT true,
  "creado_en" timestamp with time zone DEFAULT now(),
  "actualizado_en" timestamp with time zone DEFAULT now(),
  "imagen_url" text,
  "categoria_id" uuid
);

CREATE TABLE "public"."integraciones_hotel" (
  "hotel_id" uuid NOT NULL,
  "webhook_reservas" text,
  "api_channel_manager" text,
  "crm_url" text,
  "crm_token" text,
  "updated_at" timestamp with time zone,
  "facturador_nombre" text,
  "facturador_api_url" text,
  "facturador_api_key" text,
  "facturador_usuario" text,
  "facturador_empresa" text
);

CREATE TABLE "public"."bitacora" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid,
  "usuario_id" uuid,
  "modulo" text NOT NULL,
  "accion" text NOT NULL,
  "detalles" jsonb,
  "creado_en" timestamp without time zone DEFAULT now()
);

CREATE TABLE "public"."proveedores" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid NOT NULL,
  "nombre" text NOT NULL,
  "contacto_nombre" text,
  "telefono" text,
  "email" text,
  "direccion" text,
  "nit" text,
  "activo" boolean DEFAULT true,
  "creado_en" timestamp with time zone DEFAULT now(),
  "actualizado_en" timestamp with time zone DEFAULT now()
);

CREATE TABLE "public"."mi_tabla" (
  "columna1" text,
  "columna2" integer
);

CREATE TABLE "public"."usuarios_permisos" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "usuario_id" uuid,
  "permiso_id" uuid,
  "permitido" boolean DEFAULT true NOT NULL
);

CREATE TABLE "public"."ventas_restaurante_items" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "venta_id" uuid NOT NULL,
  "plato_id" uuid NOT NULL,
  "cantidad" integer NOT NULL,
  "precio_unitario_venta" numeric NOT NULL,
  "subtotal" numeric NOT NULL,
  "creado_en" timestamp with time zone DEFAULT now()
);

CREATE TABLE "public"."reservas" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid NOT NULL,
  "habitacion_id" uuid NOT NULL,
  "cliente_nombre" text NOT NULL,
  "tiempo_estancia_id" uuid,
  "fecha_inicio" timestamp with time zone NOT NULL,
  "fecha_fin" timestamp with time zone NOT NULL,
  "monto_total" numeric,
  "metodo_pago_id" uuid,
  "estado" estado_reserva_enum DEFAULT 'pendiente'::estado_reserva_enum,
  "usuario_id" uuid,
  "notas" text,
  "creado_en" timestamp with time zone DEFAULT now(),
  "actualizado_en" timestamp with time zone DEFAULT now(),
  "cliente_cedula" character varying(50),
  "cliente_telefono" character varying(20),
  "cantidad_huespedes" integer DEFAULT 1 NOT NULL,
  "precio_persona_adicional" numeric(12,2) DEFAULT 0 NOT NULL,
  "adicionales" integer DEFAULT 0 NOT NULL,
  "precio_adicional_por_adulto" numeric DEFAULT 0 NOT NULL,
  "cedula" character varying(20),
  "telefono" character varying(20),
  "extra_huespedes" integer DEFAULT 0,
  "precio_extra" numeric(10,2) DEFAULT 0.00,
  "tipo_duracion" text,
  "cantidad_duracion" integer,
  "monto_estancia_base" numeric DEFAULT 0,
  "monto_por_huespedes_adicionales" numeric DEFAULT 0,
  "origen_reserva" text DEFAULT 'directa'::text,
  "notas_internas" text,
  "monto_pagado" numeric DEFAULT 0,
  "monto_estancia_base_sin_impuestos" numeric,
  "monto_impuestos_estancia" numeric,
  "porcentaje_impuestos_aplicado" numeric,
  "nombre_impuesto_aplicado" text,
  "google_event_id" text,
  "external_event_id" text,
  "cliente_id" uuid,
  "cantidad_estancia" integer,
  "descuento_aplicado_id" uuid,
  "monto_descontado" numeric DEFAULT 0,
  "cancelado_por_usuario_id" uuid,
  "fecha_cancelacion" timestamp with time zone,
  "seguimiento_articulos" jsonb DEFAULT '[]'::jsonb
);

CREATE TABLE "public"."ventas_restaurante" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid NOT NULL,
  "usuario_id" uuid NOT NULL,
  "fecha_venta" timestamp with time zone DEFAULT now(),
  "monto_total" numeric NOT NULL,
  "metodo_pago_id" uuid,
  "nombre_cliente_temporal" text,
  "creado_en" timestamp with time zone DEFAULT now(),
  "habitacion_id" uuid,
  "reserva_id" uuid,
  "total_venta" numeric,
  "fecha" timestamp with time zone,
  "estado_pago" text DEFAULT 'pendiente'::text,
  "cliente_id" uuid,
  "descuento_aplicado_id" uuid,
  "monto_descontado" numeric,
  "monto_impuestos" numeric,
  "porcentaje_impuestos_aplicado" numeric,
  "nombre_impuesto_aplicado" text
);

CREATE TABLE "public"."configuracion_turnos" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid NOT NULL,
  "usuario_id" uuid NOT NULL,
  "activo" boolean DEFAULT true,
  "tipo_turno" text,
  "horas_turno" integer,
  "turnos_por_semana" integer,
  "dias_descanso" integer,
  "evita_turno_noche" boolean DEFAULT false,
  "prefiere_turno_dia" boolean DEFAULT false,
  "dias_descanso_fijos" text[],
  "creado_en" timestamp without time zone DEFAULT now()
);

CREATE TABLE "public"."descuentos" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "codigo" text,
  "tipo" tipo_descuento NOT NULL,
  "valor" numeric NOT NULL,
  "expiracion" timestamp with time zone,
  "usos_maximos" integer DEFAULT 0 NOT NULL,
  "usos_actuales" integer DEFAULT 0 NOT NULL,
  "activo" boolean DEFAULT true NOT NULL,
  "fecha_inicio" timestamp with time zone,
  "fecha_fin" timestamp with time zone,
  "aplicabilidad" tipo_aplicabilidad_descuento DEFAULT 'por_codigo'::tipo_aplicabilidad_descuento NOT NULL,
  "habitaciones_aplicables" text[],
  "nombre" text,
  "tipo_descuento_general" text DEFAULT 'codigo'::text NOT NULL,
  "cliente_id" uuid
);

CREATE TABLE "public"."ingredientes" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid NOT NULL,
  "nombre" text NOT NULL,
  "unidad_medida" text NOT NULL,
  "stock_actual" numeric(10,3) DEFAULT 0 NOT NULL,
  "stock_minimo" numeric(10,3) DEFAULT 0,
  "costo_unitario" numeric(10,2) DEFAULT 0,
  "creado_en" timestamp with time zone DEFAULT now(),
  "actualizado_en" timestamp with time zone DEFAULT now()
);

CREATE TABLE "public"."planes" (
  "id" integer DEFAULT nextval('planes_id_seq'::regclass) NOT NULL,
  "nombre" text NOT NULL,
  "descripcion" text,
  "funcionalidades" jsonb,
  "precio_mensual" numeric,
  "activo" boolean DEFAULT true,
  "creado_en" timestamp with time zone DEFAULT now(),
  "actualizado_en" timestamp with time zone DEFAULT now()
);

CREATE TABLE "public"."clientes" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid NOT NULL,
  "nombre" text NOT NULL,
  "documento" text,
  "email" text,
  "telefono" text,
  "direccion" text,
  "fecha_nacimiento" date,
  "notas" text,
  "fecha_creado" timestamp with time zone DEFAULT now(),
  "activo" boolean DEFAULT true
);

CREATE TABLE "public"."cambios_plan" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid,
  "fecha" timestamp without time zone DEFAULT now() NOT NULL,
  "plan_anterior" text,
  "plan_nuevo" text,
  "usuario_id" uuid,
  "usuario_nombre" text
);

CREATE TABLE "public"."pagos" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid,
  "fecha" timestamp without time zone DEFAULT now() NOT NULL,
  "plan" text,
  "monto" numeric,
  "metodo_pago" text,
  "url_factura" text
);

CREATE TABLE "public"."referidos" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "referidor_id" uuid,
  "nombre_hotel_referido" text,
  "estado" text,
  "fecha_registro" timestamp without time zone DEFAULT now() NOT NULL,
  "recompensa_otorgada" boolean DEFAULT false
);

CREATE TABLE "public"."movimientos_inventario" (
  "id" bigint NOT NULL,
  "hotel_id" uuid,
  "producto_id" uuid,
  "creado_en" timestamp with time zone DEFAULT now(),
  "tipo_movimiento" text NOT NULL,
  "cantidad" integer NOT NULL,
  "razon" text,
  "usuario_responsable" text,
  "stock_anterior" integer,
  "stock_nuevo" integer,
  "ingrediente_id" uuid,
  "usuario_id" uuid,
  "notas" text
);

CREATE TABLE "public"."cambios_habitacion" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid NOT NULL,
  "reserva_id" uuid NOT NULL,
  "habitacion_origen_id" uuid NOT NULL,
  "habitacion_destino_id" uuid NOT NULL,
  "motivo" text NOT NULL,
  "usuario_id" uuid NOT NULL,
  "fecha" timestamp with time zone DEFAULT now()
);

CREATE TABLE "public"."pagos_cargos" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "pago_id" uuid NOT NULL,
  "modulo" text NOT NULL,
  "cargo_id" uuid NOT NULL,
  "monto_cubierto" numeric NOT NULL,
  "creado_en" timestamp without time zone DEFAULT now()
);

CREATE TABLE "public"."turnos_programados" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid NOT NULL,
  "fecha" date NOT NULL,
  "dia" text NOT NULL,
  "turno_dia" uuid,
  "turno_noche" uuid,
  "descansa" uuid,
  "generado_auto" boolean DEFAULT true,
  "tipo_turno" text,
  "usuario_id" uuid
);

CREATE TABLE "public"."crm_actividades" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "cliente_id" uuid NOT NULL,
  "hotel_id" uuid NOT NULL,
  "tipo" text NOT NULL,
  "descripcion" text NOT NULL,
  "usuario_creador_id" uuid,
  "fecha" timestamp with time zone DEFAULT now() NOT NULL,
  "estado" text DEFAULT 'pendiente'::text
);

CREATE TABLE "public"."caja_movimientos_eliminados" (
  "id" integer DEFAULT nextval('caja_movimientos_eliminados_id_seq'::regclass) NOT NULL,
  "movimiento_id" bigint NOT NULL,
  "eliminado_por" uuid NOT NULL,
  "eliminado_en" timestamp with time zone DEFAULT now() NOT NULL,
  "datos_mov" jsonb
);

CREATE TABLE "public"."metodos_pago" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid NOT NULL,
  "nombre" text NOT NULL,
  "activo" boolean DEFAULT true,
  "creado_en" timestamp with time zone DEFAULT now(),
  "actualizado_en" timestamp with time zone DEFAULT now()
);

CREATE TABLE "public"."cronometros" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid NOT NULL,
  "reserva_id" uuid,
  "habitacion_id" uuid NOT NULL,
  "fecha_inicio" timestamp with time zone NOT NULL,
  "fecha_fin" timestamp with time zone NOT NULL,
  "activo" boolean DEFAULT true,
  "creado_en" timestamp with time zone DEFAULT now(),
  "actualizado_en" timestamp with time zone DEFAULT now()
);

CREATE TABLE "public"."integraciones" (
  "hotel_id" uuid NOT NULL,
  "webhook_reservas_url" text,
  "channel_manager_api_key" text,
  "crm_api_url" text,
  "crm_api_token" text,
  "brevo_api_key" text,
  "actualizado_en" timestamp with time zone DEFAULT now()
);

CREATE TABLE "public"."habitacion_tiempos_permitidos" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "habitacion_id" uuid NOT NULL,
  "tiempo_estancia_id" uuid NOT NULL,
  "hotel_id" uuid NOT NULL,
  "creado_en" timestamp with time zone DEFAULT now()
);

CREATE TABLE "public"."caja" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid NOT NULL,
  "tipo" tipo_movimiento_caja_enum NOT NULL,
  "monto" numeric NOT NULL,
  "concepto" text NOT NULL,
  "fecha_movimiento" timestamp with time zone DEFAULT now(),
  "metodo_pago_id" uuid,
  "usuario_id" uuid,
  "reserva_id" uuid,
  "pago_reserva_id" uuid,
  "venta_tienda_id" uuid,
  "creado_en" timestamp with time zone DEFAULT now(),
  "actualizado_en" timestamp with time zone DEFAULT now(),
  "referencia" uuid,
  "compra_tienda_id" uuid,
  "turno_id" uuid,
  "venta_restaurante_id" uuid
);

CREATE TABLE "public"."tareas_mantenimiento" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid NOT NULL,
  "titulo" text NOT NULL,
  "descripcion" text,
  "estado" estado_tarea_enum DEFAULT 'pendiente'::estado_tarea_enum,
  "tipo" tipo_tarea_enum DEFAULT 'general'::tipo_tarea_enum,
  "fecha_programada" date,
  "fecha_completada" timestamp with time zone,
  "frecuencia" frecuencia_tarea_enum DEFAULT 'unica'::frecuencia_tarea_enum,
  "ultima_realizacion" timestamp with time zone,
  "creada_por" uuid,
  "asignada_a" uuid,
  "realizada_por" uuid,
  "creado_en" timestamp with time zone DEFAULT now(),
  "actualizado_en" timestamp with time zone DEFAULT now(),
  "habitacion_id" uuid,
  "prioridad" integer
);

CREATE TABLE "public"."pagos_reserva" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid NOT NULL,
  "reserva_id" uuid NOT NULL,
  "monto" numeric NOT NULL,
  "fecha_pago" timestamp with time zone DEFAULT now(),
  "metodo_pago_id" uuid NOT NULL,
  "usuario_id" uuid,
  "creado_en" timestamp with time zone DEFAULT now(),
  "actualizado_en" timestamp with time zone DEFAULT now(),
  "concepto" text,
  "descuento_id" uuid,
  "monto_descuento" numeric DEFAULT 0
);

CREATE TABLE "public"."hoteles" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "nombre" text NOT NULL,
  "direccion" text,
  "telefono" text,
  "correo" citext,
  "ciudad" text,
  "pais" text,
  "logo_url" text,
  "plan" plan_hotel_enum DEFAULT 'prueba'::plan_hotel_enum,
  "plan_id" integer,
  "activo" boolean DEFAULT true,
  "creado_en" timestamp with time zone DEFAULT now(),
  "actualizado_en" timestamp with time zone DEFAULT now(),
  "checkin_hora" character varying(5) DEFAULT '15:00'::character varying,
  "checkout_hora" character varying(5) DEFAULT '12:00'::character varying,
  "estado_suscripcion" text DEFAULT 'trial'::text,
  "trial_inicio" timestamp with time zone DEFAULT now(),
  "trial_fin" timestamp with time zone DEFAULT (now() + '14 days'::interval),
  "suscripcion_fin" timestamp with time zone,
  "creado_por" uuid,
  "fecha_inicio_prueba" date,
  "fecha_vencimiento" date,
  "bloqueado" boolean DEFAULT false,
  "referido_por" uuid,
  "alegra_webhook_url" text
);

CREATE TABLE "public"."tiempos_estancia" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "nombre" text NOT NULL,
  "minutos" integer NOT NULL,
  "precio" numeric DEFAULT 0,
  "activo" boolean DEFAULT true,
  "creado_en" timestamp with time zone DEFAULT now(),
  "actualizado_en" timestamp with time zone DEFAULT now(),
  "precio_adicional" numeric DEFAULT 0,
  "hotel_id" uuid,
  "user_id" uuid NOT NULL
);

CREATE TABLE "public"."ventas_tienda" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid NOT NULL,
  "total_venta" numeric NOT NULL,
  "metodo_pago_id" uuid,
  "usuario_id" uuid,
  "fecha" timestamp with time zone DEFAULT now(),
  "creado_en" timestamp with time zone DEFAULT now(),
  "actualizado_en" timestamp with time zone DEFAULT now(),
  "reserva_id" uuid,
  "cliente_temporal" text,
  "habitacion_id" uuid,
  "estado_pago" text DEFAULT 'pendiente'::text,
  "cliente_id" uuid,
  "descuento_aplicado_id" uuid,
  "monto_descontado" numeric DEFAULT 0,
  "descuento_id" uuid,
  "monto_descuento" numeric DEFAULT 0
);

CREATE TABLE "public"."notificaciones" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid NOT NULL,
  "usuario_id" uuid,
  "rol_destino" rol_usuario_enum,
  "tipo" tipo_notificacion_enum NOT NULL,
  "mensaje" text NOT NULL,
  "leida" boolean DEFAULT false,
  "entidad_tipo" text,
  "entidad_id" uuid,
  "creado_en" timestamp with time zone DEFAULT now(),
  "actualizado_en" timestamp with time zone DEFAULT now(),
  "user_id" uuid
);

CREATE TABLE "public"."servicios_x_reserva" (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "hotel_id" uuid,
  "reserva_id" uuid,
  "servicio_id" uuid,
  "cantidad" integer DEFAULT 1,
  "nota" text,
  "creado_en" timestamp with time zone DEFAULT now(),
  "caja_movimiento_id" uuid,
  "estado_pago" text DEFAULT 'pendiente'::text,
  "descripcion_manual" text,
  "precio_cobrado" numeric,
  "pago_reserva_id" uuid,
  "fecha_servicio" timestamp with time zone
);

CREATE TABLE "public"."permisos" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "nombre" text NOT NULL,
  "descripcion" text
);

CREATE TABLE "public"."usuarios_roles" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "usuario_id" uuid NOT NULL,
  "rol_id" uuid NOT NULL,
  "hotel_id" uuid,
  "creado_en" timestamp with time zone DEFAULT now()
);

CREATE TABLE "public"."productos_tienda" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid NOT NULL,
  "nombre" text NOT NULL,
  "descripcion" text,
  "precio" numeric NOT NULL,
  "stock" integer DEFAULT 0,
  "codigo_barras" text,
  "stock_minimo" integer DEFAULT 0,
  "activo" boolean DEFAULT true,
  "creado_en" timestamp with time zone DEFAULT now(),
  "actualizado_en" timestamp with time zone DEFAULT now(),
  "categoria_id" uuid,
  "precio_venta" numeric NOT NULL,
  "stock_actual" integer DEFAULT 0 NOT NULL,
  "imagen_url" text,
  "stock_maximo" integer,
  "proveedor_id" uuid,
  "stock_min" numeric DEFAULT 0,
  "stock_max" numeric DEFAULT 0
);

CREATE TABLE "public"."log_caja_eliminados" (
  "id" bigint NOT NULL,
  "creado_en" timestamp with time zone DEFAULT now() NOT NULL,
  "movimiento_id_eliminado" uuid,
  "datos_eliminados" jsonb,
  "eliminado_por_usuario_id" uuid,
  "hotel_id" uuid
);

CREATE TABLE "public"."detalle_compras_tienda" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "compra_id" uuid,
  "producto_id" uuid,
  "cantidad" numeric,
  "precio_unitario" numeric,
  "subtotal" numeric,
  "hotel_id" uuid,
  "creado_en" timestamp without time zone DEFAULT now(),
  "recibido" integer DEFAULT 0
);

CREATE TABLE "public"."compras_tienda" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid,
  "usuario_id" uuid,
  "proveedor_id" uuid,
  "total_compra" numeric,
  "fecha" timestamp without time zone DEFAULT now(),
  "estado" text DEFAULT 'pendiente'::text,
  "creado_en" timestamp without time zone DEFAULT now(),
  "recibido_por_usuario_id" uuid,
  "fecha_recepcion" timestamp with time zone,
  "fecha_llegada_estimada" date
);

CREATE TABLE "public"."oauth_tokens" (
  "id" bigint NOT NULL,
  "hotel_id" uuid NOT NULL,
  "provider" text NOT NULL,
  "access_token_encrypted" text NOT NULL,
  "refresh_token_encrypted" text NOT NULL,
  "user_email" text,
  "expires_at" timestamp with time zone,
  "scopes" text[],
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."integraciones_calendar" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid NOT NULL,
  "calendar_id" text DEFAULT 'primary'::text NOT NULL,
  "channel_id" text NOT NULL,
  "resource_id" text,
  "expiration" timestamp with time zone,
  "status" text DEFAULT 'activo'::text,
  "creado_en" timestamp with time zone DEFAULT now()
);

CREATE TABLE "public"."platos_recetas" (
  "id" bigint NOT NULL,
  "creado_en" timestamp with time zone DEFAULT now() NOT NULL,
  "plato_id" uuid,
  "ingrediente_id" uuid,
  "cantidad" numeric NOT NULL,
  "hotel_id" uuid
);

CREATE TABLE "public"."ventas" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid NOT NULL,
  "cliente_id" uuid,
  "fecha_venta" timestamp with time zone DEFAULT now(),
  "total" numeric
);

CREATE TABLE "public"."configuracion_hotel" (
  "hotel_id" uuid NOT NULL,
  "encabezado_ticket_l1" text,
  "encabezado_ticket_l2" text,
  "encabezado_ticket_l3" text,
  "pie_ticket" text,
  "nombre_impuesto_principal" text DEFAULT 'IVA'::text,
  "porcentaje_impuesto_principal" numeric DEFAULT 19.0,
  "impuestos_incluidos_en_precios" boolean DEFAULT false,
  "politica_cancelacion" text,
  "terminos_condiciones" text,
  "mostrar_logo_en_documentos" boolean DEFAULT true,
  "piscina_activada" boolean DEFAULT false,
  "piscina_horario_apertura" time without time zone,
  "piscina_horario_cierre" time without time zone,
  "moneda_local" character varying(3) DEFAULT 'COP'::character varying,
  "formato_fecha" text DEFAULT 'DD/MM/YYYY'::text,
  "formato_hora" text DEFAULT 'HH:mm'::text,
  "idioma_predeterminado" text DEFAULT 'es'::text,
  "nit_rut" text,
  "razon_social" text,
  "regimen_tributario" text,
  "direccion_fiscal" text,
  "telefono_fiscal" text,
  "actualizado_en" timestamp with time zone DEFAULT now(),
  "correo_remitente" text,
  "encabezado_ticket" text,
  "logo_url" text,
  "mostrar_logo" boolean DEFAULT true,
  "correo_reportes" text,
  "nombre_hotel" text,
  "tamano_papel" text,
  "correos_reportes" text,
  "tipo_impresora" text,
  "cobro_inmediato_servicios" boolean DEFAULT false,
  "cobro_al_checkin" boolean DEFAULT true,
  "checkin_hora_config" time without time zone DEFAULT '15:00:00'::time without time zone,
  "checkout_hora_config" time without time zone DEFAULT '12:00:00'::time without time zone,
  "cantidad_decimales_moneda" integer DEFAULT 0,
  "moneda_local_simbolo" text,
  "moneda_codigo_iso_info" text,
  "moneda_decimales_info" integer,
  "tipo_turno_global" integer DEFAULT 12,
  "impuesto_nombre_restaurante" text,
  "impuesto_porcentaje_restaurante" numeric,
  "impuesto_restaurante_incluido" boolean DEFAULT false
);

CREATE TABLE "public"."usuarios" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "nombre" text,
  "hotel_id" uuid,
  "activo" boolean DEFAULT true,
  "suscripcion_hasta" timestamp with time zone,
  "creado_en" timestamp with time zone DEFAULT now(),
  "actualizado_en" timestamp with time zone DEFAULT now(),
  "correo" text,
  "email" text,
  "rol" text DEFAULT 'usuario'::text,
  "ultimo_inicio_sesion" timestamp with time zone
);

CREATE TABLE "public"."programacion_config" (
  "hotel_id" uuid NOT NULL,
  "ultimo_indice_rotacion" integer DEFAULT 0 NOT NULL,
  "actualizado_en" timestamp with time zone DEFAULT now()
);

CREATE TABLE "public"."habitaciones" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid NOT NULL,
  "nombre" text NOT NULL,
  "tipo" text,
  "precio" numeric,
  "estado" estado_habitacion_enum DEFAULT 'libre'::estado_habitacion_enum,
  "activo" boolean DEFAULT true,
  "amenidades" text[],
  "creado_en" timestamp with time zone DEFAULT now(),
  "actualizado_en" timestamp with time zone DEFAULT now(),
  "capacidad_base" integer DEFAULT 2 NOT NULL,
  "capacidad_maxima" integer DEFAULT 4 NOT NULL,
  "precio_huesped_adicional" numeric DEFAULT 0 NOT NULL,
  "permite_reservas_por_horas" boolean DEFAULT true,
  "precio_base_hora" numeric,
  "precio_adicional_huesped" numeric(12,2) DEFAULT 0,
  "piso" integer DEFAULT 1,
  "precio_1_persona" numeric(10,2) DEFAULT 0,
  "precio_2_personas" numeric(10,2) DEFAULT 0,
  "tipo_habitacion_id" uuid
);

CREATE TABLE "public"."clientes_descuentos" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "cliente_id" uuid NOT NULL,
  "descuento_id" uuid NOT NULL,
  "hotel_id" uuid NOT NULL,
  "creado_en" timestamp with time zone DEFAULT now()
);

CREATE TABLE "public"."historial_articulos_prestados" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid NOT NULL,
  "reserva_id" uuid,
  "habitacion_id" uuid,
  "usuario_id" uuid,
  "articulo_nombre" text NOT NULL,
  "cantidad" integer DEFAULT 1,
  "accion" tipo_accion_articulo NOT NULL,
  "fecha_accion" timestamp with time zone DEFAULT now() NOT NULL,
  "notas" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "item_prestable_id" uuid
);

CREATE TABLE "public"."log_lenceria_uso" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid NOT NULL,
  "habitacion_id" uuid,
  "item_lenceria_id" uuid NOT NULL,
  "cantidad_usada" integer DEFAULT 1 NOT NULL,
  "usuario_id" uuid,
  "fecha_uso" timestamp with time zone DEFAULT now() NOT NULL,
  "estado_ciclo" text DEFAULT 'enviado_a_lavanderia'::text,
  "notas" text
);

CREATE TABLE "public"."log_amenidades_uso" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid NOT NULL,
  "habitacion_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "cantidad_usada" integer DEFAULT 1 NOT NULL,
  "usuario_id" uuid,
  "fecha_uso" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."tipos_de_habitacion" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid NOT NULL,
  "nombre" text NOT NULL
);

CREATE TABLE "public"."amenidades_inventario" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "hotel_id" uuid NOT NULL,
  "nombre_item" text NOT NULL,
  "stock_actual" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "cantidad_default" integer DEFAULT 0,
  "stock_minimo_alerta" integer DEFAULT 5
);

COMMENT ON TABLE "public"."servicios_adicionales" IS 'Servicios adicionales que el hotel puede ofrecer y cobrar (ej: lavandería, minibar, tours).';

COMMENT ON TABLE "public"."tipos_servicio" IS 'Categorías para los servicios adicionales ofrecidos por el hotel.';

COMMENT ON TABLE "public"."categorias_producto" IS 'Categorías para los productos de la tienda/minimarket del hotel.';

COMMENT ON TABLE "public"."detalle_ventas_tienda" IS 'Detalle de los productos vendidos en cada transacción de la tienda.';

COMMENT ON TABLE "public"."proveedores" IS 'Almacena los proveedores para compras de la tienda o restaurante.';

COMMENT ON COLUMN "public"."reservas"."descuento_aplicado_id" IS 'ID del descuento que se aplicó a esta reserva.';
COMMENT ON COLUMN "public"."reservas"."monto_descontado" IS 'Monto total que se descontó del precio de la reserva.';
COMMENT ON COLUMN "public"."reservas"."cancelado_por_usuario_id" IS 'ID del usuario que realizó la cancelación.';
COMMENT ON COLUMN "public"."reservas"."fecha_cancelacion" IS 'Fecha y hora en que se canceló la reserva.';

COMMENT ON COLUMN "public"."ventas_restaurante"."monto_impuestos" IS 'Monto total de impuestos cobrados en esta venta.';
COMMENT ON COLUMN "public"."ventas_restaurante"."porcentaje_impuestos_aplicado" IS 'El porcentaje de impuesto que se aplicó (ej. 19 para 19%).';
COMMENT ON COLUMN "public"."ventas_restaurante"."nombre_impuesto_aplicado" IS 'El nombre del impuesto aplicado (ej. IVA, INC, Sales Tax).';

COMMENT ON TABLE "public"."descuentos" IS 'Almacena códigos de descuento para los hoteles.';
COMMENT ON COLUMN "public"."descuentos"."codigo" IS 'Código que el usuario introduce (opcional si es un descuento automático).';
COMMENT ON COLUMN "public"."descuentos"."fecha_inicio" IS 'Fecha y hora en que el descuento automático empieza a ser válido.';
COMMENT ON COLUMN "public"."descuentos"."fecha_fin" IS 'Fecha y hora en que el descuento automático deja de ser válido.';
COMMENT ON COLUMN "public"."descuentos"."aplicabilidad" IS 'Define cómo se aplica el descuento: a todas las habitaciones, a algunas, o solo con un código.';
COMMENT ON COLUMN "public"."descuentos"."habitaciones_aplicables" IS 'Array de IDs de habitaciones a las que se aplica el descuento si la aplicabilidad es específica.';

COMMENT ON COLUMN "public"."tiempos_estancia"."precio_adicional" IS 'Costo adicional asociado a este tiempo de estancia específico. Si es 0 o NULL, se podría usar el precio base de la habitación o no tener costo adicional.';
COMMENT ON COLUMN "public"."tiempos_estancia"."hotel_id" IS 'Hotel al que pertenece este tiempo de estancia.';

COMMENT ON TABLE "public"."ventas_tienda" IS 'Registro de ventas realizadas en la tienda.';
COMMENT ON COLUMN "public"."ventas_tienda"."descuento_aplicado_id" IS 'ID del descuento que se aplicó a esta venta de tienda.';
COMMENT ON COLUMN "public"."ventas_tienda"."monto_descontado" IS 'Monto total que se descontó del precio de la venta.';

COMMENT ON TABLE "public"."productos_tienda" IS 'Productos disponibles en la tienda/minimarket del hotel, con categoría asignada.';
COMMENT ON COLUMN "public"."productos_tienda"."categoria_id" IS 'Referencia a la categoría (public.categorias_producto) a la que pertenece el producto.';
COMMENT ON COLUMN "public"."productos_tienda"."precio_venta" IS 'Precio de venta al público del producto.';
COMMENT ON COLUMN "public"."productos_tienda"."stock_actual" IS 'Cantidad actual en inventario del producto.';
COMMENT ON COLUMN "public"."productos_tienda"."imagen_url" IS 'URL de la imagen principal del producto.';

COMMENT ON TABLE "public"."log_caja_eliminados" IS 'Registra los movimientos de caja que han sido eliminados por un administrador.';

COMMENT ON TABLE "public"."detalle_compras_tienda" IS 'Items específicos dentro de cada orden de compra de la tienda.';

COMMENT ON TABLE "public"."compras_tienda" IS 'Registra las órdenes de compra a proveedores para la tienda.';
COMMENT ON COLUMN "public"."compras_tienda"."usuario_id" IS 'Usuario que CREÓ la orden de compra.';
COMMENT ON COLUMN "public"."compras_tienda"."recibido_por_usuario_id" IS 'Usuario que RECIBIÓ la mercancía.';

COMMENT ON TABLE "public"."configuracion_hotel" IS 'Almacena todas las configuraciones específicas y personalizables para cada hotel.';
COMMENT ON COLUMN "public"."configuracion_hotel"."impuesto_nombre_restaurante" IS 'Nombre del impuesto específico para restaurante (Ej: Impoconsumo)';
COMMENT ON COLUMN "public"."configuracion_hotel"."impuesto_porcentaje_restaurante" IS 'Porcentaje del impuesto de restaurante (Ej: 8 para 8%)';
COMMENT ON COLUMN "public"."configuracion_hotel"."impuesto_restaurante_incluido" IS 'Define si los precios del menú ya incluyen este impuesto.';

COMMENT ON TABLE "public"."programacion_config" IS 'Guarda el último índice usado en la rotación de turnos para cada hotel, para asegurar la continuidad semanal.';

COMMENT ON COLUMN "public"."habitaciones"."precio" IS 'Precio base original. Puede ser usado como fallback o para "Noche" si se prefiere.';
COMMENT ON COLUMN "public"."habitaciones"."precio_huesped_adicional" IS 'Costo extra por cada huésped a partir del TERCERO.';
COMMENT ON COLUMN "public"."habitaciones"."precio_1_persona" IS 'Precio base cuando la habitación es ocupada por 1 persona.';
COMMENT ON COLUMN "public"."habitaciones"."precio_2_personas" IS 'Precio base cuando la habitación es ocupada por 2 personas.';

ALTER TABLE ONLY "public"."inventario_prestables" ADD CONSTRAINT "inventario_prestables_hotel_id_nombre_item_key" UNIQUE (hotel_id, nombre_item);
ALTER TABLE ONLY "public"."inventario_prestables" ADD CONSTRAINT "inventario_prestables_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."historial_chat" ADD CONSTRAINT "historial_chat_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."turnos" ADD CONSTRAINT "turnos_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."servicios_adicionales" ADD CONSTRAINT "servicios_adicionales_hotel_id_nombre_key" UNIQUE (hotel_id, nombre);
ALTER TABLE ONLY "public"."servicios_adicionales" ADD CONSTRAINT "servicios_adicionales_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."servicios_adicionales" ADD CONSTRAINT "servicios_adicionales_precio_check" CHECK ((precio >= (0)::numeric));

ALTER TABLE ONLY "public"."roles" ADD CONSTRAINT "roles_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."roles" ADD CONSTRAINT "unique_roles_nombre" UNIQUE (nombre);

ALTER TABLE ONLY "public"."roles_permisos" ADD CONSTRAINT "roles_permisos_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."tipos_servicio" ADD CONSTRAINT "tipos_servicio_hotel_id_nombre_key" UNIQUE (hotel_id, nombre);
ALTER TABLE ONLY "public"."tipos_servicio" ADD CONSTRAINT "tipos_servicio_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."inventario_lenceria" ADD CONSTRAINT "inventario_lenceria_hotel_id_nombre_item_key" UNIQUE (hotel_id, nombre_item);
ALTER TABLE ONLY "public"."inventario_lenceria" ADD CONSTRAINT "inventario_lenceria_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."categorias_producto" ADD CONSTRAINT "categorias_producto_hotel_id_nombre_key" UNIQUE (hotel_id, nombre);
ALTER TABLE ONLY "public"."categorias_producto" ADD CONSTRAINT "categorias_producto_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."detalle_ventas_tienda" ADD CONSTRAINT "detalle_ventas_tienda_cantidad_check" CHECK ((cantidad > 0));
ALTER TABLE ONLY "public"."detalle_ventas_tienda" ADD CONSTRAINT "detalle_ventas_tienda_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."detalle_ventas_tienda" ADD CONSTRAINT "detalle_ventas_tienda_precio_unitario_venta_check" CHECK ((precio_unitario_venta >= (0)::numeric));
ALTER TABLE ONLY "public"."detalle_ventas_tienda" ADD CONSTRAINT "detalle_ventas_tienda_subtotal_check" CHECK ((subtotal >= (0)::numeric));

ALTER TABLE ONLY "public"."platos" ADD CONSTRAINT "platos_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."integraciones_hotel" ADD CONSTRAINT "integraciones_hotel_pkey" PRIMARY KEY (hotel_id);

ALTER TABLE ONLY "public"."bitacora" ADD CONSTRAINT "bitacora_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."proveedores" ADD CONSTRAINT "proveedores_hotel_id_nit_key" UNIQUE (hotel_id, nit);
ALTER TABLE ONLY "public"."proveedores" ADD CONSTRAINT "proveedores_hotel_id_nombre_key" UNIQUE (hotel_id, nombre);
ALTER TABLE ONLY "public"."proveedores" ADD CONSTRAINT "proveedores_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."usuarios_permisos" ADD CONSTRAINT "usuarios_permisos_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."ventas_restaurante_items" ADD CONSTRAINT "ventas_restaurante_items_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."reservas" ADD CONSTRAINT "chk_fechas_reserva" CHECK ((fecha_fin >= fecha_inicio));
ALTER TABLE ONLY "public"."reservas" ADD CONSTRAINT "reservas_monto_total_check" CHECK ((monto_total >= (0)::numeric));
ALTER TABLE ONLY "public"."reservas" ADD CONSTRAINT "reservas_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."ventas_restaurante" ADD CONSTRAINT "ventas_restaurante_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."configuracion_turnos" ADD CONSTRAINT "configuracion_turnos_dias_descanso_check" CHECK (((dias_descanso >= 1) AND (dias_descanso <= 6)));
ALTER TABLE ONLY "public"."configuracion_turnos" ADD CONSTRAINT "configuracion_turnos_horas_turno_check" CHECK ((horas_turno = ANY (ARRAY[8, 12])));
ALTER TABLE ONLY "public"."configuracion_turnos" ADD CONSTRAINT "configuracion_turnos_hotel_id_usuario_id_key" UNIQUE (hotel_id, usuario_id);
ALTER TABLE ONLY "public"."configuracion_turnos" ADD CONSTRAINT "configuracion_turnos_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."configuracion_turnos" ADD CONSTRAINT "configuracion_turnos_tipo_turno_check" CHECK ((tipo_turno = ANY (ARRAY['rotativo'::text, 'solo_dia'::text, 'solo_noche'::text])));
ALTER TABLE ONLY "public"."configuracion_turnos" ADD CONSTRAINT "configuracion_turnos_turnos_por_semana_check" CHECK (((turnos_por_semana >= 1) AND (turnos_por_semana <= 7)));

ALTER TABLE ONLY "public"."descuentos" ADD CONSTRAINT "descuentos_hotel_id_codigo_key" UNIQUE (hotel_id, codigo);
ALTER TABLE ONLY "public"."descuentos" ADD CONSTRAINT "descuentos_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."descuentos" ADD CONSTRAINT "descuentos_valor_check" CHECK ((valor >= (0)::numeric));

ALTER TABLE ONLY "public"."ingredientes" ADD CONSTRAINT "ingredientes_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."planes" ADD CONSTRAINT "planes_nombre_key" UNIQUE (nombre);
ALTER TABLE ONLY "public"."planes" ADD CONSTRAINT "planes_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."planes" ADD CONSTRAINT "planes_precio_mensual_check" CHECK ((precio_mensual >= (0)::numeric));

ALTER TABLE ONLY "public"."clientes" ADD CONSTRAINT "clientes_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."cambios_plan" ADD CONSTRAINT "cambios_plan_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."pagos" ADD CONSTRAINT "pagos_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."referidos" ADD CONSTRAINT "referidos_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."cambios_habitacion" ADD CONSTRAINT "cambios_habitacion_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."pagos_cargos" ADD CONSTRAINT "pagos_cargos_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."turnos_programados" ADD CONSTRAINT "turnos_programados_hotel_fecha_usuario_unique" UNIQUE (hotel_id, fecha, usuario_id);
ALTER TABLE ONLY "public"."turnos_programados" ADD CONSTRAINT "turnos_programados_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."crm_actividades" ADD CONSTRAINT "crm_actividades_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."caja_movimientos_eliminados" ADD CONSTRAINT "caja_movimientos_eliminados_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."metodos_pago" ADD CONSTRAINT "metodos_pago_hotel_id_nombre_key" UNIQUE (hotel_id, nombre);
ALTER TABLE ONLY "public"."metodos_pago" ADD CONSTRAINT "metodos_pago_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."cronometros" ADD CONSTRAINT "chk_fechas_cronometro" CHECK ((fecha_fin >= fecha_inicio));
ALTER TABLE ONLY "public"."cronometros" ADD CONSTRAINT "cronometros_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."integraciones" ADD CONSTRAINT "integraciones_pkey" PRIMARY KEY (hotel_id);

ALTER TABLE ONLY "public"."habitacion_tiempos_permitidos" ADD CONSTRAINT "habitacion_tiempos_permitidos_habitacion_id_tiempo_estancia_key" UNIQUE (habitacion_id, tiempo_estancia_id);
ALTER TABLE ONLY "public"."habitacion_tiempos_permitidos" ADD CONSTRAINT "habitacion_tiempos_permitidos_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."caja" ADD CONSTRAINT "caja_monto_check" CHECK ((monto > (0)::numeric));
ALTER TABLE ONLY "public"."caja" ADD CONSTRAINT "caja_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."tareas_mantenimiento" ADD CONSTRAINT "tareas_mantenimiento_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."pagos_reserva" ADD CONSTRAINT "pagos_reserva_monto_check" CHECK ((monto > (0)::numeric));
ALTER TABLE ONLY "public"."pagos_reserva" ADD CONSTRAINT "pagos_reserva_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."hoteles" ADD CONSTRAINT "hoteles_correo_key" UNIQUE (correo);
ALTER TABLE ONLY "public"."hoteles" ADD CONSTRAINT "hoteles_nombre_key" UNIQUE (nombre);
ALTER TABLE ONLY "public"."hoteles" ADD CONSTRAINT "hoteles_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."tiempos_estancia" ADD CONSTRAINT "tiempos_estancia_minutos_check" CHECK ((minutos > 0));
ALTER TABLE ONLY "public"."tiempos_estancia" ADD CONSTRAINT "tiempos_estancia_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."tiempos_estancia" ADD CONSTRAINT "tiempos_estancia_precio_adicional_check" CHECK ((precio_adicional >= (0)::numeric));
ALTER TABLE ONLY "public"."tiempos_estancia" ADD CONSTRAINT "tiempos_estancia_precio_check" CHECK ((precio >= (0)::numeric));

ALTER TABLE ONLY "public"."ventas_tienda" ADD CONSTRAINT "ventas_tienda_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."notificaciones" ADD CONSTRAINT "notificaciones_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."servicios_x_reserva" ADD CONSTRAINT "servicios_x_reserva_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."permisos" ADD CONSTRAINT "permisos_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."usuarios_roles" ADD CONSTRAINT "usuarios_roles_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."productos_tienda" ADD CONSTRAINT "productos_tienda_hotel_id_codigo_barras_key" UNIQUE (hotel_id, codigo_barras);
ALTER TABLE ONLY "public"."productos_tienda" ADD CONSTRAINT "productos_tienda_hotel_id_nombre_key" UNIQUE (hotel_id, nombre);
ALTER TABLE ONLY "public"."productos_tienda" ADD CONSTRAINT "productos_tienda_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."productos_tienda" ADD CONSTRAINT "productos_tienda_precio_check" CHECK ((precio >= (0)::numeric));
ALTER TABLE ONLY "public"."productos_tienda" ADD CONSTRAINT "productos_tienda_precio_venta_check" CHECK ((precio_venta >= (0)::numeric));
ALTER TABLE ONLY "public"."productos_tienda" ADD CONSTRAINT "productos_tienda_stock_actual_check" CHECK ((stock_actual >= 0));
ALTER TABLE ONLY "public"."productos_tienda" ADD CONSTRAINT "productos_tienda_stock_check" CHECK ((stock >= 0));
ALTER TABLE ONLY "public"."productos_tienda" ADD CONSTRAINT "productos_tienda_stock_minimo_check" CHECK ((stock_minimo >= 0));

ALTER TABLE ONLY "public"."log_caja_eliminados" ADD CONSTRAINT "log_caja_eliminados_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."detalle_compras_tienda" ADD CONSTRAINT "detalle_compras_tienda_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."compras_tienda" ADD CONSTRAINT "compras_tienda_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."oauth_tokens" ADD CONSTRAINT "oauth_tokens_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."oauth_tokens" ADD CONSTRAINT "oauth_tokens_provider_check" CHECK ((provider = ANY (ARRAY['google'::text, 'outlook'::text])));
ALTER TABLE ONLY "public"."oauth_tokens" ADD CONSTRAINT "uq_hotel_provider" UNIQUE (hotel_id, provider);

ALTER TABLE ONLY "public"."integraciones_calendar" ADD CONSTRAINT "integraciones_calendar_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."platos_recetas" ADD CONSTRAINT "platos_recetas_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."ventas" ADD CONSTRAINT "ventas_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."configuracion_hotel" ADD CONSTRAINT "configuracion_hotel_pkey" PRIMARY KEY (hotel_id);
ALTER TABLE ONLY "public"."configuracion_hotel" ADD CONSTRAINT "configuracion_hotel_porcentaje_impuesto_principal_check" CHECK (((porcentaje_impuesto_principal >= (0)::numeric) AND (porcentaje_impuesto_principal <= (100)::numeric)));
ALTER TABLE ONLY "public"."configuracion_hotel" ADD CONSTRAINT "configuracion_hotel_tipo_turno_global_check" CHECK ((tipo_turno_global = ANY (ARRAY[8, 12])));

ALTER TABLE ONLY "public"."usuarios" ADD CONSTRAINT "usuarios_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."programacion_config" ADD CONSTRAINT "programacion_config_pkey" PRIMARY KEY (hotel_id);

ALTER TABLE ONLY "public"."habitaciones" ADD CONSTRAINT "habitaciones_hotel_id_nombre_key" UNIQUE (hotel_id, nombre);
ALTER TABLE ONLY "public"."habitaciones" ADD CONSTRAINT "habitaciones_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."habitaciones" ADD CONSTRAINT "habitaciones_precio_check" CHECK ((precio >= (0)::numeric));

ALTER TABLE ONLY "public"."clientes_descuentos" ADD CONSTRAINT "clientes_descuentos_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."clientes_descuentos" ADD CONSTRAINT "unique_cliente_descuento" UNIQUE (cliente_id, descuento_id);

ALTER TABLE ONLY "public"."historial_articulos_prestados" ADD CONSTRAINT "historial_articulos_prestados_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."log_lenceria_uso" ADD CONSTRAINT "log_lenceria_uso_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."log_amenidades_uso" ADD CONSTRAINT "log_amenidades_uso_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."tipos_de_habitacion" ADD CONSTRAINT "tipos_de_habitacion_hotel_id_nombre_key" UNIQUE (hotel_id, nombre);
ALTER TABLE ONLY "public"."tipos_de_habitacion" ADD CONSTRAINT "tipos_de_habitacion_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "public"."amenidades_inventario" ADD CONSTRAINT "amenidades_inventario_hotel_id_nombre_item_key" UNIQUE (hotel_id, nombre_item);
ALTER TABLE ONLY "public"."amenidades_inventario" ADD CONSTRAINT "amenidades_inventario_pkey" PRIMARY KEY (id);

ALTER SEQUENCE "public"."planes_id_seq" OWNED BY "public"."planes"."id";

ALTER SEQUENCE "public"."caja_movimientos_eliminados_id_seq" OWNED BY "public"."caja_movimientos_eliminados"."id";

ALTER TABLE ONLY "public"."inventario_prestables" ADD CONSTRAINT "inventario_prestables_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES configuracion_hotel(hotel_id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."turnos" ADD CONSTRAINT "turnos_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id);
ALTER TABLE ONLY "public"."turnos" ADD CONSTRAINT "turnos_usuario_id_fkey" FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."servicios_adicionales" ADD CONSTRAINT "servicios_adicionales_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."servicios_adicionales" ADD CONSTRAINT "servicios_adicionales_tipo_id_fkey" FOREIGN KEY (tipo_id) REFERENCES tipos_servicio(id) ON DELETE SET NULL;

ALTER TABLE ONLY "public"."roles_permisos" ADD CONSTRAINT "roles_permisos_permiso_id_fkey" FOREIGN KEY (permiso_id) REFERENCES permisos(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."roles_permisos" ADD CONSTRAINT "roles_permisos_rol_id_fkey" FOREIGN KEY (rol_id) REFERENCES roles(id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."tipos_servicio" ADD CONSTRAINT "tipos_servicio_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."inventario_lenceria" ADD CONSTRAINT "inventario_lenceria_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES configuracion_hotel(hotel_id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."categorias_producto" ADD CONSTRAINT "categorias_producto_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."detalle_ventas_tienda" ADD CONSTRAINT "detalle_ventas_tienda_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."detalle_ventas_tienda" ADD CONSTRAINT "detalle_ventas_tienda_producto_id_fkey" FOREIGN KEY (producto_id) REFERENCES productos_tienda(id) ON DELETE RESTRICT;
ALTER TABLE ONLY "public"."detalle_ventas_tienda" ADD CONSTRAINT "detalle_ventas_tienda_venta_id_fkey" FOREIGN KEY (venta_id) REFERENCES ventas_tienda(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."detalle_ventas_tienda" ADD CONSTRAINT "fk_producto_id" FOREIGN KEY (producto_id) REFERENCES productos_tienda(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."detalle_ventas_tienda" ADD CONSTRAINT "fk_venta_id" FOREIGN KEY (venta_id) REFERENCES ventas_tienda(id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."platos" ADD CONSTRAINT "platos_categoria_id_fkey" FOREIGN KEY (categoria_id) REFERENCES categorias_producto(id);
ALTER TABLE ONLY "public"."platos" ADD CONSTRAINT "platos_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id);

ALTER TABLE ONLY "public"."integraciones_hotel" ADD CONSTRAINT "integraciones_hotel_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."bitacora" ADD CONSTRAINT "bitacora_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."bitacora" ADD CONSTRAINT "bitacora_usuario_id_fkey" FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."proveedores" ADD CONSTRAINT "proveedores_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."usuarios_permisos" ADD CONSTRAINT "usuarios_permisos_permiso_id_fkey" FOREIGN KEY (permiso_id) REFERENCES permisos(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."usuarios_permisos" ADD CONSTRAINT "usuarios_permisos_usuario_id_fkey" FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."ventas_restaurante_items" ADD CONSTRAINT "ventas_restaurante_items_plato_id_fkey" FOREIGN KEY (plato_id) REFERENCES platos(id);
ALTER TABLE ONLY "public"."ventas_restaurante_items" ADD CONSTRAINT "ventas_restaurante_items_venta_id_fkey" FOREIGN KEY (venta_id) REFERENCES ventas_restaurante(id);

ALTER TABLE ONLY "public"."reservas" ADD CONSTRAINT "reservas_cancelado_por_usuario_id_fkey" FOREIGN KEY (cancelado_por_usuario_id) REFERENCES usuarios(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY "public"."reservas" ADD CONSTRAINT "reservas_cliente_id_fkey" FOREIGN KEY (cliente_id) REFERENCES clientes(id);
ALTER TABLE ONLY "public"."reservas" ADD CONSTRAINT "reservas_descuento_aplicado_id_fkey" FOREIGN KEY (descuento_aplicado_id) REFERENCES descuentos(id) ON DELETE SET NULL;
ALTER TABLE ONLY "public"."reservas" ADD CONSTRAINT "reservas_habitacion_id_fkey" FOREIGN KEY (habitacion_id) REFERENCES habitaciones(id) ON DELETE RESTRICT;
ALTER TABLE ONLY "public"."reservas" ADD CONSTRAINT "reservas_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE RESTRICT;
ALTER TABLE ONLY "public"."reservas" ADD CONSTRAINT "reservas_metodo_pago_id_fkey" FOREIGN KEY (metodo_pago_id) REFERENCES metodos_pago(id) ON DELETE SET NULL;
ALTER TABLE ONLY "public"."reservas" ADD CONSTRAINT "reservas_tiempo_estancia_id_fkey" FOREIGN KEY (tiempo_estancia_id) REFERENCES tiempos_estancia(id) ON DELETE SET NULL;
ALTER TABLE ONLY "public"."reservas" ADD CONSTRAINT "reservas_usuario_id_fkey" FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."ventas_restaurante" ADD CONSTRAINT "ventas_rest_descuento_fk" FOREIGN KEY (descuento_aplicado_id) REFERENCES descuentos(id) ON DELETE SET NULL;
ALTER TABLE ONLY "public"."ventas_restaurante" ADD CONSTRAINT "ventas_restaurante_cliente_id_fkey" FOREIGN KEY (cliente_id) REFERENCES clientes(id);
ALTER TABLE ONLY "public"."ventas_restaurante" ADD CONSTRAINT "ventas_restaurante_descuento_aplicado_id_fkey" FOREIGN KEY (descuento_aplicado_id) REFERENCES descuentos(id) ON DELETE SET NULL;
ALTER TABLE ONLY "public"."ventas_restaurante" ADD CONSTRAINT "ventas_restaurante_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id);
ALTER TABLE ONLY "public"."ventas_restaurante" ADD CONSTRAINT "ventas_restaurante_metodo_pago_id_fkey" FOREIGN KEY (metodo_pago_id) REFERENCES metodos_pago(id);
ALTER TABLE ONLY "public"."ventas_restaurante" ADD CONSTRAINT "ventas_restaurante_usuario_id_fkey" FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."descuentos" ADD CONSTRAINT "descuentos_cliente_id_fkey" FOREIGN KEY (cliente_id) REFERENCES clientes(id);
ALTER TABLE ONLY "public"."descuentos" ADD CONSTRAINT "descuentos_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."ingredientes" ADD CONSTRAINT "ingredientes_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id);

ALTER TABLE ONLY "public"."clientes" ADD CONSTRAINT "clientes_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."cambios_plan" ADD CONSTRAINT "cambios_plan_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id);
ALTER TABLE ONLY "public"."cambios_plan" ADD CONSTRAINT "cambios_plan_usuario_id_fkey" FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."pagos" ADD CONSTRAINT "pagos_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id);

ALTER TABLE ONLY "public"."referidos" ADD CONSTRAINT "referidos_referidor_id_fkey" FOREIGN KEY (referidor_id) REFERENCES hoteles(id);

ALTER TABLE ONLY "public"."movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id);
ALTER TABLE ONLY "public"."movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_ingrediente_id_fkey" FOREIGN KEY (ingrediente_id) REFERENCES ingredientes(id);
ALTER TABLE ONLY "public"."movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_producto_id_fkey" FOREIGN KEY (producto_id) REFERENCES productos_tienda(id);
ALTER TABLE ONLY "public"."movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_usuario_id_fkey" FOREIGN KEY (usuario_id) REFERENCES users(id);

ALTER TABLE ONLY "public"."pagos_cargos" ADD CONSTRAINT "pagos_cargos_pago_id_fkey" FOREIGN KEY (pago_id) REFERENCES pagos_reserva(id);

ALTER TABLE ONLY "public"."crm_actividades" ADD CONSTRAINT "crm_actividades_cliente_id_fkey" FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."crm_actividades" ADD CONSTRAINT "crm_actividades_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."crm_actividades" ADD CONSTRAINT "crm_actividades_usuario_creador_id_fkey" FOREIGN KEY (usuario_creador_id) REFERENCES usuarios(id);

ALTER TABLE ONLY "public"."caja_movimientos_eliminados" ADD CONSTRAINT "caja_movimientos_eliminados_eliminado_por_fkey" FOREIGN KEY (eliminado_por) REFERENCES usuarios(id);

ALTER TABLE ONLY "public"."metodos_pago" ADD CONSTRAINT "metodos_pago_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."cronometros" ADD CONSTRAINT "cronometros_habitacion_id_fkey" FOREIGN KEY (habitacion_id) REFERENCES habitaciones(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."cronometros" ADD CONSTRAINT "cronometros_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."cronometros" ADD CONSTRAINT "cronometros_reserva_id_fkey" FOREIGN KEY (reserva_id) REFERENCES reservas(id) ON DELETE SET NULL;

ALTER TABLE ONLY "public"."integraciones" ADD CONSTRAINT "integraciones_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."habitacion_tiempos_permitidos" ADD CONSTRAINT "habitacion_tiempos_permitidos_habitacion_id_fkey" FOREIGN KEY (habitacion_id) REFERENCES habitaciones(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."habitacion_tiempos_permitidos" ADD CONSTRAINT "habitacion_tiempos_permitidos_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."habitacion_tiempos_permitidos" ADD CONSTRAINT "habitacion_tiempos_permitidos_tiempo_estancia_id_fkey" FOREIGN KEY (tiempo_estancia_id) REFERENCES tiempos_estancia(id) ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."caja" ADD CONSTRAINT "caja_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE RESTRICT;
ALTER TABLE ONLY "public"."caja" ADD CONSTRAINT "caja_metodo_pago_id_fkey" FOREIGN KEY (metodo_pago_id) REFERENCES metodos_pago(id) ON DELETE SET NULL;
ALTER TABLE ONLY "public"."caja" ADD CONSTRAINT "caja_pago_reserva_id_fkey" FOREIGN KEY (pago_reserva_id) REFERENCES pagos_reserva(id) ON DELETE SET NULL;
ALTER TABLE ONLY "public"."caja" ADD CONSTRAINT "caja_reserva_id_fkey" FOREIGN KEY (reserva_id) REFERENCES reservas(id) ON DELETE SET NULL;
ALTER TABLE ONLY "public"."caja" ADD CONSTRAINT "caja_turno_id_fkey" FOREIGN KEY (turno_id) REFERENCES turnos(id) ON DELETE SET NULL;
ALTER TABLE ONLY "public"."caja" ADD CONSTRAINT "caja_usuario_id_fkey" FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."caja" ADD CONSTRAINT "caja_venta_tienda_id_fkey" FOREIGN KEY (venta_tienda_id) REFERENCES ventas_tienda(id) ON DELETE SET NULL;
ALTER TABLE ONLY "public"."caja" ADD CONSTRAINT "fk_venta_restaurante" FOREIGN KEY (venta_restaurante_id) REFERENCES ventas_restaurante(id) ON DELETE SET NULL;

ALTER TABLE ONLY "public"."tareas_mantenimiento" ADD CONSTRAINT "tareas_mantenimiento_asignada_a_fkey" FOREIGN KEY (asignada_a) REFERENCES usuarios(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."tareas_mantenimiento" ADD CONSTRAINT "tareas_mantenimiento_creada_por_fkey" FOREIGN KEY (creada_por) REFERENCES usuarios(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."tareas_mantenimiento" ADD CONSTRAINT "tareas_mantenimiento_habitacion_id_fkey" FOREIGN KEY (habitacion_id) REFERENCES habitaciones(id);
ALTER TABLE ONLY "public"."tareas_mantenimiento" ADD CONSTRAINT "tareas_mantenimiento_realizada_por_fkey" FOREIGN KEY (realizada_por) REFERENCES usuarios(id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."pagos_reserva" ADD CONSTRAINT "pagos_reserva_descuento_id_fkey" FOREIGN KEY (descuento_id) REFERENCES descuentos(id);
ALTER TABLE ONLY "public"."pagos_reserva" ADD CONSTRAINT "pagos_reserva_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE RESTRICT;
ALTER TABLE ONLY "public"."pagos_reserva" ADD CONSTRAINT "pagos_reserva_metodo_pago_id_fkey" FOREIGN KEY (metodo_pago_id) REFERENCES metodos_pago(id) ON DELETE RESTRICT;
ALTER TABLE ONLY "public"."pagos_reserva" ADD CONSTRAINT "pagos_reserva_reserva_id_fkey" FOREIGN KEY (reserva_id) REFERENCES reservas(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."pagos_reserva" ADD CONSTRAINT "pagos_reserva_usuario_id_fkey" FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."hoteles" ADD CONSTRAINT "hoteles_plan_id_fkey" FOREIGN KEY (plan_id) REFERENCES planes(id) ON DELETE SET NULL;
ALTER TABLE ONLY "public"."hoteles" ADD CONSTRAINT "hoteles_referido_por_fkey" FOREIGN KEY (referido_por) REFERENCES hoteles(id) ON DELETE SET NULL;

ALTER TABLE ONLY "public"."tiempos_estancia" ADD CONSTRAINT "fk_tiempos_estancia_hotel" FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."ventas_tienda" ADD CONSTRAINT "ventas_tienda_cliente_id_fkey" FOREIGN KEY (cliente_id) REFERENCES clientes(id);
ALTER TABLE ONLY "public"."ventas_tienda" ADD CONSTRAINT "ventas_tienda_descuento_aplicado_id_fkey" FOREIGN KEY (descuento_aplicado_id) REFERENCES descuentos(id) ON DELETE SET NULL;
ALTER TABLE ONLY "public"."ventas_tienda" ADD CONSTRAINT "ventas_tienda_descuento_id_fkey" FOREIGN KEY (descuento_id) REFERENCES descuentos(id);
ALTER TABLE ONLY "public"."ventas_tienda" ADD CONSTRAINT "ventas_tienda_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE RESTRICT;
ALTER TABLE ONLY "public"."ventas_tienda" ADD CONSTRAINT "ventas_tienda_metodo_pago_id_fkey" FOREIGN KEY (metodo_pago_id) REFERENCES metodos_pago(id) ON DELETE RESTRICT;
ALTER TABLE ONLY "public"."ventas_tienda" ADD CONSTRAINT "ventas_tienda_usuario_id_fkey" FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."notificaciones" ADD CONSTRAINT "fk_notif_user" FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."notificaciones" ADD CONSTRAINT "notificaciones_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."notificaciones" ADD CONSTRAINT "notificaciones_usuario_id_fkey" FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."servicios_x_reserva" ADD CONSTRAINT "servicios_x_reserva_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id);
ALTER TABLE ONLY "public"."servicios_x_reserva" ADD CONSTRAINT "servicios_x_reserva_reserva_id_fkey" FOREIGN KEY (reserva_id) REFERENCES reservas(id);
ALTER TABLE ONLY "public"."servicios_x_reserva" ADD CONSTRAINT "servicios_x_reserva_servicio_id_fkey" FOREIGN KEY (servicio_id) REFERENCES servicios_adicionales(id);

ALTER TABLE ONLY "public"."usuarios_roles" ADD CONSTRAINT "fk_usuarios_roles_hotel_id" FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."usuarios_roles" ADD CONSTRAINT "fk_usuarios_roles_rol_id" FOREIGN KEY (rol_id) REFERENCES roles(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."usuarios_roles" ADD CONSTRAINT "fk_usuarios_roles_usuario_id" FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."productos_tienda" ADD CONSTRAINT "fk_productos_tienda_categoria" FOREIGN KEY (categoria_id) REFERENCES categorias_producto(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY "public"."productos_tienda" ADD CONSTRAINT "productos_tienda_categoria_id_fkey" FOREIGN KEY (categoria_id) REFERENCES categorias_producto(id) ON DELETE SET NULL;
ALTER TABLE ONLY "public"."productos_tienda" ADD CONSTRAINT "productos_tienda_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."productos_tienda" ADD CONSTRAINT "productos_tienda_proveedor_id_fkey" FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE SET NULL;

ALTER TABLE ONLY "public"."log_caja_eliminados" ADD CONSTRAINT "log_caja_eliminados_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id);
ALTER TABLE ONLY "public"."log_caja_eliminados" ADD CONSTRAINT "log_caja_eliminados_usuario_id_fkey" FOREIGN KEY (eliminado_por_usuario_id) REFERENCES usuarios(id);

ALTER TABLE ONLY "public"."detalle_compras_tienda" ADD CONSTRAINT "detalle_compras_tienda_compra_id_fkey" FOREIGN KEY (compra_id) REFERENCES compras_tienda(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."detalle_compras_tienda" ADD CONSTRAINT "detalle_compras_tienda_producto_id_fkey" FOREIGN KEY (producto_id) REFERENCES productos_tienda(id);

ALTER TABLE ONLY "public"."compras_tienda" ADD CONSTRAINT "compras_tienda_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id);
ALTER TABLE ONLY "public"."compras_tienda" ADD CONSTRAINT "compras_tienda_proveedor_id_fkey" FOREIGN KEY (proveedor_id) REFERENCES proveedores(id);
ALTER TABLE ONLY "public"."compras_tienda" ADD CONSTRAINT "compras_tienda_recibido_por_usuario_id_fkey" FOREIGN KEY (recibido_por_usuario_id) REFERENCES usuarios(id);
ALTER TABLE ONLY "public"."compras_tienda" ADD CONSTRAINT "compras_tienda_usuario_id_fkey" FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."oauth_tokens" ADD CONSTRAINT "oauth_tokens_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."integraciones_calendar" ADD CONSTRAINT "integraciones_calendar_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id);

ALTER TABLE ONLY "public"."platos_recetas" ADD CONSTRAINT "platos_recetas_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."platos_recetas" ADD CONSTRAINT "platos_recetas_ingrediente_id_fkey" FOREIGN KEY (ingrediente_id) REFERENCES ingredientes(id) ON DELETE SET NULL;
ALTER TABLE ONLY "public"."platos_recetas" ADD CONSTRAINT "platos_recetas_plato_id_fkey" FOREIGN KEY (plato_id) REFERENCES platos(id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."ventas" ADD CONSTRAINT "ventas_cliente_id_fkey" FOREIGN KEY (cliente_id) REFERENCES clientes(id);
ALTER TABLE ONLY "public"."ventas" ADD CONSTRAINT "ventas_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."configuracion_hotel" ADD CONSTRAINT "configuracion_hotel_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."usuarios" ADD CONSTRAINT "usuarios_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE RESTRICT;
ALTER TABLE ONLY "public"."usuarios" ADD CONSTRAINT "usuarios_id_fkey" FOREIGN KEY (id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."programacion_config" ADD CONSTRAINT "programacion_config_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id);

ALTER TABLE ONLY "public"."habitaciones" ADD CONSTRAINT "fk_habitaciones_tipo" FOREIGN KEY (tipo_habitacion_id) REFERENCES tipos_de_habitacion(id) ON DELETE SET NULL;
ALTER TABLE ONLY "public"."habitaciones" ADD CONSTRAINT "habitaciones_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."clientes_descuentos" ADD CONSTRAINT "fk_cliente" FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."clientes_descuentos" ADD CONSTRAINT "fk_descuento" FOREIGN KEY (descuento_id) REFERENCES descuentos(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."clientes_descuentos" ADD CONSTRAINT "fk_hotel_cd" FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."historial_articulos_prestados" ADD CONSTRAINT "historial_articulos_prestados_habitacion_id_fkey" FOREIGN KEY (habitacion_id) REFERENCES habitaciones(id) ON DELETE SET NULL;
ALTER TABLE ONLY "public"."historial_articulos_prestados" ADD CONSTRAINT "historial_articulos_prestados_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES configuracion_hotel(hotel_id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."historial_articulos_prestados" ADD CONSTRAINT "historial_articulos_prestados_item_prestable_id_fkey" FOREIGN KEY (item_prestable_id) REFERENCES inventario_prestables(id) ON DELETE SET NULL;
ALTER TABLE ONLY "public"."historial_articulos_prestados" ADD CONSTRAINT "historial_articulos_prestados_reserva_id_fkey" FOREIGN KEY (reserva_id) REFERENCES reservas(id) ON DELETE SET NULL;
ALTER TABLE ONLY "public"."historial_articulos_prestados" ADD CONSTRAINT "historial_articulos_prestados_usuario_id_fkey" FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL;

ALTER TABLE ONLY "public"."log_lenceria_uso" ADD CONSTRAINT "log_lenceria_uso_habitacion_id_fkey" FOREIGN KEY (habitacion_id) REFERENCES habitaciones(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."log_lenceria_uso" ADD CONSTRAINT "log_lenceria_uso_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES configuracion_hotel(hotel_id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."log_lenceria_uso" ADD CONSTRAINT "log_lenceria_uso_item_lenceria_id_fkey" FOREIGN KEY (item_lenceria_id) REFERENCES inventario_lenceria(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."log_lenceria_uso" ADD CONSTRAINT "log_lenceria_uso_usuario_id_fkey" FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL;

ALTER TABLE ONLY "public"."log_amenidades_uso" ADD CONSTRAINT "log_amenidades_uso_habitacion_id_fkey" FOREIGN KEY (habitacion_id) REFERENCES habitaciones(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."log_amenidades_uso" ADD CONSTRAINT "log_amenidades_uso_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES configuracion_hotel(hotel_id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."log_amenidades_uso" ADD CONSTRAINT "log_amenidades_uso_item_id_fkey" FOREIGN KEY (item_id) REFERENCES amenidades_inventario(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."log_amenidades_uso" ADD CONSTRAINT "log_amenidades_uso_usuario_id_fkey" FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL;

ALTER TABLE ONLY "public"."tipos_de_habitacion" ADD CONSTRAINT "tipos_de_habitacion_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES configuracion_hotel(hotel_id) ON DELETE CASCADE;

ALTER TABLE ONLY "public"."amenidades_inventario" ADD CONSTRAINT "amenidades_inventario_hotel_id_fkey" FOREIGN KEY (hotel_id) REFERENCES configuracion_hotel(hotel_id) ON DELETE CASCADE;

CREATE UNIQUE INDEX uniq_turno_abierto_por_usuario_hotel ON public.turnos USING btree (hotel_id, usuario_id) WHERE ((estado)::text = 'abierto'::text);

CREATE INDEX idx_bitacora_hotel_id ON public.bitacora USING btree (hotel_id);

CREATE INDEX idx_reservas_external_event_id ON public.reservas USING btree (external_event_id);
CREATE INDEX idx_reservas_fecha_cancelacion ON public.reservas USING btree (fecha_cancelacion DESC);
CREATE INDEX idx_reservas_google_event_id ON public.reservas USING btree (google_event_id);

CREATE INDEX idx_descuentos_codigo ON public.descuentos USING btree (codigo);
CREATE INDEX idx_descuentos_hotel_id ON public.descuentos USING btree (hotel_id);

CREATE INDEX idx_clientes_activo ON public.clientes USING btree (activo);

CREATE INDEX idx_tiempos_estancia_hotel ON public.tiempos_estancia USING btree (hotel_id);
CREATE INDEX idx_tiempos_estancia_hotel_activo_nombre ON public.tiempos_estancia USING btree (hotel_id, activo, nombre);
CREATE INDEX idx_tiempos_estancia_hotel_minutos ON public.tiempos_estancia USING btree (hotel_id, minutos);
CREATE INDEX idx_tiempos_estancia_user ON public.tiempos_estancia USING btree (user_id);

CREATE INDEX idx_usuarios_roles_rol ON public.usuarios_roles USING btree (rol_id);
CREATE INDEX idx_usuarios_roles_usuario ON public.usuarios_roles USING btree (usuario_id);

CREATE INDEX idx_platos_recetas_plato_id ON public.platos_recetas USING btree (plato_id);

CREATE INDEX idx_usuarios_hotel ON public.usuarios USING btree (hotel_id);

CREATE INDEX idx_hist_articulos_hotel_fecha ON public.historial_articulos_prestados USING btree (hotel_id, fecha_accion);
CREATE INDEX idx_hist_articulos_reserva ON public.historial_articulos_prestados USING btree (reserva_id);

CREATE INDEX idx_log_amenidades_habitacion ON public.log_amenidades_uso USING btree (habitacion_id);
CREATE INDEX idx_log_amenidades_item ON public.log_amenidades_uso USING btree (item_id);

CREATE INDEX idx_amenidades_hotel ON public.amenidades_inventario USING btree (hotel_id);

CREATE OR REPLACE FUNCTION public.actualizar_amenidades_settings(updates amenidad_update[])
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  -- ESTA ES LA LÍNEA QUE FALTABA:
  update_item amenidad_update;
BEGIN
  FOREACH update_item IN ARRAY updates
  LOOP
    UPDATE public.amenidades_inventario
    SET
      cantidad_default = update_item.default_qty,
      stock_minimo_alerta = update_item.min_alert_qty
    WHERE
      id = update_item.item_id;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.actualizar_compra_y_detalles(p_compra_id uuid, detalles_a_actualizar jsonb, ids_a_eliminar uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_nuevo_total_compra NUMERIC;
BEGIN
    -- 1. Actualizar los detalles existentes
    UPDATE public.detalle_compras_tienda AS d
    SET
        cantidad = (rec.cantidad)::INT,
        precio_unitario = (rec.precio_unitario)::NUMERIC,
        subtotal = (rec.cantidad)::INT * (rec.precio_unitario)::NUMERIC
    FROM jsonb_to_recordset(detalles_a_actualizar) AS rec(id UUID, cantidad TEXT, precio_unitario TEXT)
    WHERE d.id = rec.id;

    -- 2. Borrar los productos marcados
    IF array_length(ids_a_eliminar, 1) > 0 THEN
        DELETE FROM public.detalle_compras_tienda
        WHERE id = ANY(ids_a_eliminar);
    END IF;

    -- 3. Recalcular y actualizar el total de la compra
    SELECT COALESCE(SUM(subtotal), 0)
    INTO v_nuevo_total_compra
    FROM public.detalle_compras_tienda
    WHERE compra_id = p_compra_id;

    UPDATE public.compras_tienda
    SET total_compra = round(v_nuevo_total_compra / 50) * 50
    WHERE id = p_compra_id;

END;
$function$;

CREATE OR REPLACE FUNCTION public.actualizar_concepto_caja_por_cambio_habitacion(p_reserva_id uuid, p_nombre_antiguo text, p_nombre_nuevo text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
    UPDATE caja
    SET concepto = REPLACE(concepto, p_nombre_antiguo, p_nombre_nuevo)
    WHERE 
        reserva_id = p_reserva_id
        AND concepto LIKE '%' || p_nombre_antiguo || '%';
END;
$function$;

CREATE OR REPLACE FUNCTION public.actualizar_notificacion_leida(p_notificacion_id uuid, p_usuario_id uuid, p_leida_estado boolean)
 RETURNS json
 LANGUAGE plpgsql
AS $function$
BEGIN
    UPDATE public.notificaciones
    SET leida = p_leida_estado, 
        actualizado_en = NOW()
    WHERE id = p_notificacion_id 
      AND hotel_id = (SELECT u.hotel_id FROM public.usuarios u WHERE u.id = p_usuario_id) -- Seguridad extra
      AND (usuario_id = p_usuario_id OR usuario_id IS NULL); -- Usuario específico o notificación general de rol (el rol se verificaría con RLS)

    IF NOT FOUND THEN
        RETURN json_build_object('error', TRUE, 'message', 'Notificación no encontrada o no tienes permiso para actualizarla.');
    END IF;

    RETURN json_build_object('success', TRUE, 'message', 'Estado de notificación actualizado.');
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '[NOTIFICACION_ESTADO] Error: % - %', SQLSTATE, SQLERRM;
        RETURN json_build_object('error', TRUE, 'message', 'Error interno al actualizar notificación: ' || SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.actualizar_ultimo_inicio_sesion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- Actualiza la columna 'ultimo_inicio_sesion' en la tabla 'public.usuarios'
  -- con el valor de 'last_sign_in_at' de la tabla 'auth.users'
  -- para el usuario que acaba de iniciar sesión.
  UPDATE public.usuarios
  SET ultimo_inicio_sesion = NEW.last_sign_in_at
  WHERE id = NEW.id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.after_insert_hotel_add_config()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO configuracion_hotel (hotel_id, correo_remitente)
  VALUES (NEW.id, 'support@gestiondehotel.com');
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.agregar_pago(reserva_id_param uuid, monto_param numeric)
 RETURNS void
 LANGUAGE sql
AS $function$
  UPDATE public.reservas
  SET monto_pagado = monto_pagado + monto_param
  WHERE id = reserva_id_param;
$function$;

CREATE OR REPLACE FUNCTION public.ajustar_stock_ingrediente(p_ingrediente_id uuid, p_cantidad_ajuste numeric, p_tipo_movimiento text, p_usuario_id uuid, p_notas text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    stock_anterior_val numeric;
    stock_nuevo_val numeric;
    cantidad_real_ajuste numeric;
BEGIN
    IF p_tipo_movimiento = 'entrada_compra' THEN
        cantidad_real_ajuste := p_cantidad_ajuste;
    ELSE
        cantidad_real_ajuste := -p_cantidad_ajuste;
    END IF;

    UPDATE public.ingredientes
    SET stock_actual = stock_actual + cantidad_real_ajuste
    WHERE id = p_ingrediente_id
    RETURNING stock_actual - cantidad_real_ajuste, stock_actual INTO stock_anterior_val, stock_nuevo_val;

    INSERT INTO public.movimientos_inventario (hotel_id, ingrediente_id, usuario_id, tipo_movimiento, cantidad, stock_anterior, stock_nuevo, notas)
    SELECT i.hotel_id, p_ingrediente_id, p_usuario_id, p_tipo_movimiento, cantidad_real_ajuste, stock_anterior_val, stock_nuevo_val, p_notas
    FROM public.ingredientes i WHERE i.id = p_ingrediente_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ajustar_stock_producto(p_producto_id uuid, p_cantidad_ajuste integer, p_tipo_movimiento text, p_usuario_id uuid, p_notas text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_stock_anterior INT;
    v_stock_nuevo INT;
    v_hotel_id UUID;
    v_usuario_nombre TEXT;
BEGIN
    -- Obtiene el stock actual y el hotel_id del producto.
    -- FOR UPDATE bloquea la fila para evitar que dos personas la modifiquen al mismo tiempo.
    SELECT stock_actual, hotel_id
    INTO v_stock_anterior, v_hotel_id
    FROM public.productos_tienda
    WHERE id = p_producto_id
    FOR UPDATE;

    -- Obtiene el nombre del usuario para el registro histórico.
    SELECT nombre
    INTO v_usuario_nombre
    FROM public.usuarios
    WHERE id = p_usuario_id;

    -- Calcula el nuevo stock.
    IF p_tipo_movimiento = 'ingreso_compra' OR p_tipo_movimiento = 'INGRESO' THEN
        v_stock_nuevo := v_stock_anterior + p_cantidad_ajuste;
    ELSE
        v_stock_nuevo := v_stock_anterior - p_cantidad_ajuste;
    END IF;

    -- Actualiza la tabla de productos con el nuevo stock.
    UPDATE public.productos_tienda
    SET stock_actual = v_stock_nuevo,
        actualizado_en = now()
    WHERE id = p_producto_id;

    -- Inserta un registro en la tabla de movimientos para auditoría.
    INSERT INTO public.movimientos_inventario(hotel_id, producto_id, tipo_movimiento, cantidad, razon, usuario_responsable, stock_anterior, stock_nuevo)
    VALUES (v_hotel_id, p_producto_id, p_tipo_movimiento, p_cantidad_ajuste, p_notas, v_usuario_nombre, v_stock_anterior, v_stock_nuevo);

END;
$function$;

CREATE OR REPLACE FUNCTION public.anadir_stock_prestable(p_item_id uuid, p_cantidad integer)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE public.inventario_prestables
  SET 
    stock_total = stock_total + p_cantidad,
    stock_disponible = stock_disponible + p_cantidad
  WHERE id = p_item_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cambiar_habitacion_transaccion(p_estado_destino estado_habitacion_enum, p_habitacion_destino_id uuid, p_habitacion_origen_id uuid, p_hotel_id uuid, p_motivo_cambio text, p_reserva_id uuid, p_usuario_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_reserva reservas%rowtype;
    v_origen  habitaciones%rowtype;
    v_destino habitaciones%rowtype;
begin
    -- 1. Reserva asociada a la habitación de origen y al hotel
    select *
      into v_reserva
      from reservas
     where id = p_reserva_id
       and hotel_id = p_hotel_id
       and habitacion_id = p_habitacion_origen_id
     for update;

    if not found then
        raise exception
            'Reserva % no encontrada para hotel % y habitación origen %',
            p_reserva_id, p_hotel_id, p_habitacion_origen_id;
    end if;

    -- 2. Habitación origen
    select *
      into v_origen
      from habitaciones
     where id = p_habitacion_origen_id
       and hotel_id = p_hotel_id
     for update;

    if not found then
        raise exception
            'Habitación origen % no encontrada para hotel %',
            p_habitacion_origen_id, p_hotel_id;
    end if;

    -- 3. Habitación destino
    select *
      into v_destino
      from habitaciones
     where id = p_habitacion_destino_id
       and hotel_id = p_hotel_id
     for update;

    if not found then
        raise exception
            'Habitación destino % no encontrada para hotel %',
            p_habitacion_destino_id, p_hotel_id;
    end if;

    -- Debe estar libre
    if v_destino.estado <> 'libre'::estado_habitacion_enum then
        raise exception
            'La habitación destino % no está libre (estado actual: %)',
            v_destino.id, v_destino.estado;
    end if;

    -- 4. Mover la reserva a la nueva habitación
    update reservas
       set habitacion_id = p_habitacion_destino_id,
           actualizado_en = now()
     where id = p_reserva_id;

    -- 5. Actualizar cronómetros asociados a esa reserva y habitación
    update cronometros
       set habitacion_id = p_habitacion_destino_id,
           actualizado_en = now()
     where reserva_id = p_reserva_id
       and habitacion_id = p_habitacion_origen_id
       and hotel_id = p_hotel_id;

    -- 6. Estados de habitaciones
    update habitaciones
       set estado = 'limpieza'::estado_habitacion_enum,
           actualizado_en = now()
     where id = p_habitacion_origen_id
       and hotel_id = p_hotel_id;

    update habitaciones
       set estado = p_estado_destino,
           actualizado_en = now()
     where id = p_habitacion_destino_id
       and hotel_id = p_hotel_id;

    -- 7. Registrar en cambios_habitacion
    insert into cambios_habitacion (
        hotel_id,
        reserva_id,
        habitacion_origen_id,
        habitacion_destino_id,
        motivo,
        usuario_id
    )
    values (
        p_hotel_id,
        p_reserva_id,
        p_habitacion_origen_id,
        p_habitacion_destino_id,
        p_motivo_cambio,
        p_usuario_id
    );

    -- 8. Registrar en bitácora
    insert into bitacora (hotel_id, usuario_id, modulo, accion, detalles)
    values (
        p_hotel_id,
        p_usuario_id,
        'reservas',
        'cambio_habitacion',
        jsonb_build_object(
            'reserva_id', p_reserva_id,
            'habitacion_origen_id', p_habitacion_origen_id,
            'habitacion_destino_id', p_habitacion_destino_id,
            'motivo', p_motivo_cambio
        )
    );
end;
$function$;

CREATE OR REPLACE FUNCTION public.cambiar_habitacion_transaccion(p_reserva_id uuid, p_habitacion_origen_id uuid, p_habitacion_destino_id uuid, p_motivo_cambio text, p_usuario_id uuid, p_hotel_id uuid, p_nuevo_estado_destino estado_habitacion_enum)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    -- 1. Actualizar la reserva para que apunte a la nueva habitación
    UPDATE public.reservas
    SET habitacion_id = p_habitacion_destino_id
    WHERE id = p_reserva_id;

    -- 2. Actualizar el cronómetro activo si existe
    UPDATE public.cronometros
    SET habitacion_id = p_habitacion_destino_id
    WHERE reserva_id = p_reserva_id AND activo = true;

    -- 3. Poner la habitación de ORIGEN en "limpieza"
    UPDATE public.habitaciones
    SET estado = 'limpieza'
    WHERE id = p_habitacion_origen_id;

    -- 4. Poner la habitación de DESTINO en el estado que tenía la reserva (ej. 'ocupada')
    UPDATE public.habitaciones
    SET estado = p_nuevo_estado_destino
    WHERE id = p_habitacion_destino_id;

    -- 5. Registrar el evento en la tabla de cambios
    INSERT INTO public.cambios_habitacion(hotel_id, reserva_id, habitacion_origen_id, habitacion_destino_id, motivo, usuario_id, fecha)
    VALUES (p_hotel_id, p_reserva_id, p_habitacion_origen_id, p_habitacion_destino_id, p_motivo_cambio, p_usuario_id, now());
END;
$function$;

CREATE OR REPLACE FUNCTION public.crear_configuracion_turno_default()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO configuracion_turnos (
    hotel_id,
    usuario_id,
    activo,
    tipo_turno,
    horas_turno,
    turnos_por_semana,
    dias_descanso
  ) VALUES (
    NEW.hotel_id,
    NEW.id,
    TRUE,
    'rotativo',
    8,
    5,
    2
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.crear_habitacion_con_tiempos(p_nombre text, p_tipo text, p_precio numeric, p_estado estado_habitacion_enum, p_amenidades text[], p_hotel_id uuid, p_tiempos_estancia_ids uuid[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_habitacion_id UUID;
    v_tiempo_id UUID;
BEGIN
    INSERT INTO public.habitaciones (nombre, tipo, precio, estado, amenidades, hotel_id, activo)
    VALUES (p_nombre, p_tipo, p_precio, p_estado, p_amenidades, p_hotel_id, TRUE)
    RETURNING id INTO v_habitacion_id;

    IF p_tiempos_estancia_ids IS NOT NULL AND array_length(p_tiempos_estancia_ids, 1) > 0 THEN
        FOREACH v_tiempo_id IN ARRAY p_tiempos_estancia_ids
        LOOP
            INSERT INTO public.habitacion_tiempos_permitidos (habitacion_id, tiempo_estancia_id, hotel_id)
            VALUES (v_habitacion_id, v_tiempo_id, p_hotel_id);
        END LOOP;
    END IF;

    RETURN json_build_object('success', TRUE, 'message', 'Habitación creada con tiempos permitidos.', 'habitacion_id', v_habitacion_id);
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '[CREAR_HABITACION] Error: % - %', SQLSTATE, SQLERRM;
        RETURN json_build_object('error', TRUE, 'message', 'Error interno al crear habitación: ' || SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crear_usuario_con_perfil_y_roles_basico(p_email text, p_password text, p_nombre text, p_hotel_id uuid, p_roles_ids uuid[], p_activo boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    new_auth_user_id UUID;
    profile_user_id UUID;
    rol_id_item UUID;
    user_metadata JSONB;
BEGIN
    user_metadata := jsonb_build_object(
        'nombre', p_nombre,
        'hotel_id', p_hotel_id 
    );

    -- 1. Crear el usuario en auth.users
    -- Se omite instance_id, Supabase debería manejarlo.
    INSERT INTO auth.users (
        id, aud, role, email, encrypted_password, 
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data, 
        created_at, updated_at
    ) VALUES (
        gen_random_uuid(), -- Generar un nuevo UUID para el id del usuario
        'authenticated', 
        'authenticated', 
        p_email, 
        crypt(p_password, gen_salt('bf')), 
        now(), 
        jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')), 
        user_metadata, 
        now(), 
        now()
    ) RETURNING id INTO new_auth_user_id;

    -- 2. Crear el perfil del usuario en la tabla 'usuarios'
    INSERT INTO public.usuarios (id, hotel_id, nombre, correo, activo, creado_en, actualizado_en)
    VALUES (new_auth_user_id, p_hotel_id, p_nombre, p_email, p_activo, now(), now())
    RETURNING id INTO profile_user_id;

    -- 3. Asignar roles al usuario en 'usuarios_roles'
    IF array_length(p_roles_ids, 1) > 0 THEN
        FOREACH rol_id_item IN ARRAY p_roles_ids
        LOOP
            INSERT INTO public.usuarios_roles (usuario_id, rol_id, hotel_id)
            VALUES (profile_user_id, rol_id_item, p_hotel_id);
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'user_id', profile_user_id, 
        'user_name', p_nombre, 
        'email', p_email,
        'message', 'Usuario creado y configurado exitosamente.'
    );
EXCEPTION
    WHEN unique_violation THEN 
        RAISE WARNING 'Error de violación de unicidad en RPC: % - %', SQLSTATE, SQLERRM;
        RETURN jsonb_build_object('error', TRUE, 'error_message', 'El correo electrónico ''' || p_email || ''' ya está registrado.', 'sql_state', SQLSTATE);
    WHEN OTHERS THEN
        RAISE WARNING 'Error en RPC crear_usuario_con_perfil_y_roles_basico: % - %', SQLSTATE, SQLERRM;
        RETURN jsonb_build_object('error', TRUE, 'error_message', SQLERRM, 'sql_state', SQLSTATE);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crear_usuario_con_roles(p_nombre text, p_correo text, p_hotel_id uuid, p_roles_ids uuid[], p_activo boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
  new_user_id UUID;
  role_id UUID;
BEGIN
  -- Crear el usuario
  INSERT INTO usuarios (id, nombre, correo, hotel_id, activo, creado_en)
  VALUES (gen_random_uuid(), p_nombre, p_correo, p_hotel_id, p_activo, now())
  RETURNING id INTO new_user_id;

  -- Asignar los roles seleccionados
  FOREACH role_id IN ARRAY p_roles_ids LOOP
    INSERT INTO usuarios_roles (id, usuario_id, rol_id, hotel_id, creado_en)
    VALUES (gen_random_uuid(), new_user_id, role_id, p_hotel_id, now());
  END LOOP;

  RETURN new_user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.crypto_aead_det_decrypt(additional_data bytea, ciphertext bytea)
 RETURNS bytea
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT pgsodium.crypto_aead_det_decrypt(
    ciphertext,
    additional_data,
    decode('8I5pQk7XWTgVoTG+c4yz5jbq1gWW/Eaqklk6hYB1kSw=', 'base64'),
    NULL
  );
$function$;

CREATE OR REPLACE FUNCTION public.crypto_aead_det_encrypt(additional_data bytea, plaintext bytea)
 RETURNS bytea
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT pgsodium.crypto_aead_det_encrypt(
    plaintext,
    additional_data,
    decode('8I5pQk7XWTgVoTG+c4yz5jbq1gWW/Eaqklk6hYB1kSw=', 'base64'),
    NULL
  );
$function$;

CREATE OR REPLACE FUNCTION public.decrementar_stock_producto(id_producto uuid, cantidad_a_restar integer, p_hotel_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    UPDATE public.productos_tienda
    SET stock_actual = stock_actual - cantidad_a_restar,
        actualizado_en = now()
    WHERE id = id_producto AND hotel_id = p_hotel_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.derive_key(key_id bigint, key_len integer DEFAULT 32, context bytea DEFAULT decode('7067736f6469756d'::text, 'hex'::text))
 RETURNS bytea
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT pgsodium.derive_key(key_id, key_len, context);
$function$;

CREATE OR REPLACE FUNCTION public.descontar_stock_por_venta(p_venta_item_id bigint, p_plato_id uuid, p_cantidad_vendida integer)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    receta_actual RECORD;
    ingrediente_actual RECORD;
    stock_anterior NUMERIC;
BEGIN
    SELECT id INTO receta_actual FROM public.recetas WHERE plato_id = p_plato_id;

    IF FOUND THEN
        FOR ingrediente_actual IN
            SELECT ingrediente_id, cantidad FROM public.recetas_items WHERE receta_id = receta_actual.id
        LOOP
            SELECT stock_actual INTO stock_anterior FROM public.ingredientes WHERE id = ingrediente_actual.ingrediente_id;

            UPDATE public.ingredientes
            SET stock_actual = stock_actual - (ingrediente_actual.cantidad * p_cantidad_vendida)
            WHERE id = ingrediente_actual.ingrediente_id;

            INSERT INTO public.movimientos_inventario(hotel_id, ingrediente_id, tipo_movimiento, cantidad, stock_anterior, stock_nuevo, venta_restaurante_item_id)
            SELECT
                i.hotel_id,
                ingrediente_actual.ingrediente_id,
                'venta_plato', -- <-- CORRECCIÓN: Se inserta como texto simple
                - (ingrediente_actual.cantidad * p_cantidad_vendida),
                stock_anterior,
                i.stock_actual,
                p_venta_item_id
            FROM public.ingredientes i WHERE i.id = ingrediente_actual.ingrediente_id;
        END LOOP;
    END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.encrypt_oauth_token(plaintext text, additional_data text)
 RETURNS bytea
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    derived_key bytea;
    nonce bytea;
BEGIN
    -- Usa la única firma válida en Supabase: crypto_generichash(bytea, bytea)
    derived_key := pgsodium.crypto_generichash(
        convert_to(additional_data, 'utf8'),
        NULL::bytea
    );

    nonce := pgsodium.crypto_aead_det_noncegen();

    RETURN pgsodium.crypto_aead_det_encrypt(
        convert_to(plaintext, 'utf8'),
        derived_key,
        nonce,
        convert_to(additional_data, 'utf8')
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.encrypt_text(plaintext text, key bytea, nonce bytea)
 RETURNS bytea
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pgsodium'
AS $function$
  select crypto_aead_det_encrypt(
    convert_to(plaintext, 'utf8'), 
    key, 
    nonce, 
    null -- datos adicionales (opcional)
  );
$function$;

CREATE OR REPLACE FUNCTION public.extender_tiempo_cronometro(p_cronometro_id uuid, p_minutos_extra integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    IF p_minutos_extra <= 0 THEN RAISE EXCEPTION 'Los minutos extra deben ser un valor positivo.'; END IF;
    UPDATE public.cronometros SET fecha_fin = fecha_fin + (p_minutos_extra * interval '1 minute'), actualizado_en = NOW()
    WHERE id = p_cronometro_id AND activo = TRUE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cronómetro no encontrado, inactivo, o no se pudo extender.'; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_current_hotel_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT hotel_id
  FROM public.usuarios
  WHERE id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.get_current_user_hotel_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$ SELECT hotel_id FROM public.usuarios WHERE id = auth.uid() LIMIT 1; $function$;

CREATE OR REPLACE FUNCTION public.get_current_user_hotel_id_from_profile()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  SELECT (auth.jwt() -> 'user_metadata' ->> 'hotel_id')::uuid;
  -- Ajusta el casteo ::uuid si tu hotel_id es de otro tipo (ej. ::text o ::integer).
$function$;

CREATE OR REPLACE FUNCTION public.get_current_user_rol()
 RETURNS rol_usuario_enum
 LANGUAGE sql
 STABLE
AS $function$ SELECT rol FROM public.usuarios WHERE id = auth.uid() LIMIT 1; $function$;

CREATE OR REPLACE FUNCTION public.get_current_user_rol_from_profile()
 RETURNS rol_usuario_enum
 LANGUAGE sql
 STABLE
AS $function$
  SELECT (auth.jwt() -> 'user_metadata' ->> 'rol')::public.rol_usuario_enum;
  -- Si 'rol' en user_metadata es TEXT y tu columna 'rol' es ENUM, el casteo es necesario.
  -- Si 'rol' en user_metadata es TEXT y tu columna 'rol' también es TEXT, quita el casteo:
  -- SELECT auth.jwt() -> 'user_metadata' ->> 'rol';
$function$;

CREATE OR REPLACE FUNCTION public.get_dashboard_kpis(p_hotel_id uuid)
 RETURNS json
 LANGUAGE plpgsql
AS $function$
DECLARE
    _reservas_hoy_count int;
    _ingresos_hoy_sum numeric;
    _total_habitaciones_count int;
    _ocupadas_count int;
    _ventas_tienda_sum numeric;
BEGIN
    SELECT count(*) INTO _reservas_hoy_count FROM reservas WHERE hotel_id = p_hotel_id AND estado IN ('activa', 'confirmada', 'check_in') AND fecha_inicio <= now() AND fecha_fin >= now();
    SELECT COALESCE(sum(monto), 0) INTO _ingresos_hoy_sum FROM caja WHERE hotel_id = p_hotel_id AND tipo = 'ingreso' AND date(fecha_movimiento) = current_date AND concepto IN ('Pago completo de reserva', 'Abono de reserva');
    SELECT count(*) INTO _total_habitaciones_count FROM habitaciones WHERE hotel_id = p_hotel_id AND activo = true;
    SELECT count(*) INTO _ocupadas_count FROM habitaciones WHERE hotel_id = p_hotel_id AND estado = 'ocupada';
    SELECT COALESCE(sum(total_venta), 0) INTO _ventas_tienda_sum FROM ventas_tienda WHERE hotel_id = p_hotel_id AND date(fecha) = current_date;

    RETURN json_build_object(
        'reservas_hoy', _reservas_hoy_count,
        'ingresos_hoy', _ingresos_hoy_sum,
        'habitaciones_total', _total_habitaciones_count,
        'habitaciones_ocupadas', _ocupadas_count,
        'ventas_tienda_hoy', _ventas_tienda_sum
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_dashboard_metrics(p_hotel_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_ingresos_habitaciones_hoy NUMERIC;
  v_ingresos_tienda_hoy NUMERIC;
  v_ingresos_habitaciones_ayer NUMERIC;
  v_ingresos_tienda_ayer NUMERIC;
  v_reservas_activas_hoy INT;
  v_reservas_activas_ayer INT;
  v_habitaciones_ocupadas_ahora INT;
  v_habitaciones_activas_total INT;

  v_checkins JSONB;
  v_checkouts JSONB;

  v_kpis JSONB;
  v_result JSONB;

  v_today_start TIMESTAMPTZ;
  v_today_end TIMESTAMPTZ;
  v_yesterday_start TIMESTAMPTZ;
  v_yesterday_end TIMESTAMPTZ;
  v_user_timezone TEXT;

BEGIN
  -- Obtener la zona horaria del hotel o usar una por defecto
  -- Esto es un ejemplo, necesitarás una forma de obtener la zona horaria específica del hotel si varía.
  -- Si todos tus hoteles están en la misma zona, puedes hardcodearla.
  -- O, si la pasas como parámetro a la función, úsala.
  -- Por ahora, usaremos 'America/Bogota' como ejemplo. ¡AJUSTA ESTO!
  v_user_timezone := 'America/Bogota'; 

  v_today_start := date_trunc('day', timezone(v_user_timezone, now()));
  v_today_end := v_today_start + interval '1 day';
  v_yesterday_start := v_today_start - interval '1 day';
  v_yesterday_end := v_today_start;

  -- Lógica para calcular ingresos_habitaciones_hoy
  SELECT COALESCE(SUM(monto), 0)
  INTO v_ingresos_habitaciones_hoy
  FROM public.caja
  WHERE hotel_id = p_hotel_id
    AND tipo = 'ingreso'
    AND venta_tienda_id IS NULL 
    AND creado_en >= v_today_start
    AND creado_en < v_today_end;

  -- Lógica para calcular ingresos_tienda_hoy
  SELECT COALESCE(SUM(monto), 0)
  INTO v_ingresos_tienda_hoy
  FROM public.caja
  WHERE hotel_id = p_hotel_id
    AND tipo = 'ingreso'
    AND venta_tienda_id IS NOT NULL 
    AND creado_en >= v_today_start
    AND creado_en < v_today_end;

  -- Lógica para ingresos_habitaciones_ayer
  SELECT COALESCE(SUM(monto), 0)
  INTO v_ingresos_habitaciones_ayer
  FROM public.caja
  WHERE hotel_id = p_hotel_id
    AND tipo = 'ingreso'
    AND venta_tienda_id IS NULL
    AND creado_en >= v_yesterday_start
    AND creado_en < v_yesterday_end;

  -- Lógica para ingresos_tienda_ayer
    SELECT COALESCE(SUM(monto), 0)
    INTO v_ingresos_tienda_ayer
    FROM public.caja
    WHERE hotel_id = p_hotel_id
        AND tipo = 'ingreso'
        AND venta_tienda_id IS NOT NULL
        AND creado_en >= v_yesterday_start
        AND creado_en < v_yesterday_end;

  -- Lógica para reservas_activas_hoy
    SELECT COUNT(*)
    INTO v_reservas_activas_hoy
    FROM public.reservas
    WHERE hotel_id = p_hotel_id
        AND estado IN ('activa', 'ocupada') 
        AND fecha_inicio < v_today_end 
        AND fecha_fin > v_today_start; 

  -- Lógica para reservas_activas_ayer
    SELECT COUNT(*)
    INTO v_reservas_activas_ayer
    FROM public.reservas
    WHERE hotel_id = p_hotel_id
        AND estado IN ('activa', 'ocupada')
        AND fecha_inicio < v_yesterday_end
        AND fecha_fin > v_yesterday_start;

  -- Lógica para habitaciones_ocupadas_ahora
    SELECT COUNT(*)
    INTO v_habitaciones_ocupadas_ahora
    FROM public.habitaciones
    WHERE hotel_id = p_hotel_id
        AND activo = TRUE -- Solo contar habitaciones activas del hotel
        AND estado IN ('ocupada', 'tiempo agotado');

  -- Lógica para habitaciones_activas_total (total de habitaciones del hotel que están 'activas' para ser usadas)
    SELECT COUNT(*)
    INTO v_habitaciones_activas_total
    FROM public.habitaciones
    WHERE hotel_id = p_hotel_id
        AND activo = TRUE;


  -- Check-ins para hoy
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'cliente_nombre', r.cliente_nombre,
      'habitacion_nombre', h.nombre,
      'fecha_inicio', r.fecha_inicio
  ) ORDER BY r.fecha_inicio ASC), '[]'::jsonb)
  INTO v_checkins
  FROM public.reservas r
  JOIN public.habitaciones h ON r.habitacion_id = h.id
  WHERE r.hotel_id = p_hotel_id
    AND r.estado IN ('confirmada', 'reservada') 
    AND r.fecha_inicio >= v_today_start
    AND r.fecha_inicio < v_today_end;


  -- Check-outs para hoy
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'cliente_nombre', r.cliente_nombre,
      'habitacion_nombre', h.nombre,
      'fecha_fin', r.fecha_fin
  ) ORDER BY r.fecha_fin ASC), '[]'::jsonb)
  INTO v_checkouts
  FROM public.reservas r
  JOIN public.habitaciones h ON r.habitacion_id = h.id
  WHERE r.hotel_id = p_hotel_id
    AND r.estado IN ('activa', 'ocupada', 'tiempo agotado') 
    AND r.fecha_fin >= v_today_start
    AND r.fecha_fin < v_today_end;

  v_kpis := jsonb_build_object(
    'ingresos_habitaciones_hoy', v_ingresos_habitaciones_hoy,
    'ingresos_habitaciones_ayer', v_ingresos_habitaciones_ayer,
    'ingresos_tienda_hoy', v_ingresos_tienda_hoy,
    'ingresos_tienda_ayer', v_ingresos_tienda_ayer,
    'reservas_activas_hoy', v_reservas_activas_hoy,
    'reservas_activas_ayer', v_reservas_activas_ayer,
    'habitaciones_ocupadas_ahora', v_habitaciones_ocupadas_ahora,
    'habitaciones_activas_total', v_habitaciones_activas_total
  );

  v_result := jsonb_build_object(
      'kpis', v_kpis,
      'checkins', v_checkins,
      'checkouts', v_checkouts
  );

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_estado_habitaciones(p_hotel_id uuid)
 RETURNS TABLE(id uuid, nombre text, tipo text, estado text, reserva_id uuid, reserva_estado text, cliente_nombre text, fecha_fin timestamp with time zone)
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        h.id,
        h.nombre,
        h.tipo,
        h.estado::text, -- Hacemos un "cast" explícito a TEXT para asegurar compatibilidad
        r.id AS reserva_id,
        r.estado::text AS reserva_estado, -- Hacemos un "cast" explícito a TEXT
        r.cliente_nombre,
        r.fecha_fin
    FROM
        public.habitaciones h
    LEFT JOIN
        public.reservas r ON h.id = r.habitacion_id
        AND r.estado IN ('activa', 'check_in', 'reservada', 'confirmada')
    WHERE
        h.hotel_id = p_hotel_id
        AND h.activo = TRUE
    ORDER BY
        h.nombre;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_low_stock_ingredientes(hotel_uuid uuid)
 RETURNS SETOF ingredientes
 LANGUAGE sql
AS $function$
  SELECT *
  FROM ingredientes
  WHERE
    stock_actual <= stock_minimo AND hotel_id = hotel_uuid;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_claim(claim text)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  SELECT nullif(current_setting('request.jwt.claims', true)::jsonb ->> claim, '')::TEXT;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_current_hotel_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  SELECT (auth.jwt() -> 'user_metadata' ->> 'hotel_id')::uuid; -- Asegúrate de que el casteo a ::uuid sea correcto para tu tipo de hotel_id.
$function$;

CREATE OR REPLACE FUNCTION public.get_my_current_rol()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  SELECT auth.jwt() -> 'user_metadata' ->> 'rol';
$function$;

CREATE OR REPLACE FUNCTION public.get_my_hotel_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT hotel_id
  FROM public.usuarios
  WHERE id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.get_my_role()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    -- Si el usuario no está autenticado, devuelve un rol por defecto o nulo
    IF auth.uid() IS NULL THEN
        RETURN 'anon';
    END IF;
    
    -- Intenta obtener el rol del metadata del token JWT.
    -- Si no existe, devuelve 'recepcionista' como valor por defecto.
    RETURN coalesce(
        (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'rol'),
        'recepcionista'
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_permisos_usuario(p_usuario_id uuid)
 RETURNS TABLE(id uuid, nombre text, descripcion text)
 LANGUAGE sql
AS $function$
  select p.id, p.nombre, p.descripcion
  from permisos p
  where
    (
      exists (
        select 1
        from usuarios_roles ur
        join roles_permisos rp on ur.rol_id = rp.rol_id
        where ur.usuario_id = p_usuario_id and rp.permiso_id = p.id
      )
      or exists (
        select 1 from usuarios_permisos up where up.usuario_id = p_usuario_id and up.permiso_id = p.id and up.permitido = true
      )
    )
    and not exists (
      select 1 from usuarios_permisos up where up.usuario_id = p_usuario_id and up.permiso_id = p.id and up.permitido = false
    )
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- Actualiza los metadatos de la app para el nuevo usuario en auth.users
  UPDATE auth.users
  SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object(
      'hotel_id', (SELECT hotel_id FROM public.usuarios WHERE id = NEW.id),
      'rol',      (SELECT rol::text FROM public.usuarios WHERE id = NEW.id)
  )
  WHERE id = NEW.id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.increment(table_name text, column_name text, row_id uuid, amount integer DEFAULT 1)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  EXECUTE format('UPDATE public.%I SET %I = %I + %s WHERE id = %L',
                 table_name,
                 column_name,
                 column_name,
                 amount,
                 row_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.incrementar_uso_descuento(descuento_id_param uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  update descuentos
  set usos_actuales = usos_actuales + 1
  where id = descuento_id_param;
end;
$function$;

CREATE OR REPLACE FUNCTION public.is_hotel_admin(hotel_id_to_check uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ DECLARE is_admin BOOLEAN; BEGIN IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'hoteles') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hoteles' AND column_name = 'admin_id') THEN SELECT EXISTS (SELECT 1 FROM public.hoteles h WHERE h.id = hotel_id_to_check AND h.admin_id = auth.uid()) INTO is_admin; ELSE is_admin := FALSE; END IF; RETURN is_admin; END; $function$;

CREATE OR REPLACE FUNCTION public.marcar_todas_mis_notificaciones_leidas()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE notificaciones
  SET leida = true, actualizado_en = now()
  WHERE
    leida = false
    AND
    (
      (usuario_id = auth.uid()) -- Marca las que son para mí
      OR
      (usuario_id IS NULL AND rol_destino = get_my_role()::rol_usuario_enum) -- Y también las que son para mi rol
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.mover_lenceria_a_lavanderia(item_id_param uuid, cantidad_param integer)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE public.inventario_lenceria SET 
    stock_limpio_almacen = stock_limpio_almacen - cantidad_param,
    stock_en_lavanderia = stock_en_lavanderia + cantidad_param
  WHERE id = item_id_param;
END;
$function$;

CREATE OR REPLACE FUNCTION public.obtener_habitaciones_disponibles_para_periodo(p_hotel_id uuid, p_fecha_inicio_deseada timestamp with time zone, p_fecha_fin_deseada timestamp with time zone)
 RETURNS TABLE(id uuid, nombre text, tipo text, precio numeric, estado tipo_estado_habitacion, capacidad_base integer, capacidad_maxima integer, precio_huesped_adicional numeric, permite_reservas_por_horas boolean, precio_base_hora numeric)
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        h.id, h.nombre, h.tipo, h.precio, h.estado,
        h.capacidad_base, h.capacidad_maxima, h.precio_huesped_adicional,
        h.permite_reservas_por_horas, h.precio_base_hora
    FROM public.habitaciones h
    WHERE h.hotel_id = p_hotel_id
      AND h.activo = TRUE
      AND h.estado NOT IN (
          'mantenimiento'::public.tipo_estado_habitacion,
          'bloqueada'::public.tipo_estado_habitacion,
          'ocupada'::public.tipo_estado_habitacion, 
          'limpieza'::public.tipo_estado_habitacion
      )
      AND NOT EXISTS (
          SELECT 1 FROM public.reservas r
          WHERE r.habitacion_id = h.id
            AND r.estado IN (
                -- Usa los valores de TU ENUM 'estado_reserva_enum'
                -- y cástialos al tipo correcto: public.estado_reserva_enum
                'reservada'::public.estado_reserva_enum,
                'confirmada'::public.estado_reserva_enum,
                'activa'::public.estado_reserva_enum,
                'check_in'::public.estado_reserva_enum,
                'pendiente'::public.estado_reserva_enum,
                'ocupada'::public.estado_reserva_enum
            )
            AND tsrange(r.fecha_inicio, r.fecha_fin, '[)') && tsrange(p_fecha_inicio_deseada, p_fecha_fin_deseada, '[)')
      )
    ORDER BY h.nombre;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pgsodium_crypto_aead_det_decrypt(additional_data bytea, ciphertext bytea)
 RETURNS bytea
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT pgsodium.crypto_aead_det_decrypt(
    ciphertext,
    additional_data,
    decode('8I5pQk7XWTgVoTG+c4yz5jbq1gWW/Eaqklk6hYB1kSw=', 'base64'),
    NULL
  );
$function$;

CREATE OR REPLACE FUNCTION public.pgsodium_crypto_aead_det_encrypt(additional_data bytea, plaintext bytea)
 RETURNS bytea
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT pgsodium.crypto_aead_det_encrypt(
    plaintext,
    additional_data,
    decode('8I5pQk7XWTgVoTG+c4yz5jbq1gWW/Eaqklk6hYB1kSw=', 'base64'),
    NULL
  );
$function$;

CREATE OR REPLACE FUNCTION public.prestar_articulo(p_item_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE public.inventario_prestables
  SET stock_disponible = stock_disponible - 1
  WHERE id = p_item_id
  AND stock_disponible > 0; -- Seguridad para no prestar si no hay
END;
$function$;

CREATE OR REPLACE FUNCTION public.procesar_venta_restaurante_y_caja(p_hotel_id uuid, p_usuario_id uuid, p_metodo_pago_id uuid, p_platos_vendidos jsonb, p_monto_total_venta numeric, p_nombre_cliente_temporal text)
 RETURNS json
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_venta_id uuid;
    v_turno_id uuid;
    plato_item jsonb;
    v_concepto_caja text;
BEGIN
    -- 1. Verificar si hay un turno activo para el usuario
    SELECT id INTO v_turno_id
    FROM public.turnos
    WHERE usuario_id = p_usuario_id
      AND hotel_id = p_hotel_id
      AND estado = 'abierto'
    ORDER BY fecha_apertura DESC
    LIMIT 1;

    -- Si no hay turno activo, devolver un error
    IF v_turno_id IS NULL THEN
        RETURN json_build_object('error', true, 'message', 'No se encontró un turno activo para el usuario.');
    END IF;

    -- 2. Insertar la venta principal en la tabla 'ventas_restaurante'
    INSERT INTO public.ventas_restaurante (hotel_id, usuario_id, metodo_pago_id, monto_total, nombre_cliente_temporal)
    VALUES (p_hotel_id, p_usuario_id, p_metodo_pago_id, p_monto_total_venta, p_nombre_cliente_temporal)
    RETURNING id INTO v_venta_id;

    -- 3. Iterar sobre cada plato vendido y registrarlo en 'ventas_restaurante_items'
    FOR plato_item IN SELECT * FROM jsonb_array_elements(p_platos_vendidos)
    LOOP
        INSERT INTO public.ventas_restaurante_items (venta_id, plato_id, cantidad, precio_unitario_venta, subtotal)
        VALUES (
            v_venta_id,
            (plato_item->>'plato_id')::uuid,
            (plato_item->>'cantidad')::integer,
            (plato_item->>'precio_unitario')::numeric,
            (plato_item->>'cantidad')::integer * (plato_item->>'precio_unitario')::numeric
        );
    END LOOP;

    -- 4. Registrar el ingreso en la tabla 'caja'
    v_concepto_caja := 'Venta restaurante #' || substr(v_venta_id::text, 1, 8);
    IF p_nombre_cliente_temporal IS NOT NULL AND p_nombre_cliente_temporal <> '' THEN
        v_concepto_caja := v_concepto_caja || ' - Cliente: ' || p_nombre_cliente_temporal;
    END IF;

    INSERT INTO public.caja (hotel_id, usuario_id, turno_id, tipo, monto, concepto, metodo_pago_id, venta_restaurante_id)
    VALUES (p_hotel_id, p_usuario_id, v_turno_id, 'ingreso', p_monto_total_venta, v_concepto_caja, p_metodo_pago_id, v_venta_id);

    -- 5. Devolver una respuesta exitosa con el ID de la nueva venta
    RETURN json_build_object('error', false, 'message', 'Venta procesada exitosamente.', 'venta_id', v_venta_id);

EXCEPTION
    WHEN OTHERS THEN
        -- En caso de cualquier error, devolver un mensaje de error
        RETURN json_build_object('error', true, 'message', 'Error en la base de datos: ' || SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.procesar_venta_tienda_simple_y_caja(p_producto_id uuid, p_cantidad_vendida integer, p_precio_unitario_venta numeric, p_metodo_pago_id uuid, p_usuario_id uuid, p_hotel_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_stock_actual INT;
    v_nuevo_stock INT;
    v_venta_id UUID;
    v_nombre_producto TEXT;
    v_concepto_caja TEXT;
    v_total_venta NUMERIC;
BEGIN
    SELECT nombre, stock INTO v_nombre_producto, v_stock_actual
    FROM public.productos_tienda
    WHERE id = p_producto_id AND hotel_id = p_hotel_id AND activo = TRUE
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN json_build_object('error', TRUE, 'message', 'Producto no encontrado, inactivo o no pertenece al hotel.');
    END IF;
    IF v_stock_actual < p_cantidad_vendida THEN
        RETURN json_build_object('error', TRUE, 'message', 'Stock insuficiente para ' || v_nombre_producto);
    END IF;

    v_total_venta := p_cantidad_vendida * p_precio_unitario_venta;

    INSERT INTO public.ventas_tienda (
        hotel_id, producto_id, cantidad, precio_unitario_venta, total_venta, 
        metodo_pago_id, usuario_id, fecha
    ) VALUES (
        p_hotel_id, p_producto_id, p_cantidad_vendida, p_precio_unitario_venta, v_total_venta,
        p_metodo_pago_id, p_usuario_id, NOW()
    ) RETURNING id INTO v_venta_id;

    v_nuevo_stock := v_stock_actual - p_cantidad_vendida;
    UPDATE public.productos_tienda SET stock = v_nuevo_stock, actualizado_en = NOW()
    WHERE id = p_producto_id AND hotel_id = p_hotel_id;

    v_concepto_caja := 'Venta Tienda: ' || p_cantidad_vendida || ' x ' || v_nombre_producto;
    INSERT INTO public.caja (
        hotel_id, usuario_id, tipo, concepto, monto, metodo_pago_id, venta_tienda_id
    ) VALUES (
        p_hotel_id, p_usuario_id, 'ingreso', v_concepto_caja, v_total_venta, p_metodo_pago_id, v_venta_id
    );

    RETURN json_build_object('success', TRUE, 'message', 'Venta de tienda procesada.', 'venta_id', v_venta_id, 'nuevo_stock', v_nuevo_stock);
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '[VENTA_TIENDA] Error: % - %', SQLSTATE, SQLERRM;
        RETURN json_build_object('error', TRUE, 'message', 'Error interno al procesar venta de tienda: ' || SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.recibir_articulo_devuelto(p_item_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE public.inventario_prestables
  SET stock_disponible = stock_disponible + 1
  WHERE id = p_item_id
  AND stock_disponible < stock_total; -- Seguridad para no superar el total
END;
$function$;

CREATE OR REPLACE FUNCTION public.recibir_lote_de_lavanderia(item_id_param uuid, cantidad_param integer)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE public.inventario_lenceria SET 
    stock_limpio_almacen = stock_limpio_almacen + cantidad_param,
    stock_en_lavanderia = stock_en_lavanderia - cantidad_param
  WHERE id = item_id_param AND stock_en_lavanderia >= cantidad_param;
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_reserva_completa(p_cliente_nombre text, p_habitacion_id uuid, p_tiempo_estancia_id uuid, p_fecha_inicio_str text, p_monto_total_reserva numeric, p_monto_pagado_inicial numeric, p_metodo_pago_id uuid, p_hotel_id uuid, p_usuario_id_registro uuid, p_notas text DEFAULT NULL::text, p_estado_reserva estado_reserva_enum DEFAULT 'activa'::estado_reserva_enum)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$DECLARE
    v_minutos_estancia INT;
    v_fecha_inicio_ts TIMESTAMPTZ;
    v_fecha_fin_ts TIMESTAMPTZ;
    v_reserva_id UUID;
    v_habitacion_estado estado_habitacion_enum;
    v_habitacion_nombre TEXT;
BEGIN
    -- Esta parte de validación inicial está perfecta y no necesita cambios.
    SELECT nombre, estado INTO v_habitacion_nombre, v_habitacion_estado FROM public.habitaciones
    WHERE id = p_habitacion_id AND hotel_id = p_hotel_id AND activo = TRUE;

    IF NOT FOUND THEN
        RETURN json_build_object('error', TRUE, 'message', 'Habitación no encontrada, inactiva o no pertenece al hotel.');
    END IF;
    IF v_habitacion_estado != 'libre' THEN
        RETURN json_build_object('error', TRUE, 'message', 'La habitación (' || v_habitacion_nombre || ') no está libre. Estado actual: ' || v_habitacion_estado);
    END IF;

    SELECT minutos INTO v_minutos_estancia FROM public.tiempos_estancia WHERE id = p_tiempo_estancia_id AND activo = TRUE;
    IF NOT FOUND THEN
        RETURN json_build_object('error', TRUE, 'message', 'Tiempo de estancia seleccionado no es válido o está inactivo.');
    END IF;

    BEGIN
        v_fecha_inicio_ts := p_fecha_inicio_str::timestamptz;
    EXCEPTION WHEN others THEN
        RETURN json_build_object('error', TRUE, 'message', 'Formato de fecha de inicio inválido. Usar formato ISO 8601 (YYYY-MM-DDTHH:MM:SSZ).');
    END;
    v_fecha_fin_ts := v_fecha_inicio_ts + (v_minutos_estancia * interval '1 minute');

    -- Insertamos la reserva (esto no cambia)
    INSERT INTO public.reservas (
        cliente_nombre, habitacion_id, tiempo_estancia_id, fecha_inicio, fecha_fin,
        monto_total, metodo_pago_id, estado, hotel_id, usuario_id, notas
    ) VALUES (
        p_cliente_nombre, p_habitacion_id, p_tiempo_estancia_id, v_fecha_inicio_ts, v_fecha_fin_ts,
        p_monto_total_reserva, p_metodo_pago_id, p_estado_reserva, p_hotel_id, p_usuario_id_registro, p_notas
    ) RETURNING id INTO v_reserva_id;

    -- ==================== INICIO DE LA CORRECCIÓN ====================
    -- AÑADIMOS UNA CONDICIÓN PARA VERIFICAR SI LA RESERVA ES INMEDIATA
    IF p_estado_reserva = 'activa' THEN
        -- Si la reserva es 'activa', entonces sí actualizamos la habitación a 'ocupada'
        UPDATE public.habitaciones SET estado = 'ocupada', actualizado_en = NOW()
        WHERE id = p_habitacion_id AND hotel_id = p_hotel_id;

        -- Y creamos el cronómetro correspondiente
        INSERT INTO public.cronometros (reserva_id, habitacion_id, fecha_inicio, fecha_fin, activo, hotel_id)
        VALUES (v_reserva_id, p_habitacion_id, v_fecha_inicio_ts, v_fecha_fin_ts, TRUE, p_hotel_id);
    END IF;
    -- SI LA RESERVA ES 'reservada' (futura), NO HACEMOS NADA. LA HABITACIÓN QUEDA 'libre'.
    -- ===================== FIN DE LA CORRECCIÓN ======================

    -- El registro de pago sigue igual
    IF p_monto_pagado_inicial > 0 THEN
        INSERT INTO public.pagos_reserva (reserva_id, monto, fecha_pago, metodo_pago_id, hotel_id, usuario_id)
        VALUES (v_reserva_id, p_monto_pagado_inicial, NOW(), p_metodo_pago_id, p_hotel_id, p_usuario_id_registro);
    END IF;

    RETURN json_build_object('success', TRUE, 'message', 'Reserva registrada y procesada exitosamente.', 'reserva_id', v_reserva_id);
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '[REGISTRAR_RESERVA] Error: % - %', SQLSTATE, SQLERRM;
        RETURN json_build_object('error', TRUE, 'message', 'Error interno del servidor al procesar la reserva: ' || SQLERRM);
END;$function$;

CREATE OR REPLACE FUNCTION public.registrar_reserva_webhook(p_habitacion_id uuid, p_fecha_inicio date, p_fecha_fin date, p_usuario_id uuid, p_cliente_nombre text, p_monto_total numeric, p_estado text)
 RETURNS TABLE(reserva_id uuid, mensaje text)
 LANGUAGE plpgsql
AS $function$
DECLARE
    nueva_reserva_id uuid;
BEGIN
    INSERT INTO reservas (
        id,
        hotel_id,
        habitacion_id,
        cliente_nombre,
        fecha_inicio,
        fecha_fin,
        monto_total,
        estado,
        usuario_id,
        cantidad_huespedes,
        creado_en
    ) VALUES (
        gen_random_uuid(),
        (SELECT hotel_id FROM habitaciones WHERE id = p_habitacion_id),
        p_habitacion_id,
        p_cliente_nombre,
        p_fecha_inicio,
        p_fecha_fin,
        p_monto_total,
        p_estado,
        p_usuario_id,
        1,
        now()
    )
    RETURNING id INTO nueva_reserva_id;

    RETURN QUERY SELECT nueva_reserva_id, 'Reserva creada exitosamente';
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_reserva_webhook(p_habitacion_id uuid, p_fecha_inicio date, p_fecha_fin date, p_usuario_id uuid, p_cliente_nombre text, p_monto_total numeric, p_estado text, p_cantidad_huespedes integer)
 RETURNS TABLE(reserva_id uuid, mensaje text)
 LANGUAGE plpgsql
AS $function$
DECLARE
    nueva_reserva_id uuid;
BEGIN
    INSERT INTO reservas (
        id,
        hotel_id,
        habitacion_id,
        cliente_nombre,
        fecha_inicio,
        fecha_fin,
        monto_total,
        estado,
        usuario_id,
        cantidad_huespedes,
        creado_en
    ) VALUES (
        gen_random_uuid(),
        (SELECT hotel_id FROM habitaciones WHERE id = p_habitacion_id),
        p_habitacion_id,
        p_cliente_nombre,
        p_fecha_inicio,
        p_fecha_fin,
        p_monto_total,
        CAST(p_estado AS estado_reserva_enum),  -- <--- ESTA LÍNEA ES LA CLAVE
        p_usuario_id,
        p_cantidad_huespedes,
        now()
    )
    RETURNING id INTO nueva_reserva_id;

    RETURN QUERY SELECT nueva_reserva_id, 'Reserva creada exitosamente';
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_y_eliminar_mov_caja(movimiento_id_param uuid, eliminado_por_usuario_id_param uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    movimiento_a_eliminar public.caja;
BEGIN
    SELECT * INTO movimiento_a_eliminar
    FROM public.caja
    WHERE id = movimiento_id_param;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Movimiento de caja con id % no encontrado.', movimiento_id_param;
    END IF;

    INSERT INTO public.log_caja_eliminados (
        movimiento_id_eliminado,
        datos_eliminados,
        eliminado_por_usuario_id,
        hotel_id
    )
    VALUES (
        movimiento_a_eliminar.id,
        row_to_json(movimiento_a_eliminar)::jsonb,
        eliminado_por_usuario_id_param,
        movimiento_a_eliminar.hotel_id
    );

    DELETE FROM public.caja
    WHERE id = movimiento_id_param;

END;
$function$;

CREATE OR REPLACE FUNCTION public.reportar_articulo_perdido(p_item_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE public.inventario_prestables
  SET 
    stock_total = stock_total - 1 -- Se descuenta del inventario total
    -- No tocamos el stock_disponible porque ya estaba "fuera" (prestado)
  WHERE id = p_item_id
  AND stock_total > 0;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reportar_perdida_lenceria(item_id_param uuid, cantidad_param integer)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE public.inventario_lenceria SET 
    stock_total = stock_total - cantidad_param,
    stock_limpio_almacen = stock_limpio_almacen - cantidad_param
  WHERE id = item_id_param AND stock_limpio_almacen >= cantidad_param;
END;
$function$;

CREATE OR REPLACE FUNCTION public.restar_stock_amenidad(item_id_param uuid, cantidad_param integer)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE public.amenidades_inventario
  SET stock_actual = stock_actual - cantidad_param
  WHERE id = item_id_param;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_reserva_hotel()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.hotel_id := (SELECT hotel_id FROM habitaciones WHERE id = NEW.habitacion_id);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_reserva_hotel_id_from_habitacion()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.habitacion_id IS NOT NULL THEN
    NEW.hotel_id := (SELECT hotel_id FROM public.habitaciones WHERE id = NEW.habitacion_id);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.actualizado_en = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_user_metadata_from_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  -- Actualiza la columna raw_user_meta_data en la tabla auth.users
  -- COALESCE se usa para manejar el caso en que raw_user_meta_data sea NULL inicialmente.
  -- El operador '||' concatena (fusiona) objetos JSONB.
  -- Los campos que se sincronizan son 'nombre_completo', 'rol', y 'hotel_id'.
  -- Asegúrate de que las columnas NEW.nombre, NEW.rol, y NEW.hotel_id existan en tu tabla public.usuarios.
  UPDATE auth.users
  SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
    'nombre_completo', NEW.nombre,       -- Tomado de la columna 'nombre' en public.usuarios
    'rol', NEW.rol,                   -- Tomado de la columna 'rol' en public.usuarios
    'hotel_id', NEW.hotel_id          -- Tomado de la columna 'hotel_id' en public.usuarios
    -- Puedes añadir más campos aquí si los necesitas en user_metadata
    -- Ejemplo: 'telefono_contacto', NEW.telefono_contacto
  )
  WHERE id = NEW.id; -- El 'id' aquí es el id del usuario en auth.users, que debe coincidir con el id en public.usuarios

  RETURN NEW; -- Devuelve la fila modificada (requerido para triggers AFTER)
END;
$function$;

CREATE OR REPLACE FUNCTION public.trigger_set_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.actualizado_en = NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trigger_set_timestamp_actualizado_en()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.actualizado_en = NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validar_cruce_reserva(p_habitacion_id uuid, p_entrada timestamp with time zone, p_salida timestamp with time zone, p_reserva_id_excluida uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM public.reservas r
    WHERE r.habitacion_id = p_habitacion_id
      AND r.estado IN (
          'reservada'::public.estado_reserva_enum,
          'confirmada'::public.estado_reserva_enum,
          'activa'::public.estado_reserva_enum,
          'check_in'::public.estado_reserva_enum,
          'pendiente'::public.estado_reserva_enum,
          'ocupada'::public.estado_reserva_enum
      )
      AND (p_reserva_id_excluida IS NULL OR r.id <> p_reserva_id_excluida)
      AND tstzrange(r.fecha_inicio, r.fecha_fin, '[)') && tstzrange(p_entrada, p_salida, '[)');

    RETURN v_count > 0;
END;
$function$;

ALTER TABLE "public"."turnos" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Los usuarios pueden abrir sus propios turnos" ON "public"."turnos"
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((uid() = usuario_id));
CREATE POLICY "Los usuarios pueden cerrar sus propios turnos" ON "public"."turnos"
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (((get_my_claim('user_role'::text) = 'admin'::text) OR (uid() = usuario_id)));
CREATE POLICY "Los usuarios pueden ver sus propios turnos" ON "public"."turnos"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((uid() = usuario_id));
CREATE POLICY "Permitir lectura de turnos al personal del hotel" ON "public"."turnos"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM usuarios u
  WHERE ((u.id = uid()) AND (u.hotel_id = turnos.hotel_id) AND ((u.rol = 'admin'::text) OR (turnos.usuario_id = uid()))))));
CREATE POLICY "Permitir lectura de turnos del hotel" ON "public"."turnos"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM usuarios u
  WHERE ((u.id = uid()) AND (u.hotel_id = turnos.hotel_id)))));

ALTER TABLE "public"."servicios_adicionales" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow inserts for authenticated" ON "public"."servicios_adicionales"
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((role() = 'authenticated'::text));
CREATE POLICY "Allow select for authenticated" ON "public"."servicios_adicionales"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((role() = 'authenticated'::text));
CREATE POLICY "ServiciosAdicionales_AccesoHotel" ON "public"."servicios_adicionales"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (((hotel_id = get_current_user_hotel_id_from_profile()) OR (get_current_user_rol_from_profile() = 'superadmin'::rol_usuario_enum)));

ALTER TABLE "public"."tipos_servicio" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow inserts for authenticated" ON "public"."tipos_servicio"
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((role() = 'authenticated'::text));
CREATE POLICY "Allow select for authenticated" ON "public"."tipos_servicio"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((role() = 'authenticated'::text));

ALTER TABLE "public"."categorias_producto" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "CategoriasProducto_AccesoHotel" ON "public"."categorias_producto"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (((hotel_id = get_current_user_hotel_id_from_profile()) OR (get_current_user_rol_from_profile() = 'superadmin'::rol_usuario_enum)));
CREATE POLICY "Permitir DELETE en categorías" ON "public"."categorias_producto"
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING (true);
CREATE POLICY "Permitir INSERT en categorías" ON "public"."categorias_producto"
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (true);
CREATE POLICY "Permitir SELECT en categorías" ON "public"."categorias_producto"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
CREATE POLICY "Permitir UPDATE en categorías" ON "public"."categorias_producto"
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (true);
CREATE POLICY "Permitir insertar categorias a usuarios autenticados" ON "public"."categorias_producto"
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((uid() IS NOT NULL));

ALTER TABLE "public"."detalle_ventas_tienda" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "DetalleVentasTienda_AccesoHotel" ON "public"."detalle_ventas_tienda"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (((hotel_id = get_current_user_hotel_id_from_profile()) OR (get_current_user_rol_from_profile() = 'superadmin'::rol_usuario_enum)));
CREATE POLICY "Permitir DELETE en detalle_ventas_tienda" ON "public"."detalle_ventas_tienda"
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING (true);
CREATE POLICY "Permitir INSERT en detalle_ventas_tienda" ON "public"."detalle_ventas_tienda"
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (true);
CREATE POLICY "Permitir SELECT en detalle_ventas_tienda" ON "public"."detalle_ventas_tienda"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
CREATE POLICY "Permitir UPDATE en detalle_ventas_tienda" ON "public"."detalle_ventas_tienda"
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (true);

ALTER TABLE "public"."integraciones_hotel" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow insert for hotel integrations" ON "public"."integraciones_hotel"
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((uid() IS NOT NULL));
CREATE POLICY "Allow select for hotel integrations" ON "public"."integraciones_hotel"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((uid() IS NOT NULL));
CREATE POLICY "Allow update for hotel integrations" ON "public"."integraciones_hotel"
  AS PERMISSIVE
  FOR UPDATE
  TO public
  WITH CHECK ((uid() IS NOT NULL));
CREATE POLICY "Delete own hotel integrations only" ON "public"."integraciones_hotel"
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((EXISTS ( SELECT 1
   FROM usuarios u
  WHERE ((u.id = uid()) AND (u.hotel_id = integraciones_hotel.hotel_id)))));
CREATE POLICY "Insert own hotel integrations only" ON "public"."integraciones_hotel"
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM usuarios u
  WHERE ((u.id = uid()) AND (u.hotel_id = integraciones_hotel.hotel_id)))));
CREATE POLICY "Select own hotel integrations only" ON "public"."integraciones_hotel"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM usuarios u
  WHERE ((u.id = uid()) AND (u.hotel_id = integraciones_hotel.hotel_id)))));
CREATE POLICY "Update own hotel integrations only" ON "public"."integraciones_hotel"
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((EXISTS ( SELECT 1
   FROM usuarios u
  WHERE ((u.id = uid()) AND (u.hotel_id = integraciones_hotel.hotel_id)))));

ALTER TABLE "public"."proveedores" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir DELETE a todos" ON "public"."proveedores"
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING (true);
CREATE POLICY "Permitir DELETE en proveedores" ON "public"."proveedores"
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING (true);
CREATE POLICY "Permitir INSERT a todos" ON "public"."proveedores"
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (true);
CREATE POLICY "Permitir INSERT en proveedores" ON "public"."proveedores"
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (true);
CREATE POLICY "Permitir SELECT a todos" ON "public"."proveedores"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
CREATE POLICY "Permitir SELECT en proveedores" ON "public"."proveedores"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
CREATE POLICY "Permitir UPDATE a todos" ON "public"."proveedores"
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (true);
CREATE POLICY "Permitir UPDATE en proveedores" ON "public"."proveedores"
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (true);
CREATE POLICY "Proveedores_AccesoHotel" ON "public"."proveedores"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (((hotel_id = get_current_user_hotel_id_from_profile()) OR (get_current_user_rol_from_profile() = 'superadmin'::rol_usuario_enum)));

ALTER TABLE "public"."reservas" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Reservas_hotel" ON "public"."reservas"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((hotel_id = get_current_user_hotel_id()));

ALTER TABLE "public"."descuentos" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Los usuarios pueden actualizar los descuentos de su hotel" ON "public"."descuentos"
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((hotel_id = ( SELECT usuarios.hotel_id
   FROM usuarios
  WHERE (usuarios.id = uid()))));
CREATE POLICY "Los usuarios pueden crear descuentos para su hotel" ON "public"."descuentos"
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((hotel_id = ( SELECT usuarios.hotel_id
   FROM usuarios
  WHERE (usuarios.id = uid()))));
CREATE POLICY "Los usuarios pueden eliminar los descuentos de su hotel" ON "public"."descuentos"
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((hotel_id = ( SELECT usuarios.hotel_id
   FROM usuarios
  WHERE (usuarios.id = uid()))));
CREATE POLICY "Los usuarios pueden ver los descuentos de su hotel" ON "public"."descuentos"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((hotel_id = ( SELECT usuarios.hotel_id
   FROM usuarios
  WHERE (usuarios.id = uid()))));

ALTER TABLE "public"."movimientos_inventario" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir inserción a usuarios autenticados" ON "public"."movimientos_inventario"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
CREATE POLICY "Permitir lectura a usuarios autenticados" ON "public"."movimientos_inventario"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Permitir a usuarios ver turnos de su propio hotel" ON "public"."turnos_programados"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((hotel_id = ( SELECT usuarios.hotel_id
   FROM usuarios
  WHERE (usuarios.id = uid()))));

ALTER TABLE "public"."metodos_pago" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "MetodosPago: Acceso para usuarios del mismo hotel" ON "public"."metodos_pago"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((hotel_id = get_current_user_hotel_id()));

ALTER TABLE "public"."cronometros" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Cronometros_hotel" ON "public"."cronometros"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((hotel_id = get_current_user_hotel_id()));
CREATE POLICY "Permitir lectura de cronometros" ON "public"."cronometros"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((activo = true));

ALTER TABLE "public"."integraciones" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Integraciones_admin_hotel" ON "public"."integraciones"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (((hotel_id = get_current_user_hotel_id()) AND (get_current_user_rol() = ANY (ARRAY['admin'::rol_usuario_enum, 'superadmin'::rol_usuario_enum]))))
  WITH CHECK (((hotel_id = get_current_user_hotel_id()) AND (get_current_user_rol() = ANY (ARRAY['admin'::rol_usuario_enum, 'superadmin'::rol_usuario_enum]))));

ALTER TABLE "public"."habitacion_tiempos_permitidos" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "HabitacionTiemposPermitidos_hotel" ON "public"."habitacion_tiempos_permitidos"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((hotel_id = get_current_user_hotel_id()));

ALTER TABLE "public"."caja" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Caja_hotel" ON "public"."caja"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((hotel_id = get_current_user_hotel_id()));

ALTER TABLE "public"."tareas_mantenimiento" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "TareasMantenimiento_hotel" ON "public"."tareas_mantenimiento"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((hotel_id = get_current_user_hotel_id()));

ALTER TABLE "public"."pagos_reserva" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Usuarios pueden actualizar los pagos de su hotel" ON "public"."pagos_reserva"
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((hotel_id = get_my_hotel_id()));
CREATE POLICY "Usuarios pueden crear pagos para su hotel" ON "public"."pagos_reserva"
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((hotel_id = get_my_hotel_id()));
CREATE POLICY "Usuarios pueden eliminar los pagos de su hotel" ON "public"."pagos_reserva"
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((hotel_id = get_my_hotel_id()));
CREATE POLICY "Usuarios pueden ver los pagos de su hotel" ON "public"."pagos_reserva"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((hotel_id = get_my_hotel_id()));

ALTER TABLE "public"."hoteles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow insert for anonymous" ON "public"."hoteles"
  AS PERMISSIVE
  FOR INSERT
  TO anon
  WITH CHECK (true);
CREATE POLICY "Allow insert for authenticated" ON "public"."hoteles"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
CREATE POLICY "Allow insert for onboarding" ON "public"."hoteles"
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
CREATE POLICY "Hoteles: Admins pueden actualizar su hotel, Superadmins cualqui" ON "public"."hoteles"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (((get_current_user_rol() = 'superadmin'::rol_usuario_enum) OR ((get_current_user_rol() = 'admin'::rol_usuario_enum) AND (id = get_current_user_hotel_id()))))
  WITH CHECK (((get_current_user_rol() = 'superadmin'::rol_usuario_enum) OR ((get_current_user_rol() = 'admin'::rol_usuario_enum) AND (id = get_current_user_hotel_id()))));
CREATE POLICY "Hoteles: Admins pueden eliminar su hotel, Superadmins cualquier" ON "public"."hoteles"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (((get_current_user_rol() = 'superadmin'::rol_usuario_enum) OR ((get_current_user_rol() = 'admin'::rol_usuario_enum) AND (id = get_current_user_hotel_id()))));
CREATE POLICY "Hoteles: Lectura pública" ON "public"."hoteles"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
CREATE POLICY "Hoteles: Superadmin puede gestionar, usuarios autenticados pued" ON "public"."hoteles"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (((role() = 'authenticated'::text) AND ((get_current_user_rol() = 'superadmin'::rol_usuario_enum) OR (id = get_current_user_hotel_id()))))
  WITH CHECK (((role() = 'authenticated'::text) AND (get_current_user_rol() = 'superadmin'::rol_usuario_enum)));
CREATE POLICY "Hoteles: Superadmins pueden crear nuevos hoteles" ON "public"."hoteles"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((get_current_user_rol() = 'superadmin'::rol_usuario_enum));
CREATE POLICY "Hoteles: Usuarios autenticados pueden leer información de hote" ON "public"."hoteles"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY "Hoteles_lectura_autenticados_gestion_admins" ON "public"."hoteles"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (((get_current_user_rol_from_profile() = 'superadmin'::rol_usuario_enum) OR ((get_current_user_rol_from_profile() = 'admin'::rol_usuario_enum) AND (id = get_current_user_hotel_id_from_profile()))))
  WITH CHECK (((get_current_user_rol_from_profile() = 'superadmin'::rol_usuario_enum) OR ((get_current_user_rol_from_profile() = 'admin'::rol_usuario_enum) AND (id = get_current_user_hotel_id_from_profile()))));
CREATE POLICY "Hoteles_lectura_publica_general" ON "public"."hoteles"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
CREATE POLICY "Solo el creador o admin/superadmin puede editar hotel" ON "public"."hoteles"
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (((uid() = creado_por) OR (EXISTS ( SELECT 1
   FROM usuarios
  WHERE ((usuarios.id = uid()) AND ((usuarios.rol = 'admin'::text) OR (usuarios.rol = 'superadmin'::text)))))));
CREATE POLICY "Solo el creador puede cambiar el plan" ON "public"."hoteles"
  AS PERMISSIVE
  FOR UPDATE
  TO public
  WITH CHECK (((uid() = creado_por) OR (EXISTS ( SELECT 1
   FROM usuarios
  WHERE ((usuarios.id = uid()) AND ((usuarios.rol = 'admin'::text) OR (usuarios.rol = 'superadmin'::text)))))));

CREATE POLICY "TiemposEstancia_AccesoDeleteHotel" ON "public"."tiempos_estancia"
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING (((hotel_id = get_current_user_hotel_id_from_profile()) OR (get_current_user_rol_from_profile() = 'superadmin'::rol_usuario_enum)));
CREATE POLICY "TiemposEstancia_AccesoLecturaHotel" ON "public"."tiempos_estancia"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((hotel_id = get_current_user_hotel_id_from_profile()) OR (get_current_user_rol_from_profile() = 'superadmin'::rol_usuario_enum)));
CREATE POLICY "TiemposEstancia_AccesoUpdateHotel" ON "public"."tiempos_estancia"
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (((hotel_id = get_current_user_hotel_id_from_profile()) OR (get_current_user_rol_from_profile() = 'superadmin'::rol_usuario_enum)))
  WITH CHECK (((hotel_id = get_current_user_hotel_id_from_profile()) OR (get_current_user_rol_from_profile() = 'superadmin'::rol_usuario_enum)));
CREATE POLICY "allow_insert_tiempos_estancia" ON "public"."tiempos_estancia"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((hotel_id = get_current_user_hotel_id_from_profile()));
CREATE POLICY "allow_insert_tiempos_estancia_authenticated" ON "public"."tiempos_estancia"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((hotel_id = get_current_user_hotel_id_from_profile()));

ALTER TABLE "public"."ventas_tienda" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir DELETE en ventas_tienda" ON "public"."ventas_tienda"
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING (true);
CREATE POLICY "Permitir INSERT en ventas_tienda" ON "public"."ventas_tienda"
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (true);
CREATE POLICY "Permitir SELECT en ventas_tienda" ON "public"."ventas_tienda"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
CREATE POLICY "Permitir UPDATE en ventas_tienda" ON "public"."ventas_tienda"
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (true);
CREATE POLICY "VentasTienda_AccesoHotel" ON "public"."ventas_tienda"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (((hotel_id = get_current_user_hotel_id_from_profile()) OR (get_current_user_rol_from_profile() = 'superadmin'::rol_usuario_enum)));
CREATE POLICY "VentasTienda_hotel" ON "public"."ventas_tienda"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((hotel_id = get_current_user_hotel_id()));

ALTER TABLE "public"."notificaciones" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Los usuarios pueden marcar como leídas sus notificaciones" ON "public"."notificaciones"
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (((uid() = usuario_id) OR ((usuario_id IS NULL) AND ((get_my_role())::rol_usuario_enum = rol_destino))));
CREATE POLICY "Notificaciones_usuario_y_rol_hotel" ON "public"."notificaciones"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (((hotel_id = get_current_user_hotel_id_from_profile()) AND ((usuario_id = uid()) OR ((usuario_id IS NULL) AND (rol_destino = get_current_user_rol_from_profile())) OR (get_current_user_rol_from_profile() = ANY (ARRAY['admin'::rol_usuario_enum, 'superadmin'::rol_usuario_enum])))));
CREATE POLICY "Permitir a usuarios actualizar sus propias notificaciones" ON "public"."notificaciones"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((((hotel_id)::text = ((jwt() -> 'app_metadata'::text) ->> 'hotel_id'::text)) AND (((user_id IS NULL) AND ((rol_destino)::text = ((jwt() -> 'app_metadata'::text) ->> 'rol'::text))) OR (user_id = uid()))))
  WITH CHECK ((((hotel_id)::text = ((jwt() -> 'app_metadata'::text) ->> 'hotel_id'::text)) AND (((user_id IS NULL) AND ((rol_destino)::text = ((jwt() -> 'app_metadata'::text) ->> 'rol'::text))) OR (user_id = uid()))));
CREATE POLICY "Permitir inserts a notificaciones a usuarios autenticados" ON "public"."notificaciones"
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((uid() IS NOT NULL));
CREATE POLICY "Permitir lectura de notificaciones propias o por rol" ON "public"."notificaciones"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((((hotel_id)::text = ((jwt() -> 'app_metadata'::text) ->> 'hotel_id'::text)) AND (((user_id IS NULL) AND ((rol_destino)::text = ((jwt() -> 'app_metadata'::text) ->> 'rol'::text))) OR (user_id = uid()))));
CREATE POLICY "Permitir ver notificaciones propias o por rol" ON "public"."notificaciones"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((uid() = usuario_id) OR ((get_my_role())::rol_usuario_enum = rol_destino)));

ALTER TABLE "public"."servicios_x_reserva" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir inserción de servicios del hotel al personal del hote" ON "public"."servicios_x_reserva"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM usuarios u
  WHERE ((u.id = uid()) AND (u.hotel_id = servicios_x_reserva.hotel_id)))));
CREATE POLICY "Permitir lectura de servicios del hotel al personal del hotel" ON "public"."servicios_x_reserva"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM usuarios u
  WHERE ((u.id = uid()) AND (u.hotel_id = servicios_x_reserva.hotel_id)))));

CREATE POLICY "Allow insert for onboarding" ON "public"."usuarios_roles"
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
CREATE POLICY "admin_full_access" ON "public"."usuarios_roles"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);

ALTER TABLE "public"."productos_tienda" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir DELETE en productos_tienda" ON "public"."productos_tienda"
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING (true);
CREATE POLICY "Permitir INSERT en productos_tienda" ON "public"."productos_tienda"
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (true);
CREATE POLICY "Permitir SELECT en productos_tienda" ON "public"."productos_tienda"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
CREATE POLICY "Permitir UPDATE en productos_tienda" ON "public"."productos_tienda"
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (true);
CREATE POLICY "ProductosTienda_AccesoHotel" ON "public"."productos_tienda"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (((hotel_id = get_current_user_hotel_id_from_profile()) OR (get_current_user_rol_from_profile() = 'superadmin'::rol_usuario_enum)));
CREATE POLICY "ProductosTienda_LecturaRecepcionistas" ON "public"."productos_tienda"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((hotel_id = get_current_user_hotel_id_from_profile()) AND (activo = true) AND (get_current_user_rol_from_profile() = ANY (ARRAY['recepcionista'::rol_usuario_enum, 'admin'::rol_usuario_enum, 'superadmin'::rol_usuario_enum]))));
CREATE POLICY "ProductosTienda_hotel" ON "public"."productos_tienda"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((hotel_id = get_current_user_hotel_id()));

ALTER TABLE "public"."detalle_compras_tienda" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable insert for hotel users" ON "public"."detalle_compras_tienda"
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (((( SELECT role() AS role) = 'authenticated'::text) AND (hotel_id = get_current_hotel_id())));
CREATE POLICY "Enable read access for hotel users" ON "public"."detalle_compras_tienda"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((( SELECT role() AS role) = 'authenticated'::text) AND (hotel_id = get_current_hotel_id())));
CREATE POLICY "Permitir gestion total a usuarios del hotel" ON "public"."detalle_compras_tienda"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((hotel_id = ((jwt() ->> 'hotel_id'::text))::uuid))
  WITH CHECK ((hotel_id = ((jwt() ->> 'hotel_id'::text))::uuid));

ALTER TABLE "public"."compras_tienda" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir acceso total a usuarios del mismo hotel" ON "public"."compras_tienda"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((uid() IN ( SELECT u.id
   FROM usuarios u
  WHERE (u.hotel_id = compras_tienda.hotel_id))))
  WITH CHECK ((uid() IN ( SELECT u.id
   FROM usuarios u
  WHERE (u.hotel_id = compras_tienda.hotel_id))));
CREATE POLICY "Permitir gestion total a usuarios del hotel" ON "public"."compras_tienda"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((hotel_id = ((jwt() ->> 'hotel_id'::text))::uuid))
  WITH CHECK ((hotel_id = ((jwt() ->> 'hotel_id'::text))::uuid));

ALTER TABLE "public"."oauth_tokens" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Denegar acceso público" ON "public"."oauth_tokens"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false);
CREATE POLICY "Only service_role can access" ON "public"."oauth_tokens"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((role() = 'service_role'::text));

ALTER TABLE "public"."configuracion_hotel" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow insert for onboarding" ON "public"."configuracion_hotel"
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
CREATE POLICY "Allow read to anon" ON "public"."configuracion_hotel"
  AS PERMISSIVE
  FOR SELECT
  TO anon
  USING (true);
CREATE POLICY "Allow read to authenticated" ON "public"."configuracion_hotel"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY "Permitir CRUD por hotel_id" ON "public"."configuracion_hotel"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (((hotel_id = uid()) OR (role() = 'service_role'::text)));
CREATE POLICY "Permitir a usuarios del hotel editar config" ON "public"."configuracion_hotel"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((((hotel_id)::text = (jwt() ->> 'hotel_id'::text)) OR (role() = 'service_role'::text)));
CREATE POLICY "Permitir operaciones por hotel_id JWT" ON "public"."configuracion_hotel"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((((hotel_id)::text = (jwt() ->> 'hotel_id'::text)) OR (role() = 'service_role'::text)));
CREATE POLICY "Usuarios del hotel pueden editar configuracion" ON "public"."configuracion_hotel"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((((hotel_id)::text = (jwt() ->> 'hotel_id'::text)) OR (role() = 'service_role'::text)));
CREATE POLICY "Usuarios pueden editar configuración de su hotel" ON "public"."configuracion_hotel"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((EXISTS ( SELECT 1
   FROM usuarios
  WHERE ((usuarios.id = uid()) AND (usuarios.hotel_id = configuracion_hotel.hotel_id)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM usuarios
  WHERE ((usuarios.id = uid()) AND (usuarios.hotel_id = configuracion_hotel.hotel_id)))));

ALTER TABLE "public"."usuarios" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow insert for onboarding" ON "public"."usuarios"
  AS PERMISSIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
CREATE POLICY "admin_full_access" ON "public"."usuarios"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
CREATE POLICY "only_admin_can_delete_users" ON "public"."usuarios"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (usuarios_roles ur
     JOIN roles r ON ((ur.rol_id = r.id)))
  WHERE ((ur.usuario_id = uid()) AND (r.nombre = 'Administrador'::text) AND (ur.hotel_id = ur.hotel_id)))));
CREATE POLICY "only_admin_can_insert_users" ON "public"."usuarios"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (usuarios_roles ur
     JOIN roles r ON ((ur.rol_id = r.id)))
  WHERE ((ur.usuario_id = uid()) AND (r.nombre = 'Administrador'::text) AND (ur.hotel_id = ur.hotel_id)))));
CREATE POLICY "only_admin_can_update_users" ON "public"."usuarios"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (usuarios_roles ur
     JOIN roles r ON ((ur.rol_id = r.id)))
  WHERE ((ur.usuario_id = uid()) AND (r.nombre = 'Administrador'::text) AND (ur.hotel_id = ur.hotel_id)))));
CREATE POLICY "same_hotel_can_select_users" ON "public"."usuarios"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((hotel_id IN ( SELECT ur.hotel_id
   FROM usuarios_roles ur
  WHERE (ur.usuario_id = uid()))));
CREATE POLICY "user_can_select_own_profile" ON "public"."usuarios"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((id = uid()));
CREATE POLICY "user_can_update_own_profile" ON "public"."usuarios"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((id = uid()));

ALTER TABLE "public"."habitaciones" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir acceso a habitaciones del propio hotel" ON "public"."habitaciones"
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((hotel_id = get_my_hotel_id()));
CREATE POLICY "Permitir actualización a usuarios autenticados" ON "public"."habitaciones"
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((uid() IS NOT NULL))
  WITH CHECK ((uid() IS NOT NULL));

CREATE TRIGGER set_timestamp_servicios_adicionales BEFORE UPDATE ON public.servicios_adicionales FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp_actualizado_en();

CREATE TRIGGER set_timestamp_tipos_servicio BEFORE UPDATE ON public.tipos_servicio FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp_actualizado_en();

CREATE TRIGGER set_timestamp_categorias_producto BEFORE UPDATE ON public.categorias_producto FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp_actualizado_en();

CREATE TRIGGER set_timestamp_proveedores BEFORE UPDATE ON public.proveedores FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp_actualizado_en();

CREATE TRIGGER set_reservas_actualizado_en BEFORE UPDATE ON public.reservas FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp_actualizado_en();
CREATE TRIGGER set_timestamp_reservas BEFORE UPDATE ON public.reservas FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp_actualizado_en();

CREATE TRIGGER set_timestamp_planes BEFORE UPDATE ON public.planes FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp_actualizado_en();

CREATE TRIGGER set_timestamp_metodos_pago BEFORE UPDATE ON public.metodos_pago FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp_actualizado_en();

CREATE TRIGGER set_timestamp_cronometros BEFORE UPDATE ON public.cronometros FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp_actualizado_en();

CREATE TRIGGER set_timestamp_integraciones BEFORE UPDATE ON public.integraciones FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp_actualizado_en();

CREATE TRIGGER set_timestamp_caja BEFORE UPDATE ON public.caja FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp_actualizado_en();

CREATE TRIGGER set_timestamp_tareas_mantenimiento BEFORE UPDATE ON public.tareas_mantenimiento FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp_actualizado_en();

CREATE TRIGGER set_timestamp_pagos_reserva BEFORE UPDATE ON public.pagos_reserva FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp_actualizado_en();

CREATE TRIGGER set_timestamp_hoteles BEFORE UPDATE ON public.hoteles FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp_actualizado_en();
CREATE TRIGGER trg_add_configuracion_hotel AFTER INSERT ON public.hoteles FOR EACH ROW EXECUTE FUNCTION after_insert_hotel_add_config();

CREATE TRIGGER set_tiempos_estancia_actualizado_en BEFORE UPDATE ON public.tiempos_estancia FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp_actualizado_en();
CREATE TRIGGER set_timestamp_tiempos_estancia BEFORE UPDATE ON public.tiempos_estancia FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp_actualizado_en();

CREATE TRIGGER set_timestamp_ventas_tienda BEFORE UPDATE ON public.ventas_tienda FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp_actualizado_en();

CREATE TRIGGER set_timestamp_notificaciones BEFORE UPDATE ON public.notificaciones FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp_actualizado_en();

CREATE TRIGGER set_timestamp_productos_tienda BEFORE UPDATE ON public.productos_tienda FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp_actualizado_en();

CREATE TRIGGER set_timestamp_configuracion_hotel BEFORE UPDATE ON public.configuracion_hotel FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp_actualizado_en();

CREATE TRIGGER set_timestamp_usuarios BEFORE UPDATE ON public.usuarios FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp_actualizado_en();
CREATE TRIGGER set_updated_at_trigger BEFORE UPDATE ON public.usuarios FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_auto_configuracion_turno AFTER INSERT ON public.usuarios FOR EACH ROW EXECUTE FUNCTION crear_configuracion_turno_default();

CREATE TRIGGER set_habitaciones_actualizado_en BEFORE UPDATE ON public.habitaciones FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp_actualizado_en();
CREATE TRIGGER set_timestamp_habitaciones BEFORE UPDATE ON public.habitaciones FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp_actualizado_en();

COMMIT;
