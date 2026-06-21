# Gestión de Hotel — Contexto del Proyecto

## Qué es este proyecto
SaaS de administración hotelera para hoteles, moteles y hostales en Latinoamérica.
Operación en producción real desde hace 1 año en 2 establecimientos propios.

## Stack tecnológico
- Frontend: HTML + CSS + Bootstrap + JavaScript vanilla
- Backend: Supabase (Auth + PostgreSQL + Realtime + Storage)
- Pagos: Wompi (integración futura)
- Analytics: Google Tag Manager + dataLayer

## Estructura del proyecto
- /index.html → Landing page
- /login.html → Autenticación
- /dashboard/ → Panel principal post-login
- /modules/ → Módulos (caja, habitaciones, reservas, tienda, etc.)
- /assets/ → CSS, JS, imágenes
- /js/ → Lógica de negocio JavaScript

## Reglas críticas — NO romper
1. Toda consulta a la base de datos pasa por Supabase JS client
2. El sistema de autenticación usa Supabase Auth — no tocar el flujo de login/registro
3. Las políticas RLS de Supabase controlan el acceso por hotel_id — siempre filtrar por hotel_id
4. El trial de 30 días se asigna automáticamente al registro — no alterar esa lógica
5. Los eventos de dataLayer son críticos para marketing — no eliminarlos

## Modelo de datos clave
- hotels: información del establecimiento
- rooms: habitaciones con estado (occupied, free, cleaning, maintenance)
- reservations: reservas por horas o noches
- cash_sessions: turnos de caja
- users: usuarios con roles (admin, receptionist, etc.)

## Prioridad de mejoras
1. Bugs y errores lógicos primero
2. Seguridad (RLS, auth, exposición de datos)
3. Calidad de código
4. Performance

## Comportamiento esperado
- Antes de cambiar cualquier cosa, analiza el impacto en otros módulos
- Si un bug afecta datos de caja o habitaciones, máxima prioridad
- No refactorizar sin antes listar qué se va a cambiar y por qué
- Siempre mantener compatibilidad con Supabase JS v2