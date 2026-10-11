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

1. Introduce la llave del hotel y guarda la configuracion.
2. Pulsa **Conectar Outlook** dentro de **Correo de pagos**.
3. Inicia sesion con la cuenta que recibe los avisos y permite leer el correo.
4. Conserva estos avisos en **Bandeja de entrada**; no requiere crear una etiqueta de Gmail. El sistema revisa Outlook cada minuto.
5. Usa **Probar Outlook** o **Sincronizar ahora** para comprobar la conexion.

Esta conexion utiliza permisos de correo y credenciales cifradas independientes de la conexion de calendario. Si el permiso se revoca, vuelve a conectar Outlook desde Correo de pagos.

## Recepcion y arqueo

Los avisos incluyen monto, pagador, fecha, hora y la llave del hotel. Se entregan solo a usuarios activos de administracion o recepcion de ese hotel.

Las transferencias siguen registradas en Caja. En el arqueo se toman automaticamente del reporte y no requieren un conteo manual. Los estados bancarios indican si el pago esta pendiente, verificado o requiere revision. El conteo fisico de efectivo se conserva.
