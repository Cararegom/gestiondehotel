# Correo bancario para todos los hoteles

Cada hotel configura su propio correo y su llave en **Configuracion > Integraciones > Correo de pagos**. Solo administracion puede conectar o desconectar cuentas. Los recepcionistas reciben los avisos y conservan las opciones operativas de conciliacion.

| Hotel | Etiqueta de Gmail | Llave |
| --- | --- | --- |
| Hotel Marena San Isidro | PAGOS HOTEL MARENA | @hotelok |
| Hotel Corales del Mar | PAGOS HOTEL CORALES | 0090237193 |
| Hotel Dora Smith | PAGOS HOTEL DORA SMITH | Introducir la llave real del hotel |

Los otros hoteles reciben una etiqueta sugerida y deben introducir su llave real antes de conectar el correo. La llave se conserva como texto, incluidos los ceros iniciales. El numero de cuenta no identifica el hotel.

## Gmail: etiqueta y filtro

1. Abre Gmail en un computador con la cuenta que recibe los avisos del banco.
2. En el menu izquierdo, pulsa **Mas > Crear etiqueta**. Para Corales escribe **PAGOS HOTEL CORALES**.
3. Abre las opciones de busqueda. En **De** escribe `alertasynotificaciones@an.notificacionesbancolombia.com`.
4. En **Contiene las palabras**, para Corales escribe `conectado a la llave 0090237193`. Cambia la llave cuando configures otro hotel.
5. Pulsa **Crear filtro**. Selecciona **Aplicar la etiqueta** y elige la etiqueta del hotel. Conserva los avisos en **Recibidos**.
6. En Integraciones introduce la misma etiqueta y la llave, pulsa **Guardar configuracion > Conectar Gmail** y autoriza la cuenta correcta.
7. Revisa el estado de la conexion. Si falta la etiqueta, creala con el nombre exacto y pulsa **Renovar Gmail Watch**.

El filtro organiza el correo. El servidor vuelve a validar el remitente bancario, su autenticacion y la llave antes de guardar un pago.

## Outlook

1. Usa una cuenta de Outlook, Hotmail o Microsoft 365 exclusiva del hotel. El banco debe enviar sus avisos originales directamente a esa cuenta.
2. En Outlook web abre **Configuracion > Correo > Correo no deseado > Remitentes y dominios seguros**. Agrega ambas direcciones y guarda:
   - `alertasynotificaciones@an.notificacionesbancolombia.com`
   - `alertasynotificaciones@ayn.notificacionesbancolombia.com`
3. Conserva los avisos en **Bandeja de entrada**. En **Configuracion > Correo > Reglas** revisa que ninguna regla los elimine o mueva a otra carpeta. No necesitas crear una carpeta especial.
4. En Gestion de Hotel selecciona el hotel correcto y abre **Integraciones > Correo de pagos**. Guarda la llave que aparece en los avisos del banco; para Marena/Hotel OK es `@hotelok`.
5. Pulsa **Conectar Outlook**, inicia sesion con esa cuenta y acepta los permisos de lectura. La aplicacion no solicita permisos para enviar correos ni modificar el buzon.
6. Al regresar se inicia la primera sincronizacion. Pulsa **Probar Outlook** para comprobar que el servidor puede leer la bandeja y **Sincronizar ahora** para revisar los avisos recientes.
7. Comprueba el resultado en **Ver pagos bancarios** y en la campana de notificaciones. Para una prueba completa, espera el siguiente aviso real del banco recibido despues de conectar; normalmente se procesara en la siguiente revision de un minuto.

El proceso funciona en el servidor: puedes cerrar Outlook y Gestion de Hotel. Un estado conectado no reemplaza la prueba de una transferencia real. La primera conexion revisa desde diez minutos antes de conectar; no importa toda la historia del buzon.

Esta conexion utiliza permisos de correo y credenciales cifradas independientes de la conexion de calendario. Si el permiso se revoca, vuelve a conectar Outlook desde Correo de pagos.

### Configuracion de Microsoft para la administracion del sistema

Si Integraciones indica que Microsoft requiere configuracion, completar primero el registro de la aplicacion en Microsoft Entra:

1. Usar una aplicacion que admita cuentas de cualquier organizacion y cuentas personales de Microsoft para poder conectar Outlook.com/Hotmail y Microsoft 365.
2. En **Autenticacion**, registrar la plataforma **Web** y esta direccion de retorno exacta: `https://iikpqpdoslyduecibaij.supabase.co/functions/v1/calendar-oauth-callback`.
3. En **Permisos de API > Microsoft Graph > Permisos delegados**, habilitar `User.Read` y `Mail.Read`. El flujo pide tambien `openid`, `profile`, `email` y `offline_access`. No usar permisos de aplicacion ni `Mail.Send` o `Mail.ReadWrite` para esta conexion.
4. Guardar el identificador de la aplicacion y el valor de su secreto en los secretos del servidor `OUTLOOK_CLIENT_ID` y `OUTLOOK_CLIENT_SECRET`. El calendario utiliza la misma aplicacion registrada; preservar su configuracion y direcciones de retorno existentes.
5. Volver a Integraciones y conectar la cuenta bancaria mediante el boton de Outlook. Si es una cuenta empresarial con consentimiento restringido, su administrador debe autorizar la aplicacion.

Referencias: [registro de aplicaciones Microsoft](https://learn.microsoft.com/en-us/graph/auth-register-app-v2), [permiso Mail.Read](https://learn.microsoft.com/en-us/graph/permissions-reference#mailread), [remitentes seguros en Outlook](https://support.microsoft.com/en-us/outlook/mail/add-recipients-to-the-safe-senders-list-in-outlook).

## Recepcion y arqueo

Los avisos incluyen monto, pagador, fecha, hora y la llave del hotel. Se entregan solo a usuarios activos de administracion o recepcion de ese hotel.

Las transferencias siguen registradas en Caja. En el arqueo se toman automaticamente del reporte y no requieren un conteo manual. Los estados bancarios indican si el pago esta pendiente, verificado o requiere revision. El conteo fisico de efectivo se conserva.
