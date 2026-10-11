# Publicación y verificación de Google

La publicación OAuth y la aprobación de Google son estados distintos. La captura del 11 de octubre de 2026 muestra el proyecto `seraphic-cocoa-394919` en producción para usuarios externos, con 2 de 100 usuarios del límite de permisos sin verificar.

Google rechazó la información de la marca por dos razones: no estaba verificada la propiedad de `https://www.gestiondehotel.com` y la política de privacidad publicada en `/privacidad` tenía contenido insuficiente.

## Páginas y propiedad

- Página principal: `https://www.gestiondehotel.com/`.
- Política de privacidad pública: `https://www.gestiondehotel.com/privacidad`.
- La página no requiere iniciar sesión y explica datos de Gmail, Outlook y calendarios, su uso, acceso, almacenamiento, revocación y solicitudes de eliminación.
- La portada enlaza la política. Las opciones de conectar Gmail y Outlook incluyen información visible sobre el tratamiento de correo y un enlace a la política antes de autorizar.
- La etiqueta `google-site-verification` de Search Console se publica en el `head` de la portada. No debe retirarse después de verificar.

En Search Console, verificar mediante **Etiqueta HTML** la propiedad de prefijo `https://www.gestiondehotel.com/` con la misma cuenta propietaria o editora del proyecto de Google. Si la configuración OAuth utiliza otro dominio o prefijo, verificar también su propiedad.

## Información de la marca

1. En Google Auth Platform, abrir **Información de la marca**.
2. Mantener una página principal pública y el enlace anterior a la política de privacidad.
3. Comprobar el contacto de soporte y el del desarrollador.
4. Después de que Search Console confirme la propiedad, esperar la actualización de Google. El aviso de rechazo indica esperar 24 horas antes de volver a intentar la verificación de la marca.
5. En **Ver problemas**, elegir **Corregí los problemas** cuando ambas correcciones estén confirmadas y solicitar de nuevo la verificación.
6. Publicar la marca cuando Google la marque como lista para publicar.

## Acceso a los datos

El centro de verificación de la captura no tenía declarados permisos sensibles ni restringidos. Esa indicación no verifica los permisos solicitados efectivamente por el código.

En **Acceso a los datos**, declarar los permisos de los clientes que pertenecen al proyecto:

- Conciliación Gmail: `https://www.googleapis.com/auth/gmail.readonly`.
- Google Calendar, si el cliente de calendario pertenece al mismo proyecto: `https://www.googleapis.com/auth/calendar` y `https://www.googleapis.com/auth/userinfo.email`.

La configuración bancaria prefiere `GMAIL_OAUTH_CLIENT_ID` y solo utiliza `GOOGLE_CLIENT_ID` como alternativa. Comprobar los ID de cliente antes de asumir que Gmail y Calendar utilizan el mismo proyecto.

Justificación de Gmail: consultar avisos bancarios recibidos en la cuenta autorizada del hotel, comprobar remitente y llave, extraer valor, fecha, pagador y referencia, evitar duplicados y relacionar pagos. La lectura del cuerpo del aviso es necesaria: un permiso de metadatos o etiquetas no permite extraer la transacción. La etiqueta limita el procesamiento en la aplicación, no el alcance técnico del permiso de Google.

Después de aprobar y publicar la marca, completar en **Centro de verificación** la solicitud de acceso a los datos. Google puede requerir un video que muestre autorización y uso de cada permiso. Los permisos restringidos procesados en un servidor están sujetos a evaluación de seguridad y recertificación, salvo una excepción aplicable. No declarar que esa evaluación está completada sin su aprobación real.

## Renovar conexiones existentes

Después de confirmar que el cliente de Gmail pertenece al proyecto en producción, reconectar las cuentas desde **Integraciones** para obtener autorizaciones nuevas. Las autorizaciones emitidas en modo de pruebas tienen una caducidad de siete días. El estado en producción elimina esa caducidad de pruebas para las autorizaciones nuevas; una revocación, cambios de cuenta u otras condiciones de Google todavía pueden invalidarlas.

## Fuentes oficiales

- [Público y publicación OAuth](https://support.google.com/cloud/answer/15549945).
- [Verificación de propiedad en Search Console](https://support.google.com/webmasters/answer/9008080).
- [Verificación de permisos restringidos](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).
- [Permisos de Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes).
- [Política de datos de Google Workspace](https://developers.google.com/workspace/workspace-api-user-data-developer-policy).
