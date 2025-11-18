// js/modules/faq/faq.js

/**
 * Módulo de Preguntas Frecuentes (FAQ) DETALLADO
 * Muestra una lista organizada y específica de preguntas y respuestas sobre las funcionalidades de cada módulo de la aplicación.
 */

// Datos de las preguntas y respuestas, organizadas por categoría y funcionalidad.
const faqData = [
  // ... (Las otras categorías como "Mapa de Habitaciones", "Reservas", etc., se mantienen igual)

  {
    category: "Panel de Control (Dashboard)",
    icon: "📊",
    questions: [
      {
        q: "¿Para qué sirve el Panel de Control o Dashboard?",
        a: "Es la pantalla principal y funciona como un <b>resumen ejecutivo</b> del estado de tu hotel <b>en este preciso momento</b>. Está diseñado para que, de un solo vistazo, puedas entender cómo va el día, revisar los indicadores más importantes y anticipar las llegadas y salidas de huéspedes sin necesidad de ir a los reportes detallados."
      },
      {
        q: "¿Qué significan las cuatro tarjetas de la parte superior?",
        a: `Son tus indicadores clave del día (KPIs). Cada una te da una pieza de información vital:
           <ul>
            <li><b>Reservas Activas Hoy:</b> Muestra el número total de habitaciones que están actualmente ocupadas por huéspedes.</li>
            <li><b>Ingresos Habitaciones Hoy:</b> Es el total de dinero que ha ingresado a la caja <b>hoy</b>, específicamente por conceptos de alojamiento (alquileres, extensiones de tiempo, etc.). No incluye ventas de tienda o restaurante.</li>
            <li><b>Ocupación Actual:</b> Te dice qué porcentaje de tus habitaciones disponibles están ocupadas en este instante, mostrándote también los números exactos (ej. 50% (10/20)).</li>
            <li><b>Ventas Tienda Hoy:</b> Es la suma de todo el dinero que ha ingresado a la caja <b>hoy</b> por ventas en el módulo de Tienda.</li>
           </ul>
           La pequeña flecha (▲ o ▼) te indica si el valor de hoy es mayor o menor que el de ayer.`
      },
      {
        q: "¿Qué son las listas de 'Próximos Check-Ins' y 'Check-Outs'?",
        a: "Son recordatorios automáticos para el personal de recepción. Te muestran una lista de todos los huéspedes que tienen programado <b>llegar (Check-in)</b> y <b>salir (Check-out)</b> durante el día de hoy, ayudándote a anticipar el flujo de trabajo y preparar las habitaciones necesarias."
      },
      {
        q: "¿Para qué sirven los gráficos de la parte inferior?",
        a: `Te dan una visión rápida de la tendencia reciente de tu hotel:
            <ul>
                <li><b>Ingresos Habitaciones (Últimos 7 Días):</b> Este gráfico de línea te permite ver la evolución de tus ingresos por alojamiento durante la última semana. Puedes identificar fácilmente qué días fueron más fuertes o más débiles en ventas.</li>
                <li><b>Ocupación (Últimos 7 Días):</b> Este gráfico de barras muestra el porcentaje de ocupación para cada uno de los últimos siete días. Es perfecto para visualizar picos y valles en la demanda reciente.</li>
            </ul>`
      },
      {
        q: "¿Qué son los 'Accesos Rápidos'?",
        a: "Son simplemente botones para llevarte directamente a las secciones más usadas del sistema, como crear una <b>'Nueva Reserva'</b>, ir al <b>'Mapa Hotel'</b> o abrir la <b>'Caja'</b>, ahorrándote clics en tu día a día."
      }
    ]
  },

  
{
  category: "Mapa de Habitaciones",
  icon: "🗺️",
  questions: [
    {
      q: "¿Qué es el Mapa de Habitaciones y para qué sirve?",
      a: "Es la vista principal para gestionar el hotel de forma visual. Desde aquí puedes ver el estado de todas las habitaciones y acceder a acciones como alquilar, facturar, gestionar artículos prestados y controlar la limpieza."
    },
    {
      q: "¿Qué significan los colores de las habitaciones?",
      a: `<ul>
        <li><b style="color:#22c55e">Verde (LIBRE):</b> Lista para alquilar.</li>
        <li><b style="color:#facc15">Amarillo (OCUPADA):</b> Con cliente dentro.</li>
        <li><b style="color:#06b6d4">Celeste (LIMPIEZA):</b> El cliente salió, requiere limpieza.</li>
        <li><b style="color:#a78bfa">Morado (RESERVADA):</b> Reservada para una llegada próxima (menos de 3 horas).</li>
        <li><b style="color:#f87171">Rojo (TIEMPO AGOTADO):</b> Se acabó el tiempo de estancia contratado.</li>
        <li><b style="color:#3b82f6; border: 1px solid #3b82f6;">Borde Azul (TIEMPO LIBRE):</b> Habitación ocupada con modalidad de 'Duración Abierta'.</li>
      </ul>`
    },
    {
      q: "¿Qué es la opción 'Duración Abierta' o 'Tiempo Libre'?",
      a: "Es una modalidad de alquiler donde no se define una hora de salida fija al inicio. El sistema cuenta el tiempo transcurrido y, al momento de cobrar (botón 'Ver Consumos' o 'Entregar'), calcula el precio total basándose en las horas o bloques de tiempo consumidos hasta ese instante."
    },
    {
      q: "¿Cómo funciona el cobro de consumos (Tienda/Restaurante) al hacer Check-out?",
      a: "El sistema es ahora más inteligente. Al realizar el cobro final, el pago se <b>desglosa automáticamente</b> en la caja. Si el cliente paga $100.000 ($80.000 de habitación y $20.000 de tienda), el reporte de caja mostrará esos ingresos por separado para tener una contabilidad exacta."
    },
    {
      q: "¿Qué es la gestión de 'Artículos Prestados'?",
      a: "Es una nueva función accesible desde el botón 'Gestionar Artículos' en una habitación ocupada. Permite registrar si le prestaste algo al huésped (ej. un secador de pelo, plancha o toalla extra) para llevar un control y asegurar su devolución antes de la salida."
    },
    {
      q: "¿Cómo libero una habitación después de cobrar?",
      a: "Primero haz clic en 'Ver Consumos' o 'Liberar Habitación' para saldar la cuenta. Si el saldo llega a $0, el sistema te ofrecerá automáticamente un botón para <b>'Liberar y Limpieza'</b>. Al confirmar, la habitación pasa a estado 'Limpieza' y se notifica al personal encargado."
    }
  ]
},
,
 {
    category: "Reservas",
    icon: "🗓️",
    questions: [
      {
        q: "¿Cuál es la función principal del módulo de Reservas?",
        a: "Este módulo te permite registrar y gestionar todas las reservas futuras del hotel. A diferencia del 'Mapa de Habitaciones' que es para acciones inmediatas, aquí puedes planificar la ocupación a largo plazo, asegurando la disponibilidad y registrando los datos del cliente y los pagos por adelantado."
      },
      {
        q: "¿Cómo creo una nueva reserva?",
        a: `Es un proceso de 4 pasos en un solo formulario:
          <ul>
            <li><b>1. Datos del Cliente:</b> Puedes buscar un cliente existente o registrar uno nuevo directamente desde el formulario.</li>
            <li><b>2. Detalles de la Reserva:</b> Eliges la fecha de llegada, la duración, la habitación y la cantidad de huéspedes.</li>
            <li><b>3. Pago:</b> Si la política del hotel es cobrar al inicio, puedes registrar un pago completo o un abono parcial.</li>
            <li><b>4. Notas:</b> Añades cualquier comentario importante sobre la reserva.</li>
          </ul>
          Al final, el sistema te mostrará el total calculado antes de guardar.`
      },
      {
        q: "¿Cómo funciona la selección de clientes?",
        a: "El formulario tiene un buscador de clientes integrado. Al hacer clic en 'Buscar', se abre una ventana donde puedes encontrar a cualquier cliente registrado. Si el cliente es nuevo, simplemente haz clic en el botón '+' para agregarlo sin salir de la pantalla de reservas. Esto ahorra mucho tiempo."
      },
      {
        q: "¿Qué es 'Precio Manual (Libre)'?",
        a: "Es una opción especial que te permite ignorar todas las tarifas automáticas. Al marcar esta casilla, puedes escribir un precio total personalizado para la estancia. Es útil para negociaciones especiales, paquetes o cuando necesitas total flexibilidad en el cobro."
      },
      {
        q: "¿Cómo funcionan los descuentos en las reservas?",
        a: "El sistema es muy inteligente. Primero, buscará y aplicará automáticamente cualquier descuento que aplique por cliente o por fechas. Además, puedes introducir manualmente un 'Código de Descuento' para aplicar promociones específicas. El total de la reserva se recalculará al instante."
      },
      {
        q: "¿Puedo registrar un pago o abono al crear la reserva?",
        a: "Sí. Si la configuración de tu hotel es 'Cobro al Check-in', el formulario te mostrará una sección de pagos. Podrás registrar un 'Pago completo' o un 'Pago parcial (abono)', seleccionando el método de pago. Si la política es 'Cobro al Check-out', esta sección se ocultará."
      },
      {
        q: "¿Por qué no me deja guardar una reserva?",
        a: `Pueden ser dos razones principales:
          <ul>
            <li><b>Conflicto de Disponibilidad:</b> La habitación que seleccionaste ya está ocupada o reservada para las fechas que elegiste. El sistema te mostrará un error.</li>
            <li><b>Turno de Caja Cerrado:</b> Si estás intentando registrar un pago y no tienes un turno de caja activo, el sistema bloqueará la acción por seguridad. Asegúrate de tener tu turno abierto.</li>
          </ul>`
      },
      {
        q: "¿Qué significan los estados de la lista (Reservada, Confirmada, Activa)?",
        a: `Cada estado tiene acciones específicas:
          <ul>
            <li><b>Reservada:</b> Es una reserva nueva. Desde aquí puedes 'Confirmarla', 'Editarla', 'Cancelar' o hacer 'Check-in' si la fecha de llegada es hoy.</li>
            <li><b>Confirmada:</b> El cliente ha confirmado su llegada. Las opciones son similares a 'Reservada'.</li>
            <li><b>Activa:</b> ¡El huésped ya está en el hotel! Desde aquí puedes gestionar su 'Check-out' o ver los detalles de su estancia.</li>
          </ul>`
      },
      {
        q: "¿Qué es la sincronización con Google Calendar?",
        a: "Es una función automática que importa reservas de otras plataformas (como Booking.com, Airbnb, etc.) que tengas conectadas a tu Google Calendar. El sistema las lee, las interpreta y las crea en tu panel de reservas para que no tengas que hacerlo manualmente, evitando así el riesgo de sobreventa."
      }
    ]
  },
  
   {
    category: "Caja y Turnos",
    icon: "💰",
    questions: [
      {
        q: "¿Qué información incluye el Reporte de Cierre de Caja?",
        a: "El nuevo reporte es mucho más completo. Además del balance de dinero, ahora incluye: <br>1. <b>Desglose de Ingresos:</b> Separa cuánto entró por Habitaciones, Tienda, Restaurante y Servicios.<br>2. <b>Control de Inventario:</b> Muestra qué amenidades se gastaron y cuánta lencería se envió a lavandería durante tu turno.<br>3. <b>Artículos Prestados:</b> Un registro de los objetos prestados y devueltos en tu jornada."
      },
      {
        q: "¿Por qué es obligatorio abrir un turno?",
        a: "Sin un turno activo, el sistema bloquea cualquier operación de cobro o venta. Esto garantiza que cada peso y cada movimiento de inventario quede asociado a un responsable específico."
      },
      {
        q: "¿Cómo registro un gasto o retiro de dinero?",
        a: "En 'Agregar Nuevo Movimiento', selecciona 'Egreso'. Ahora puedes marcar casillas especiales como 'Registrar con fecha anterior' (para correcciones) o 'Fuera de turno' si es un ajuste administrativo."
      },
      {
        q: "¿Puedo ver los movimientos que se han eliminado?",
        a: "Sí, si tienes permisos de Administrador. El botón 'Ver Eliminados' muestra una auditoría completa de quién eliminó un movimiento, cuándo y el monto original, garantizando total transparencia."
      },
      {
        q: "¿Cómo imprimo el reporte de mi corte?",
        a: "Al finalizar el corte, verás un resumen en pantalla. Haz clic en el botón 'Imprimir'. El sistema detectará automáticamente si usas una impresora de recibos (58mm/80mm) o una normal y ajustará el formato del ticket para que salga perfecto."
      }
    ]
  },
{
    category: "Clientes y CRM",
    icon: "👤",
    questions: [
      {
        q: "¿Para qué sirve el módulo de Clientes y CRM?",
        a: "Es mucho más que una agenda. Este módulo es tu centro de gestión de relaciones con los clientes (CRM). Te permite no solo guardar los datos de tus huéspedes, sino también ver su historial completo de visitas, analizar sus gastos, registrar interacciones (llamadas, notas) y asignarles descuentos personalizados para fomentar su lealtad."
      },
      {
        q: "¿Cómo creo, busco o edito un cliente?",
        a: `<ul>
            <li><b>Crear:</b> En la pantalla principal del módulo, haz clic en el botón <i>"+ Nuevo Cliente"</i>. Se abrirá un formulario flotante donde podrás llenar toda su información. El <b>número de documento</b> debe ser único.</li>
            <li><b>Buscar:</b> Usa la barra de búsqueda para encontrar clientes por nombre, documento, email o teléfono. También puedes usar los filtros de fecha para ver quiénes se registraron en un periodo específico.</li>
            <li><b>Editar:</b> Una vez que encuentres al cliente en la lista, haz clic en el botón "Editar". Se abrirá el mismo formulario con sus datos listos para ser actualizados.</li>
           </ul>`
      },
      {
        q: "Hice clic en 'Ver' y apareció un panel con pestañas. ¿Qué es cada una?",
        a: `Ese es el perfil completo del cliente, tu centro de control para todo lo relacionado con él:
           <ul>
            <li><b>Datos Generales:</b> Aquí ves y editas su información básica como nombre, teléfono, etc.</li>
            <li><b>Historial de Visitas:</b> Un registro de cada una de sus estancias pasadas en el hotel, incluyendo en qué habitación se quedó y en qué fechas.</li>
            <li><b>Historial de Gastos:</b> Una herramienta poderosa para entender a tu cliente. Muestra un <b>gráfico de barras</b> con el total de dinero que ha gastado en diferentes áreas (habitaciones, tienda, restaurante) y una tabla con el detalle de cada consumo.</li>
            <li><b>Actividades CRM:</b> Tu bitácora de interacciones. Aquí puedes registrar llamadas, emails, notas importantes o tareas pendientes relacionadas con el cliente para que todo tu equipo esté informado.</li>
            <li><b>Descuentos:</b> Muestra una lista de los descuentos especiales y personalizados que le has asignado exclusivamente a este cliente.</li>
           </ul>`
      },
      {
        q: "¿Cómo uso la pestaña 'Actividades CRM' de forma efectiva?",
        a: "Usa esta pestaña para registrar cualquier interacción importante. ¿El cliente llamó para preguntar algo? Anótalo. ¿Le prometiste un descuento en su próxima visita? Créale una 'Tarea' o 'Nota'. Esto ayuda a que todo el personal esté al tanto y pueda dar un servicio personalizado."
      },
      {
        q: "¿Puedo descargar una lista de todos mis clientes?",
        a: "Sí. En la pantalla principal del módulo, encontrarás un botón que dice <b>'Exportar Excel'</b>. Al hacer clic, el sistema generará y descargará un archivo <code>.xlsx</code> con la información de contacto completa de todos tus clientes registrados, ideal para tus campañas de marketing o análisis externos."
      },
      {
        q: "A veces, al crear una reserva, me aparece una ventana para buscar clientes. ¿Es lo mismo?",
        a: "Exacto. Esa ventana es el 'Selector de Clientes', una función de este módulo que otros módulos (como Reservas) pueden usar. Te permite buscar y enlazar rápidamente a un cliente existente sin tener que escribir todos sus datos de nuevo, ahorrando tiempo y evitando crear clientes duplicados."
      }
    ]
  },
  {
    category: "Configuración de Habitaciones y Tarifas",
    icon: "🏨",
    questions: [
        {
            q: "¿Para qué sirve este módulo? ¿Es lo mismo que el Mapa de Habitaciones?",
            a: "No, son diferentes. Piensa en este módulo como el <b>'centro de configuración'</b>. Aquí es donde creas tus habitaciones y defines todas tus tarifas por tiempo. El 'Mapa de Habitaciones', en cambio, es el <b>'centro de operaciones'</b> diario donde usas esas habitaciones y tarifas para hacer check-in, check-out, etc."
        },
        {
            q: "¿Qué son y cómo configuro los 'Tiempos de Estancia'?",
            a: `Son las diferentes opciones de tarifas que ofreces a tus clientes. Por ejemplo: "3 Horas", "6 Horas", "Noche Completa".
               <ul>
                <li>Usa el primer formulario para crear o editar estos tiempos. Debes darles un <b>Nombre</b>, una <b>Duración en Minutos</b> y un <b>Precio</b>.</li>
                <li><b>¡Truco para 'Noche'!</b> Si en el nombre incluyes la palabra 'Noche', el sistema es inteligente: calculará la duración automáticamente basándose en los horarios de Check-in y Check-out que definiste en la <i>Configuración General del Hotel</i>.</li>
                <li>Puedes activar o desactivar tiempos para que aparezcan o no como opción al momento de alquilar una habitación.</li>
               </ul>`
        },
        {
            q: "Guía Rápida: ¿Cómo creo una nueva habitación?",
            a: `Usa el segundo formulario, "Crear Nueva Habitación". Los campos más importantes son:
               <ul>
                <li><b>Nombre/Número:</b> El identificador único de la habitación (ej. "101", "Suite Presidencial").</li>
                <li><b>Precios por Ocupación:</b> Aquí defines la tarifa por noche.
                    <ul>
                        <li><b>Precio 1 Persona:</b> Lo que cobras si se aloja un solo huésped.</li>
                        <li><b>Precio 2 Personas:</b> Lo que cobras si se alojan dos huéspedes.</li>
                        <li><b>Precio Huésped Adicional:</b> El monto que se suma por <u>cada</u> huésped extra a partir del tercero.</li>
                    </ul>
                </li>
                <li><b>Capacidad Máxima:</b> El número total de personas que pueden alojarse.</li>
                <li><b>Amenidades:</b> Escribe las características especiales separadas por coma (ej: Wifi, TV, Aire Acondicionado).</li>
               </ul>`
        },
        {
            q: "¿Cómo edito o elimino una habitación existente?",
            a: "En la lista de habitaciones que aparece al final, cada tarjeta tiene sus botones:<ul><li><b>Editar:</b> Al hacer clic, se abrirá un <b>formulario flotante</b> con toda la información de esa habitación para que la modifiques fácilmente.</li><li><b>Eliminar:</b> Ten cuidado, esta acción es <b>permanente e irreversible</b>. El sistema te pedirá una confirmación antes de borrar la habitación para siempre.</li></ul>"
        },
        {
            q: "Intenté crear una habitación y me apareció un mensaje sobre el límite de mi plan. ¿Qué significa?",
            a: "Tu plan de suscripción actual tiene un límite en la cantidad de habitaciones que puedes registrar en el sistema. Si ya has alcanzado ese número, no podrás crear más. Para seguir añadiendo habitaciones, necesitas mejorar tu plan desde la sección <b>'Mi Cuenta'</b>. Esto te permitirá gestionar todo tu hotel sin restricciones."
        }
    ]
},

{
    category: "Integraciones con Servicios Externos",
    icon: "🔌",
    questions: [
        {
            q: "¿Para qué sirve este módulo?",
            a: "Esta sección te permite conectar tu software hotelero con otras plataformas importantes como <b>Google Calendar</b> y <b>Outlook Calendar</b>. El objetivo es automatizar tareas y sincronizar tus reservas para ahorrar tiempo y evitar errores."
        },
        {
            q: "¿Por qué debería conectar mi calendario de Google u Outlook?",
            a: `La razón principal es para <b>prevenir la sobreventa (overbooking)</b> de forma automática. Si ya usas un calendario para gestionar tus reservas de plataformas como <b>Booking.com, Airbnb o Expedia</b>, al conectarlo aquí, nuestro sistema podrá:
               <ul>
                <li>Leer esas reservas externas y bloquear las habitaciones correspondientes en tu calendario interno.</li>
                <li>(Próximamente) Enviar tus reservas directas a ese calendario para bloquear la disponibilidad en las otras plataformas.</li>
               </ul>
               Esto mantiene tu disponibilidad sincronizada en todos tus canales de venta sin trabajo manual.`
        },
        {
            q: "Guía Rápida: ¿Cómo conecto mi calendario?",
            a: `Es un proceso seguro y sencillo:
               <ol style="list-style-type: decimal; padding-left: 20px;">
                <li style="margin-bottom: 0.5rem;">Ve a la sección de <b>Google Calendar</b> u <b>Outlook Calendar</b>.</li>
                <li style="margin-bottom: 0.5rem;">Haz clic en el botón azul <b>"Conectar"</b>. Serás redirigido a la página oficial de inicio de sesión de Google o Microsoft.</li>
                <li style="margin-bottom: 0.5rem;">Inicia sesión con la cuenta de correo cuyo calendario quieres sincronizar.</li>
                <li style="margin-bottom: 0.5rem;"><b>Acepta los permisos</b> que la aplicación solicita para poder leer y gestionar eventos de tu calendario. ¡Este paso es crucial!</li>
                <li style="margin-bottom: 0.5rem;">Serás devuelto automáticamente a la plataforma. Si todo salió bien, verás un mensaje de "✅ Conectado como: tu.email@..."</li>
               </ol>
               Para verificar, puedes usar el botón <b>"Crear Evento de Prueba"</b>.`
        }
    ]
  },

{
    category: "Gestión de Limpieza e Inventario",
    icon: "🧹",
    questions: [
        {
            q: "¿Cómo confirmo que una habitación está limpia?",
            a: "En la lista de pendientes, haz clic en <b>'Confirmar Limpieza'</b>. Ahora el sistema te pedirá registrar qué recursos usaste: <br><ul><li><b>Amenidades:</b> Jabones, champú, papel, etc. (se descuentan del stock).</li><li><b>Lencería:</b> Sábanas y toallas cambiadas (se mueven a 'Lavandería').</li></ul>"
        },
        {
            q: "¿Para qué sirve el botón 'Gestión de Inventario Amenidades'?",
            a: "(Solo Admins) Te permite ver el stock actual de consumibles, realizar compras (añadir stock) y definir las cantidades por defecto que se usan en cada limpieza para agilizar el trabajo del personal."
        },
        {
            q: "¿Cómo funciona el ciclo de Lavandería y Lencería?",
            a: "El sistema maneja un ciclo completo: <br>1. <b>Uso:</b> Al limpiar una habitación, la ropa sucia se marca como 'Enviada a Lavandería'.<br>2. <b>Lavado:</b> Esas prendas se acumulan en el estado virtual 'En Lavandería'.<br>3. <b>Recepción:</b> Cuando la ropa regresa limpia, usas el botón 'Gestión Lavandería' -> 'Recibir Lote' para reingresarlas al almacén de limpios."
        },
        {
            q: "¿Qué hago si se pierde o rompe una sábana o toalla?",
            a: "En el módulo de 'Gestión Lavandería', usa el formulario de <b>'Reportar Pérdida/Daño'</b>. Esto descontará el artículo del inventario total y dejará un registro del motivo para auditoría."
        },
        {
            q: "¿Cómo controlo los artículos prestados (ej. Planchas)?",
            a: "Usa la sección 'Inventario Préstamos'. Aquí puedes definir qué objetos tiene el hotel para prestar (stock disponible). El personal de recepción podrá prestarlos desde el Mapa de Habitaciones, y el sistema controlará quién lo tiene y cuándo lo devuelve."
        },
        {
            q: "¿Puedo imprimir una hoja para hacer conteo físico?",
            a: "Sí. En el menú de acciones de administrador, selecciona <b>'Imprimir Conteo'</b>. Se generará una hoja con todo tu inventario actual (Sistema vs Físico) ideal para realizar auditorías manuales."
        }
    ]
  },

  {
    category: "Gestión de Mantenimiento",
    icon: "🛠️",
    questions: [
      {
        q: "¿Para qué sirve este módulo?",
        a: "Este es el centro de control para todas las reparaciones y tareas de mantenimiento del hotel. Te permite crear un registro de cada problema, asignarlo a un miembro del personal, establecer prioridades y dar seguimiento a su estado hasta que se complete, asegurando que nada se olvide."
      },
      {
        q: "Guía Rápida: ¿Cómo reporto un problema o creo una nueva tarea?",
        a: `Es muy sencillo:
           <ol style="list-style-type: decimal; padding-left: 20px;">
            <li style="margin-bottom: 0.5rem;">Haz clic en el botón <b>"+ Nueva tarea"</b>.</li>
            <li style="margin-bottom: 0.5rem;">En el formulario, selecciona el <b>Encargado</b> (la persona responsable de la reparación).</li>
            <li style="margin-bottom: 0.5rem;">Si el problema es en una habitación específica, selecciónala en la lista. Si es en un área general (como el lobby), déjalo en "General / Sin asignar".</li>
            <li style="margin-bottom: 0.5rem;">Escribe un <b>Título</b> claro (ej. "Fuga en el lavamanos") y una descripción con más detalles si es necesario.</li>
            <li style="margin-bottom: 0.5rem;">Asigna una <b>Prioridad</b> y luego haz clic en "Crear Tarea".</li>
           </ol>`
      },
      {
        q: "Creé una tarea para la Habitación 201. ¿Qué pasa con esa habitación ahora?",
        a: `El sistema es inteligente y se encarga de todo automáticamente:
           <ul>
            <li>Al crear una tarea y asociarla a una habitación, esa habitación <b>se bloquea de inmediato</b> en el Mapa de Habitaciones, cambiando su estado a 'Mantenimiento'.</li>
            <li>Esto previene que la recepción la alquile o reserve por error mientras necesita reparaciones.</li>
            <li>Además, se envía una <b>notificación automática a la recepción</b> para que estén al tanto de que esa habitación no está disponible.</li>
           </ul>`
      },
      {
        q: "¿Cómo actualizo el estado de una tarea o la marco como terminada?",
        a: "En la lista de tareas, al final de cada fila, hay un menú desplegable de 'Acción'. Desde allí puedes:<ul><li><b>✏️ Editar:</b> Para cambiar cualquier detalle de la tarea (como la descripción o el encargado).</li><li><b>🔄 Cambiar estado:</b> Para actualizar el progreso (ej. de 'Pendiente' a 'En progreso', o de 'En progreso' a 'Completada').</li><li><b>🗑️ Eliminar:</b> Para borrar la tarea permanentemente.</li></ul>"
      },
      {
        q: "Ya terminé la reparación en la Habitación 201. ¿Cómo la vuelvo a poner disponible?",
        a: "No tienes que hacerlo manualmente. Simplemente busca la tarea en la lista y cambia su estado a <b>'Completada'</b>. El sistema hará el resto:<ul><li>Verificará si hay otras tareas activas para esa misma habitación.</li><li>Si no hay más reparaciones pendientes, el estado de la habitación cambiará automáticamente a <b>'Limpieza'</b>.</li><li>Una vez que el personal de limpieza la marque como limpia, la habitación quedará 'Libre' y lista para la venta. ¡Todo el proceso está conectado!</li></ul>"
      },
      {
        q: "¿La lista de tareas se actualiza sola?",
        a: "Sí. La tabla se actualiza <b>en tiempo real</b>. Si un recepcionista crea una nueva tarea mientras tú estás viendo la pantalla, esta aparecerá automáticamente sin que necesites recargar la página."
      }
    ]
  },

 {
    category: "Gestión de Usuarios y Horarios",
    icon: "👥",
    questions: [
        {
            q: "¿Para qué sirve este módulo?",
            a: "Este es tu panel de control para todo tu equipo. Aquí puedes crear las cuentas de usuario para tus empleados, definir exactamente qué pueden hacer en el sistema asignándoles roles y permisos, y organizar sus horarios de trabajo semanales."
        },
        {
            q: "Guía Rápida: ¿Cómo creo un nuevo usuario para un empleado?",
            a: `Usa el formulario que aparece en la parte superior de la página:
               <ol style="list-style-type: decimal; padding-left: 20px;">
                   <li style="margin-bottom: 0.5rem;">Ingresa el <b>Nombre Completo</b> del empleado.</li>
                   <li style="margin-bottom: 0.5rem;">Escribe su <b>Correo Electrónico</b>. Este será su nombre de usuario para iniciar sesión.</li>
                   <li style="margin-bottom: 0.5rem;">Asígnale una <b>Contraseña</b> temporal (debe tener al menos 8 caracteres). El usuario podrá cambiarla después.</li>
                   <li style="margin-bottom: 0.5rem;">Selecciona uno o más <b>Roles</b> (ej. 'Recepcionista', 'Admin'). ¡Este paso es crucial para definir sus permisos!</li>
                   <li style="margin-bottom: 0.5rem;">Haz clic en "Guardar Usuario".</li>
               </ol>
               Desde la tabla de abajo podrás editar, desactivar o resetear la contraseña de cualquier usuario en el futuro.`
        },
        {
            q: "¿Cuál es la diferencia entre 'Roles' y 'Permisos'?",
            a: `Piénsalo de esta forma:
               <ul>
                <li><b>Rol:</b> Es como el "cargo" o puesto de trabajo (Recepcionista, Administrador, Limpieza). Al asignar un rol, le das al usuario un conjunto de permisos estándar para ese puesto.</li>
                <li><b>Permisos:</b> Es como darle una "llave maestra" para una tarea específica. El botón "Permisos" te permite ajustar el acceso de un usuario de forma individual, dándole un permiso extra o quitándole uno, sin necesidad de cambiar su rol principal. Es para casos especiales.</li>
               </ul>`
        },
        {
            q: "Guía Rápida: ¿Cómo organizo los turnos de mis recepcionistas?",
            a: `Es un proceso de dos pasos:
               <ol style="list-style-type: decimal; padding-left: 20px;">
                <li style="margin-bottom: 0.5rem;"><b>Define la Duración:</b> Primero, en la sección "Configuración General de Turnos", elige si tu hotel opera con turnos de <b>8 horas</b> (Mañana, Tarde, Noche) o de <b>12 horas</b> (Día, Noche).</li>
                <li style="margin-bottom: 0.5rem;"><b>Asigna los Turnos:</b> En la tabla "Horario Semanal", verás a tus recepcionistas y los días de la semana. Simplemente haz clic en la casilla de un día y un usuario, y selecciona el turno que le corresponde (ej. '☀️ Día', '🌙 Noche' o '✔️ Descanso'). Los cambios se guardan automáticamente.</li>
               </ol>`
        },
        {
            q: "¿Puedo imprimir el horario de la semana?",
            a: "Sí. Justo encima de la tabla de horarios, encontrarás un botón de <b>'Imprimir'</b>. Al presionarlo, se generará una versión limpia del horario semanal, lista para ser impresa y publicada para tu equipo."
        }
    ]
  },

  {
    category: "Servicios Adicionales",
    icon: "🛎️",
    questions: [
      {
        q: "¿Para qué sirve este módulo?",
        a: "Aquí puedes crear un catálogo completo de todos los servicios extra que tu hotel ofrece. Piensa en cosas como <b>servicio de lavandería, transporte al aeropuerto, decoraciones románticas, tours, alquiler de toallas</b>, etc. Los servicios que crees aquí estarán disponibles para ser agregados fácilmente a la cuenta de un huésped desde el Mapa de Habitaciones."
      },
      {
        q: "Guía Rápida: ¿Cómo creo un nuevo servicio?",
        a: `Es un proceso de dos pasos, muy sencillo:
           <ol style="list-style-type: decimal; padding-left: 20px;">
            <li style="margin-bottom: 0.5rem;"><b>Primero, crea la Categoría:</b> En la sección de arriba ("Categorías de Servicios"), crea un grupo para tu servicio. Por ejemplo, "Lavandería", "Transporte" o "Experiencias". Esto te ayudará a mantener todo organizado.</li>
            <li style="margin-bottom: 0.5rem;"><b>Luego, crea el Servicio:</b> En la segunda sección ("Agregar Nuevo Servicio Adicional"), dale un <b>Nombre</b> específico (ej. "Lavado y Secado por Kilo"), asígnale la <b>Categoría</b> que creaste en el paso anterior, y ponle un <b>Precio</b>. Luego haz clic en "Guardar Servicio".</li>
           </ol>`
      },
      {
        q: "¿Es obligatorio usar categorías para mis servicios?",
        a: "No, no es obligatorio, puedes dejar la categoría sin seleccionar. Sin embargo, es <b>muy recomendable</b> usarlas. Te ayudan a mantener tu lista de servicios ordenada y fácil de manejar, especialmente si ofreces muchas opciones diferentes."
      },
      {
        q: "¿Cómo edito un servicio o lo desactivo temporalmente?",
        a: "En las listas de 'Categorías' y 'Servicios', cada fila tiene botones de 'Acciones':<ul><li><b>Editar:</b> Al hacer clic, el formulario de arriba se llenará con los datos de ese ítem para que puedas modificarlos.</li><li><b>Desactivar/Activar:</b> Te permite ocultar un servicio de la lista de opciones sin tener que borrarlo. Es ideal si un servicio es solo por temporada o no está disponible temporalmente.</li></ul>"
      },
      {
        q: "Ya creé mis servicios. ¿Ahora cómo los uso o los cobro?",
        a: "Una vez que tus servicios están creados y activos, el personal de recepción podrá usarlos fácilmente. Cuando estén en el <b>Mapa de Habitaciones</b>, solo tienen que hacer clic en una habitación ocupada y seleccionar la opción de <b>'Servicios Adicionales'</b>. Allí aparecerá la lista de todos los servicios que has creado, listos para ser agregados a la cuenta del huésped."
      }
    ]
  },

  {
    category: "Reportes y Análisis de Datos",
    icon: "📊",
    questions: [
      {
        q: "¿Para qué sirve el módulo de Reportes?",
        a: "Este es el cerebro analítico de tu hotel. Aquí puedes generar informes detallados para entender a fondo el rendimiento de tu negocio. Te ayuda a responder preguntas clave sobre tu ocupación, tus finanzas y la eficiencia de tus operaciones para que puedas tomar decisiones informadas y estratégicas."
      },
      {
        q: "Guía Rápida: ¿Cómo genero un reporte?",
        a: `Es un proceso muy sencillo de 3 pasos:
           <ol style="list-style-type: decimal; padding-left: 20px;">
            <li style="margin-bottom: 0.5rem;"><b>Elige el Tipo de Reporte:</b> Selecciona en la primera lista el análisis que deseas ver (ej. "Porcentaje de Ocupación", "Resumen Financiero Global").</li>
            <li style="margin-bottom: 0.5rem;"><b>Define el Período:</b> Usa los calendarios para seleccionar una fecha de inicio ("Desde") y una fecha de fin ("Hasta").</li>
            <li style="margin-bottom: 0.5rem;"><b>Genera:</b> Haz clic en el botón <b>"Generar Reporte"</b>. El sistema procesará los datos y te mostrará los resultados con tablas y gráficos.</li>
           </ol>`
      },
      {
        q: "Reportes Operativos: ¿Qué me dicen el 'Listado de Reservas' y el de 'Ocupación'?",
        a: `<ul>
              <li><b>Listado de Reservas:</b> Te da una tabla detallada de cada reserva en el período que elegiste. Es ideal para auditorías o para ver rápidamente quién se hospedó, cuándo y en qué habitación.</li>
              <li><b>Porcentaje de Ocupación:</b> Es clave para medir la demanda. Te muestra qué tan lleno ha estado tu hotel con un gráfico de línea diario y el promedio total del período. Te ayuda a identificar tus temporadas altas y bajas.</li>
            </ul>`
      },
      {
        q: "Reportes Financieros: ¿Cuál es la diferencia entre los distintos reportes de ingresos y egresos?",
        a: `Cada uno te da una perspectiva diferente de tu dinero:
            <ul>
                <li><b>Resumen Financiero Global:</b> Es la vista más completa. Te muestra el panorama total: <b>Ingresos vs. Egresos</b>, un Balance Neto, y gráficos de pastel que desglosan de dónde viene tu dinero (habitaciones, tienda, etc.) y en qué lo gastas (compras, nómina, etc.).</li>
                <li><b>Detalle de Ingresos/Egresos por Categoría:</b> Son 'zooms' específicos. Te permiten ver en detalle solo los ingresos o solo los egresos, categorizados para que sepas exactamente qué áreas son las más rentables o costosas.</li>
                <li><b>Historial de Cierres de Caja:</b> Un registro de auditoría de cada turno cerrado. Puedes hacer clic en 'Ver Detalle' para ver cada transacción que ocurrió en un turno de caja específico.</li>
            </ul>`
      },
      {
        q: "Reportes Estratégicos: ¿Qué son los 'KPIs de Rendimiento del Hotel'?",
        a: "Este es el reporte más avanzado, te da métricas clave de la industria hotelera para medir la salud de tu negocio:<ul><li><b>RevPAR:</b> El indicador más importante. Te dice cuánto dinero estás ganando por cada habitación disponible, estén ocupadas o no.</li><li><b>ADR:</b> La tarifa promedio que te paga cada huésped por noche.</li><li>Además, te muestra información estratégica como tu día de la semana con más demanda, tu cliente más valioso, y tus productos o servicios más vendidos.</li></ul>"
      },
      {
        q: "Algunos reportes me aparecen bloqueados o con un candado (🔒). ¿Por qué?",
        a: "El acceso a los reportes más avanzados depende de tu plan de suscripción (LITE, PRO, MAX). Reportes como el 'Resumen Financiero Global' o los 'KPIs Avanzados' son exclusivos de los planes superiores. Si deseas desbloquearlos y obtener un análisis más profundo de tu negocio, puedes mejorar tu plan desde la sección <b>'Mi Cuenta'</b>."
      }
    ]
  },

  {
    category: "Notificaciones y Alertas",
    icon: "🔔",
    questions: [
      {
        q: "¿Para qué sirve el sistema de notificaciones?",
        a: "Es el centro de comunicación en tiempo real de tu hotel. Te mantiene informado sobre eventos importantes sin que tengas que estar en cada pantalla a la vez. El sistema te avisa cuando se crean reservas, cuando una habitación queda libre después de la limpieza, cuando se reporta una tarea de mantenimiento, y más."
      },
      {
        q: "Veo una campanita (🔔) en la parte superior. ¿Qué es?",
        a: `Esa es tu <b>central de alertas rápidas</b>. Funciona así:
           <ul>
            <li>Cuando ocurre un evento importante, la campana mostrará un <b>punto rojo</b> indicando que tienes notificaciones nuevas sin leer.</li>
            <li>Al hacer clic, se despliega una lista con tus <b>notificaciones más recientes</b>.</li>
            <li>Puedes hacer clic en una notificación para marcarla como leída, o usar el botón "Marcar todas como leídas" para limpiar el contador.</li>
           </ul>`
      },
      {
        q: "¿Y el módulo completo de 'Notificaciones'?",
        a: "Ese es tu <b>historial completo</b>. Mientras que la campanita solo te muestra lo más reciente, el módulo de 'Notificaciones' es un archivo permanente de cada alerta que ha recibido el sistema. Es ideal para consultar eventos pasados o si necesitas buscar una notificación específica que ya no aparece en la campanita."
      },
      {
        q: "¿Cómo marco las notificaciones como leídas?",
        a: "Tanto en la campanita como en el módulo principal, puedes hacer clic en el círculo junto a cada notificación para marcarla como leída individualmente. También encontrarás un botón para 'Marcar todas como leídas' y así limpiar todas tus alertas pendientes de una sola vez."
      },
      {
        q: "La campanita de notificaciones no me aparece. ¿Por qué?",
        a: "La función de la campanita de notificaciones en tiempo real es una característica <b>exclusiva de los planes de suscripción superiores (MAX)</b>. Si no la ves, es probable que tu hotel esté en un plan LITE o PRO. Puedes mejorar tu plan desde la sección <b>'Mi Cuenta'</b> para activar esta y otras funcionalidades avanzadas."
      }
    ]
  },

  {
    category: "Promociones y Descuentos",
    icon: "🎟️",
    questions: [
      {
        q: "¿Para qué sirve este módulo?",
        a: "Este es tu centro de marketing. Aquí puedes crear todo tipo de ofertas para atraer y fidelizar clientes, desde códigos de descuento para redes sociales hasta promociones automáticas que se aplican solas en fechas especiales o a clientes VIP."
      },
      {
        q: "Veo tres 'Tipos de Promoción'. ¿Cuál es la diferencia?",
        a: `Cada tipo sirve para un propósito diferente:
           <ul>
            <li><b>Por Código (manual):</b> Es el tipo más común. Creas un código (ej. "VERANO2025") que el recepcionista debe introducir manualmente en el sistema de Reservas o en el POS para aplicar el descuento. Ideal para campañas específicas.</li>
            <li><b>Automática (por fecha):</b> Este descuento se aplica solo, sin necesidad de códigos, a cualquier venta o reserva elegible que se realice dentro del rango de fechas que definas. Perfecto para promociones de temporada (ej. "Oferta de Semana Santa").</li>
            <li><b>Para Cliente Específico:</b> Es un descuento personalizado y exclusivo para un solo cliente, seleccionado de tu lista. Es perfecto para regalos de cumpleaños, compensaciones o como premio de lealtad.</li>
           </ul>`
      },
      {
        q: "¿Qué significa la sección 'Aplicar a'?",
        a: "Aquí es donde defines con precisión <b>qué productos o servicios obtendrán el descuento</b>. Puedes hacer que la promoción aplique a:<ul><li>Toda la reserva de una habitación.</li><li>Solo a <b>habitaciones específicas</b> (ej. 10% de descuento solo en las Suites).</li><li>Solo a <b>tiempos de estancia</b> (ej. 20% de descuento en alquileres de 3 horas).</li><li>Solo a <b>servicios adicionales</b> (ej. $5.000 de descuento en el servicio de lavandería).</li><li>Solo a <b>productos de la tienda</b> o a <b>categorías enteras del restaurante</b>.</li></ul>"
      },
      {
        q: "En la lista de descuentos veo un ícono de tarjeta (🎫). ¿Qué hace?",
        a: `Esa es una herramienta para crear una <b>tarjeta de regalo digital</b>. Al hacer clic, se genera una imagen profesional de tu descuento que puedes:
            <ul>
                <li><b>Descargar</b> como un archivo de imagen (.png) para compartirla fácilmente por WhatsApp o en tus redes sociales.</li>
                <li><b>Enviar directamente por Email</b> a un cliente con solo escribir su correo y presionar 'Enviar'.</li>
            </ul>`
      },
      {
        q: "¿Puedo limitar cuántas veces se usa un código o eliminar un descuento?",
        a: `Sí a ambas:
            <ul>
                <li><b>Límite de Usos:</b> En el formulario, el campo 'Límite de Usos' te permite controlar cuántas veces se puede canjear un descuento en total. Si lo dejas en '0', los usos serán ilimitados.</li>
                <li><b>Eliminar:</b> Puedes eliminar un descuento haciendo clic en el ícono de la papelera (🗑️), pero con una condición importante: <b>solo se puede eliminar si nunca ha sido utilizado</b>. Si ya se usó al menos una vez, no se puede borrar para mantener la integridad de tus reportes de ventas.</li>
            </ul>`
      }
    ]
  },





{
    category: "Tienda y Restaurante",
    icon: "🍔",
    questions: [
      {
        q: "¿Para qué sirven estos módulos y en qué se diferencian?",
        a: "Son dos Puntos de Venta (POS) independientes:<ul><li><b>Tienda:</b> Diseñado para vender productos físicos como snacks, bebidas o souvenirs. Gestiona un inventario completo desde la compra al proveedor hasta la venta final.</li><li><b>Restaurante:</b> Diseñado para vender platos y bebidas preparados. Gestiona su propio inventario de ingredientes y las recetas de cada plato para un control más detallado.</li></ul>"
      },
      {
        q: "Guía Rápida: ¿Cómo configuro mi inventario en la Tienda?",
        a: `Sigue estos 3 pasos en orden para configurar tu tienda desde cero:
           <ul>
            <li><b>1. Crea tus Categorías:</b> Ve a <b>Tienda &rarr; Categorías</b>. Haz clic en <i>"+ Agregar Categoría"</i>, dale un nombre (ej. "Bebidas", "Snacks") y guarda. Esto te ayudará a organizar tus productos.</li>
            <li><b>2. Registra tus Proveedores:</b> Ve a <b>Tienda &rarr; Proveedores</b>. Haz clic en <i>"+ Agregar Proveedor"</i>, llena los datos de la empresa que te surte los productos y guarda. El <b>NIT</b> debe ser único.</li>
            <li><b>3. Agrega tus Productos:</b> Ve a <b>Tienda &rarr; Inventario</b>. Haz clic en <i>"+ Agregar Producto"</i>. En el formulario, dale un nombre y código de barras únicos, asigna su categoría y proveedor, y define su precio de compra y de venta. El <b>stock inicial</b> es la cantidad que tienes al momento de crearlo.</li>
           </ul>`
      },
      {
        q: "Guía Rápida: ¿Cómo registro una compra y actualizo mi stock?",
        a: `Este es el flujo para reabastecer tu inventario:
           <ul>
            <li><b>Paso 1 - Crear la Orden de Compra:</b> Ve a <b>Tienda &rarr; Compras</b>. Selecciona un proveedor, busca los productos que vas a comprar, indica la <b>cantidad</b> y el <b>precio de compra</b> por unidad, y agrégalos al carrito. Al finalizar, haz clic en <i>"Registrar Compra"</i>. Esto crea una orden en estado "pendiente".</li>
            <li><b>Paso 2 - Recibir la Mercancía:</b> Cuando llegue tu pedido, ve a <b>Tienda &rarr; Compras Pendientes</b>. Busca la orden y haz clic en <i>"✔️ Recibir Productos"</i>. Confirma las cantidades recibidas. Este es el paso crucial: el sistema <b>automáticamente sumará los productos a tu stock</b> y registrará el gasto (egreso) en la Caja.</li>
           </ul>`
      },
      {
        q: "Guía Rápida: ¿Cómo realizo una venta en el POS de la Tienda?",
        a: `Ve a <b>Tienda &rarr; POS</b>.
           <ul>
            <li><b>Agrega productos</b> al carrito haciendo clic sobre ellos.</li>
            <li><b>Elige el Modo de Venta:</b>
                <ul>
                    <li><b>Pago Inmediato:</b> Para clientes externos. Aquí puedes seleccionar el método de pago. Si eliges <i>"Pago Mixto"</i>, aparecerá una ventana para que puedas dividir el total entre varios métodos (ej. una parte en efectivo y otra en tarjeta).</li>
                    <li><b>Cargar a Habitación:</b> Para huéspedes. Elige la habitación ocupada de la lista. El costo se sumará a la cuenta de la habitación para ser cobrado en el check-out.</li>
                </ul>
            </li>
            <li>Haz clic en <b>"Registrar Venta"</b>. Esto descuenta el stock y registra el ingreso en la Caja (si fue pago inmediato).</li>
           </ul>`
      },
      {
        q: "Guía Rápida: ¿Cómo configuro el menú de mi Restaurante?",
        a: `El restaurante usa un inventario de ingredientes para controlar el costo y stock de los platos.
           <ul>
            <li><b>1. Crea tus Ingredientes:</b> Primero, ve a <b>Restaurante &rarr; Inventario</b>. Haz clic en <i>"+ Nuevo Ingrediente"</i>, y registra todo lo que usas para cocinar (ej. "Carne de Res", "Tomate", "Pan"). Define su unidad de medida (kg, lt, unidades).</li>
            <li><b>2. Crea tus Platos y Recetas:</b> Ve a <b>Restaurante &rarr; Menú/Platos</b>. Haz clic en <i>"Nuevo Plato"</i>. Dale un nombre y precio. En la sección <b>"Receta del Plato"</b>, agrega los ingredientes que creaste en el paso anterior y la cantidad necesaria para preparar una porción de ese plato.</li>
           </ul>`
      },
      {
        q: "¿El POS del Restaurante funciona igual que el de la Tienda?",
        a: "Sí, la mecánica es prácticamente la misma. En la pestaña <b>'Registrar Venta (POS)'</b> del módulo de Restaurante, seleccionas los platos del menú, los agregas al pedido y puedes elegir entre <b>Pago Inmediato</b> (con opción de pago mixto) o <b>Cargar a Habitación</b>."
      }
    ]
  },


  {
    category: "Mi Cuenta y Suscripción",
    icon: "💳",
    questions: [
      {
        q: "¿Qué puedo hacer en la sección 'Mi Cuenta'?",
        a: "Esta es tu central de administración. Aquí puedes ver qué plan tienes, cuántos días te quedan, mejorar tu suscripción para acceder a más funciones, ver tu historial de pagos, actualizar tu contraseña y hasta ganar beneficios por referir a otros hoteles."
      },
      {
        q: "¿Cómo puedo renovar o cambiar mi plan?",
        a: `Es muy fácil. En la sección de planes, verás las opciones disponibles.
          <ul>
            <li><b>Elige la Moneda y Frecuencia:</b> Primero, selecciona si quieres pagar en Pesos (COP) o Dólares (USD) y si prefieres un plan mensual o uno anual (¡que suele tener un gran descuento!).</li>
            <li><b>Selecciona tu Plan:</b> Haz clic en el botón 'Seleccionar Plan' debajo de la opción que más te convenga.</li>
            <li><b>Confirma y Paga:</b> El sistema te llevará a una pasarela de pago segura (Wompi para COP, Mercado Pago para USD) para completar la transacción. ¡Y listo! Tu plan se actualizará automáticamente.</li>
          </ul>`
      },
      {
        q: "¿Por qué debería mejorar mi plan? ¿Qué beneficios obtengo?",
        a: "¡Mejorar tu plan desbloquea todo el potencial del sistema! Al pasar a un plan superior, obtienes acceso a herramientas avanzadas como la <strong>sincronización con Google Calendar</strong> (para importar reservas de Booking y Airbnb), <strong>módulos de restaurante y tienda</strong>, y la capacidad de gestionar <strong>más habitaciones y usuarios</strong>. Es la mejor inversión para automatizar y profesionalizar la gestión de tu hotel."
      },
      {
        q: "Si mejoro mi plan a la mitad del mes, ¿pierdo el dinero que ya pagué?",
        a: "¡Para nada! El sistema es justo. Calculamos automáticamente el crédito de los días que no usaste de tu plan actual y lo descontamos del precio del nuevo plan. Solo pagarás la diferencia. A esto se le llama 'prorrateo'."
      },
      {
        q: "¿Qué pasa si elijo un plan más económico (downgrade)?",
        a: "Si decides cambiar a un plan inferior, tu plan actual seguirá activo hasta que termine el periodo que ya pagaste. Una vez que venza, tu cuenta se cambiará automáticamente al nuevo plan más económico que seleccionaste."
      },
      {
        q: "¿Por qué un plan me aparece como 'No elegible'?",
        a: "Esto sucede si tu hotel ya supera los límites de ese plan. Por ejemplo, si un plan solo permite 10 habitaciones y tu hotel ya tiene 15 registradas, el sistema lo marcará como 'No elegible' para evitar que elijas un plan que no se ajusta a tus necesidades actuales."
      },
      {
        q: "¿Cómo funciona el programa de referidos?",
        a: "¡Es una forma de ganar beneficios! En 'Mi Cuenta', encontrarás tu enlace único de referido. Compártelo con otros hoteleros. Si alguien se registra y se suscribe a un plan de pago usando tu enlace, ¡ambos reciben una recompensa! Es nuestra forma de agradecerte por confiar en nosotros."
      },
      {
        q: "¿Dónde puedo ver mis pagos anteriores?",
        a: "En la parte inferior de la página de 'Mi Cuenta', encontrarás una sección llamada 'Historial de Pagos'. Allí tendrás un registro detallado de todas las transacciones que has realizado."
      }
    ]
  },
  
  {
    category: "Administración y Configuración",
    icon: "⚙️",
    questions: [
        {
            q: "¿Para qué sirve el módulo de Configuración?",
            a: "Piensa en este módulo como el 'panel de control' de tu hotel. Aquí defines todas las reglas fundamentales: los datos de tu negocio para los recibos, cómo se calculan los impuestos, los métodos de pago que aceptas, las políticas del hotel y cómo se imprimen los documentos. Configurar esto correctamente es esencial para que todos los demás módulos funcionen como esperas."
        },
        {
            q: "¿Por qué debo llenar la Información Fiscal (NIT, Dirección, etc.)?",
            a: "Esta información se usa automáticamente cuando el sistema genera documentos oficiales como tickets o facturas. Llenarla por completo asegura que tus documentos se vean profesionales y cumplan con las regulaciones locales."
        },
        {
            q: "¿Cómo funcionan los impuestos? ¿Principal vs. Restaurante?",
            a: `El sistema maneja dos tipos de impuestos:
              <ul>
                <li><b>Impuesto Principal:</b> Es tu impuesto general (como el IVA). Aplica a las tarifas de las habitaciones y a los productos de la tienda.</li>
                <li><b>Impuesto del Restaurante:</b> Es un impuesto especial que <i>solo</i> aplica a las ventas del módulo de restaurante (útil para el Impoconsumo en Colombia, por ejemplo).</li>
              </ul>
              Para ambos, puedes especificar si tus precios ya <b>incluyen</b> el impuesto (el sistema lo desglosará en la factura) o si debe ser <b>sumado</b> al final.`
        },
        {
            q: "¿Cómo agrego o desactivo métodos de pago como Nequi o Daviplata?",
            a: `En la sección "Métodos de Pago", verás una tabla con tus opciones actuales.
              <ul>
                <li>Para <b>agregar</b> uno nuevo, haz clic en el botón "+ Agregar Método de Pago".</li>
                <li>Para <b>editar</b> el nombre de uno existente, haz clic en el ícono del lápiz (✏️).</li>
                <li>Para <b>desactivar</b> un método (para que no aparezca en las opciones de pago), haz clic en el ícono de la 'X' (❌). Podrás reactivarlo después con el ícono de la marca de verificación (✅).</li>
              </ul>`
        },
        {
            q: "¿Qué significa la 'Política de Cobro' (al Check-in o Check-out)?",
            a: `Esta es una regla clave que afecta al módulo de Reservas:
              <ul>
                <li><b>Cobro al Check-in:</b> El sistema exigirá que una reserva esté totalmente pagada antes de permitir que el recepcionista haga el check-in.</li>
                <li><b>Cobro al Check-out:</b> El sistema permitirá hacer el check-in sin pago por adelantado. El cobro total se gestionará al final de la estancia del huésped.</li>
              </ul>`
        },
        {
            q: "¿Cómo personalizo mis tickets con mi logo y textos?",
            a: "Usa la sección 'Personalización de Documentos'. Puedes subir el logo de tu hotel para que aparezca en los documentos impresos. También puedes escribir textos personalizados para el encabezado y el pie de página de tus tickets, ideal para añadir información de contacto, detalles legales o un mensaje de agradecimiento."
        },
        {
            q: "¿Para qué sirve la 'Configuración de Impresión'?",
            a: "Esta opción le dice al sistema cómo formatear los tickets impresos. Puedes elegir entre diferentes tamaños de papel, como <b>58mm</b> o <b>80mm</b> para impresoras térmicas de recibos, o un tamaño <b>Carta/A4</b> para impresoras estándar. El sistema ajustará el diseño automáticamente."
        },
        {
            q: "¿Los cambios se guardan por sección o todos a la vez?",
            a: "Todos a la vez. Puedes realizar todos los ajustes que necesites en las diferentes secciones. Cuando termines, baja hasta el final y haz clic en el único botón de <b>'Guardar Configuración'</b> para aplicar todos tus cambios de una sola vez."
        }
    ]
  }

];

export function mount(container, supabase, user) {
  let html = `
    <style>
      .faq-container { max-width: 800px; margin: 20px auto; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
      .faq-category { margin-bottom: 1rem; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; }
      .faq-category-title {
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: 100%;
        padding: 1rem 1.5rem;
        font-size: 1.5rem;
        font-weight: 700;
        color: #1e3a8a;
        background-color: #f9fafb;
        border: none;
        border-bottom: 1px solid #e5e7eb;
        cursor: pointer;
        transition: background-color 0.2s;
      }
      .faq-category-title:hover { background-color: #f3f4f6; }
      .faq-category-title .title-text { display: flex; align-items: center; gap: 0.75rem; }
      .faq-category-title .category-icon { transition: transform 0.3s ease; font-size: 1.5rem; color: #3b82f6; }
      .faq-category-title.open .category-icon { transform: rotate(135deg); }
      .faq-list.collapsed {
        display: none;
      }
      .faq-item { border-top: 1px solid #e5e7eb; }
      .faq-question { display: flex; justify-content: space-between; align-items: center; width: 100%; text-align: left; padding: 1rem 1.5rem; font-size: 1.1rem; font-weight: 600; color: #1f2937; background: none; border: none; cursor: pointer; }
      .faq-question:hover { background-color: #f9fafb; }
      .faq-question .icon { transition: transform 0.3s ease; font-size: 1.5rem; color: #3b82f6; }
      .faq-item.open .faq-question .icon { transform: rotate(45deg); }
      .faq-answer { display: none; padding: 1rem 1.5rem 1.5rem; color: #4b5563; line-height: 1.6; border-left: 3px solid #60a5fa; background-color: #f3f4f6; margin: 0 1rem; }
      .faq-answer ul { list-style-type: disc; padding-left: 20px; margin-top: 0.5rem; }
      .faq-answer ul li { margin-bottom: 0.5rem; }
      .faq-item.open .faq-answer { display: block; }

      /* --- INICIO DE LA CORRECCIÓN CLAVE --- */
      .video-grid {
        display: flex; /* Cambiado de grid a flex */
        flex-wrap: wrap; /* Permite que los elementos pasen a la siguiente línea */
        gap: 1rem;
        padding: 0 1.5rem 1.5rem;
      }
      .video-thumbnail-container {
        flex: 0 1 280px; /* No crece, puede encogerse, con un ancho base de 280px */
        position: relative;
        cursor: pointer;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 4px 8px rgba(0,0,0,0.1);
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }
       /* --- FIN DE LA CORRECCIÓN CLAVE --- */

      .video-thumbnail-container:hover { transform: translateY(-5px); box-shadow: 0 6px 12px rgba(0,0,0,0.15); }
      .video-thumbnail-container img { width: 100%; height: auto; display: block; }
      .play-icon { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 3rem; color: white; background-color: rgba(0, 0, 0, 0.5); border-radius: 50%; width: 60px; height: 60px; display: flex; align-items: center; justify-content: center; line-height: 60px; text-shadow: 0 0 10px black; pointer-events: none; }
      .video-title { position: absolute; bottom: 0; left: 0; right: 0; background: linear-gradient(to top, rgba(0,0,0,0.8), transparent); color: white; padding: 1rem 0.5rem 0.5rem; font-size: 0.9rem; font-weight: bold; text-align: center; margin: 0; }
      .video-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.85); display: none; align-items: center; justify-content: center; z-index: 1000; }
      .video-modal-content { position: relative; width: 90%; max-width: 900px; max-height: 80%; }
      .video-modal-close { position: absolute; top: -40px; right: 0; color: white; font-size: 2.5rem; font-weight: bold; cursor: pointer; }
    </style>
  `;

  faqData.forEach((category, index) => {
    const categoryContentId = `category-content-${index}`;
    const isCollapsed = index === 0 ? '' : 'collapsed';
    const isOpen = index === 0 ? 'open' : '';

    html += `
        <section class="faq-category">
        <button class="faq-category-title ${isOpen}" data-target="${categoryContentId}">
            <span class="title-text">
                <span class="text-3xl">${category.icon}</span>
                ${category.category}
            </span>
            <span class="category-icon">+</span>
        </button>
        <div id="${categoryContentId}" class="faq-list ${isCollapsed}">
    `;
    category.questions.forEach((item) => {
        html += `
        <div class="faq-item">
            <button class="faq-question">
            <span>${item.q}</span>
            <span class="icon">+</span>
            </button>
            <div class="faq-answer">
            ${item.a}
            </div>
        </div>
        `;
    });

    // Lógica para añadir videos
    if (category.category === "Mapa de Habitaciones") {
        html += `<div class="faq-video-tutorials mt-6"><h3 class="text-xl font-bold mb-2 text-blue-800 px-6">Tutoriales en Video: Mapa de Habitaciones</h3><div class="video-grid"><div class="video-thumbnail-container" data-video-src="https://drive.google.com/file/d/1oWUNcFIWfsBbKFsrAhdSUpTnMmuPefPr/view?usp=sharing"><img src="../js/modules/faq/mapa_thumbnail.png" alt="Video sobre el Mapa de Habitaciones"><div class="play-icon">▶</div><p class="video-title">Tutorial: Gestión desde el Mapa</p></div></div></div>`;
    }
    if (category.category === "Reservas") {
        html += `<div class="faq-video-tutorials mt-6"><h3 class="text-xl font-bold mb-2 text-blue-800 px-6">Tutoriales en Video: Reservas</h3><div class="video-grid"><div class="video-thumbnail-container" data-video-src="https://drive.google.com/file/d/1gJUJW0lix9a4WhKMCr0BH8Q2geC6E60c/view?usp=sharing"><img src="../js/modules/faq/reservas_thumbnail.png" alt="Video sobre el Módulo de Reservas"><div class="play-icon">▶</div><p class="video-title">Tutorial: Gestión de Reservas</p></div></div></div>`;
    }
    if (category.category === "Caja y Turnos") {
        html += `<div class="faq-video-tutorials mt-6"><h3 class="text-xl font-bold mb-2 text-blue-800 px-6">Tutoriales en Video: Caja y Turnos</h3><div class="video-grid"><div class="video-thumbnail-container" data-video-src="https://drive.google.com/file/d/1xp3yF-WVvW0Z_z7OlCWCBRFV3OU0pdyA/view?usp=sharing"><img src="../js/modules/faq/Caja_thumbnail.png" alt="Video sobre Gestión de Caja y Turnos"><div class="play-icon">▶</div><p class="video-title">Tutorial: Gestión de Caja y Turnos</p></div></div></div>`;
    }
    if (category.category === "Tienda y Restaurante") {
        html += `<div class="faq-video-tutorials mt-6"><h3 class="text-xl font-bold mb-2 text-blue-800 px-6">Tutoriales en Video: Punto de Venta</h3><div class="video-grid"><div class="video-thumbnail-container" data-video-src="https://drive.google.com/uc?export=preview&id=1k1DPYeV2cS2_tgJZnBXgtHFoqN8h0fvc"><img src="../js/modules/faq/Tienda_thumbnail.png" alt="Video sobre POS de Tienda"><div class="play-icon">▶</div><p class="video-title">Tutorial: Punto de Venta (Tienda)</p></div><div class="video-thumbnail-container" data-video-src="https://drive.google.com/uc?export=preview&id=11EfslLEER9wDRjUr_QNUzWCWMhWxhsf2"><img src="../js/modules/faq/Restaurante_thumbnail.png" alt="Video sobre POS de Restaurante"><div class="play-icon">▶</div><p class="video-title">Tutorial: Punto de Venta (Restaurante)</p></div></div></div>`;
    }
    html += `</div></section>`;
    });

  html += `
      <div id="video-modal" class="video-modal">
        <div class="video-modal-content">
          <span id="video-modal-close" class="video-modal-close">&times;</span>
          <div id="video-player-container"></div>
        </div>
      </div>
    </div>`;

  container.innerHTML = html;

  // Lógica para preguntas individuales
  container.querySelectorAll('.faq-question').forEach(button => {
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = button.closest('.faq-item');
      item.classList.toggle('open');
    });
  });

  // Lógica para categorías plegables
  container.querySelectorAll('.faq-category-title').forEach(button => {
    button.addEventListener('click', () => {
        const targetId = button.dataset.target;
        const content = document.getElementById(targetId);
        
        button.classList.toggle('open');
        content.classList.toggle('collapsed');
    });
  });

  // Lógica para videos
  const modal = container.querySelector('#video-modal');
  const modalClose = container.querySelector('#video-modal-close');
  const videoPlayerContainer = container.querySelector('#video-player-container');
  container.querySelectorAll('.video-thumbnail-container').forEach(thumb => {
    thumb.addEventListener('click', () => {
        const videoSrc = thumb.getAttribute('data-video-src');
        if (videoSrc) {
            let driveId = '';
            const match = videoSrc.match(/\/d\/([^/]+)/) || videoSrc.match(/id=([^&]+)/);
            if (match) driveId = match[1];
            
            videoPlayerContainer.innerHTML = `<iframe width="100%" height="480" src="https://drive.google.com/file/d/${driveId}/preview" allow="autoplay" allowfullscreen style="border:0;border-radius:12px;"></iframe>`;
            modal.style.display = 'flex';
        }
    });
  });
  const closeModal = () => {
    modal.style.display = 'none';
    videoPlayerContainer.innerHTML = ''; 
  };
  modalClose.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
}

export function unmount(container) {
  // Limpia el contenido al desmontar el módulo
  container.innerHTML = '';
}