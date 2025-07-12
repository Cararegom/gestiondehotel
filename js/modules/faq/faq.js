// js/modules/faq/faq.js

/**
 * Módulo de Preguntas Frecuentes (FAQ) DETALLADO
 * Muestra una lista organizada y específica de preguntas y respuestas sobre las funcionalidades de cada módulo de la aplicación.
 */

// Datos de las preguntas y respuestas, organizadas por categoría y funcionalidad.
const faqData = [
  // ... (Las otras categorías como "Mapa de Habitaciones", "Reservas", etc., se mantienen igual)
  {
  category: "Mapa de Habitaciones",
  icon: "🗺️",
  questions: [
    {
      q: "¿Qué es el Mapa de Habitaciones y para qué sirve?",
      a: "Es la vista principal para gestionar el hotel de forma visual. Desde aquí puedes ver rápidamente el estado de todas las habitaciones (libre, ocupada, reservada, limpieza, mantenimiento, bloqueada, etc.) y acceder a todas las acciones importantes como alquilar, entregar reservas, ver información del huésped, facturar, y más."
    },
    {
  q: "¿Qué significan los colores y los estados en las tarjetas de las habitaciones?",
  a: `<ul>
    <li><b style="color:#22c55e">Verde (LIBRE):</b> Habitación disponible para alquilar.</li>
    <li><b style="color:#facc15">Amarillo (OCUPADA):</b> Habitación actualmente ocupada por un cliente hospedado.</li>
    <li><b style="color:#06b6d4">Celeste (LIMPIEZA):</b> Habitación pendiente de limpieza.</li>
    <li><b style="color:#a78bfa">Morado (RESERVADA):</b> Habitación reservada para un cliente.</li>
    <li><b style="color:#f87171">Rojo (TIEMPO AGOTADO o EXCEDIDO):</b> Se acabó o se excedió el tiempo de estadía; la habitación debe ser liberada.</li>
    <li><b style="color:#6b7280">Gris (BLOQUEADA / MANTENIMIENTO):</b> Habitación no disponible por mantenimiento o bloqueo.</li>
  </ul>`
},

    {
      q: "¿Cómo alquilo una habitación directamente desde el mapa?",
      a: "Haz clic sobre una tarjeta de habitación que esté en estado 'Libre' (color verde). Luego selecciona 'Alquilar Ahora', completa el formulario con los datos del huésped y el tipo de alquiler (por horas, noche, día completo, etc.) y confirma. La habitación cambiará automáticamente a 'Ocupada'."
    },
    {
      q: "¿Qué hago cuando llega un cliente con reserva?",
      a: "Ubica la habitación marcada como 'Reservada' (azul) y haz clic en ella. Selecciona la opción 'Entregar Reserva', verifica los datos del cliente y confirma el check-in. La habitación pasará a estado 'Ocupada'."
    },
    {
      q: "¿Cómo agrego servicios o consumos a una habitación ocupada?",
      a: "Haz clic en la habitación en estado 'Ocupada'. Selecciona la opción 'Ver consumos' o 'Servicios Adicionales'. Aquí podrás agregar productos, restaurante, lavandería, minibar, etc. Todos los consumos quedarán registrados y se sumarán a la factura al momento del check-out."
    },
    {
      q: "¿Puedo extender el tiempo de una habitación que está por vencer?",
      a: "Sí. Si ves que una habitación ocupada está por agotarse (naranja o parpadeando), haz clic en ella y selecciona 'Extender tiempo'. Elige el nuevo tiempo o tarifa y confirma. El contador de tiempo se actualizará automáticamente."
    },
    {
      q: "¿Cómo facturo y libero una habitación?",
      a: "Cuando el huésped se retira, haz clic en la habitación ocupada y selecciona 'Facturar/Check-out'. Verifica los cargos y consumos, selecciona el método de pago y finaliza la factura. Al terminar, la habitación pasará a estado 'Pendiente de limpieza'."
    },
    {
      q: "¿Cómo marco una habitación como limpia después del check-out?",
      a: "Cuando la habitación esté en estado 'Pendiente de limpieza' (amarillo), haz clic en ella y selecciona 'Marcar como limpia' después de que el personal haya terminado. La habitación volverá a estar 'Libre' y disponible para el siguiente huésped."
    },
    {
      q: "¿Qué hago si una habitación necesita ser reparada o no debe ser usada?",
      a: "Haz clic en la habitación y selecciona 'Enviar a mantenimiento' o 'Bloquear habitación'. Indica el motivo (si es necesario). La habitación quedará en gris y no podrá ser alquilada ni reservada hasta que la reabras manualmente."
    },
    {
      q: "¿Cómo consulto los datos del huésped y el historial de la habitación?",
      a: "Haz clic en cualquier habitación ocupada y elige 'Ver información del huésped'. Verás nombre, documento, fechas de ingreso/salida, consumos y notas. Para ver el historial completo de ocupaciones, selecciona 'Ver historial de habitación'."
    },
    {
      q: "¿Por qué no puedo alquilar o reservar una habitación?",
      a: "Verifica que la habitación no esté en estado 'Ocupada', 'Pendiente de limpieza', 'Mantenimiento' o 'Bloqueada'. Solo las habitaciones en estado 'Libre' pueden ser alquiladas o reservadas."
    },
    {
      q: "¿Qué hago si el estado de una habitación no cambia o se ve incorrecto?",
      a: "Recarga la página y verifica que el estado se actualice. Si el problema persiste, consulta con el administrador o soporte técnico. Puede deberse a una acción no finalizada (por ejemplo, falta facturar o limpiar)."
    },
    {
      q: "¿Puedo mover a un huésped de una habitación a otra?",
      a: "Sí. Haz clic en la habitación ocupada y selecciona 'Cambiar de habitación'. Elige la nueva habitación disponible y confirma. El sistema moverá toda la cuenta y consumos automáticamente."
    },
    {
      q: "¿Cómo sé cuánto tiempo le queda a una habitación por horas?",
      a: "Cada tarjeta muestra un contador visual (tiempo restante). Los colores cambian de verde a naranja y luego rojo según el tiempo. Si el tiempo se agota, la habitación cambiará a 'tiempo agotado' (rojo parpadeando) hasta que la factures o extiendas el tiempo."
    },
    {
      q: "¿Qué debo hacer si un cliente se va antes de que acabe su tiempo?",
      a: "Haz clic en la habitación, selecciona 'Facturar/Check-out', realiza el proceso de salida normal y la habitación pasará a pendiente de limpieza."
    }
  ]
}
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
        q: "¿Qué es y para qué sirve el módulo de Caja?",
        a: "Es el centro de control financiero de tu hotel. Cada vez que se recibe dinero (por un alquiler, una venta en la tienda) o se gasta dinero (compras a proveedores, gastos varios), debe quedar registrado aquí. Funciona con un sistema de 'turnos' para que siempre se sepa quién fue el responsable de las transacciones en un momento determinado."
      },
      {
        q: "¿Por qué es obligatorio abrir un turno?",
        a: "Es una medida de seguridad y control indispensable. Sin un turno de caja activo, el sistema bloquea cualquier operación que involucre dinero (alquilar, vender, registrar gastos). Esto garantiza que cada peso que entra o sale esté asociado a un recepcionista y a un periodo de tiempo específico, lo que facilita los arqueos y la contabilidad."
      },
      {
        q: "¿Cómo abro un turno de caja?",
        a: "Si no hay un turno activo, verás un botón grande que dice 'Abrir Turno'. Al hacer clic, el sistema te pedirá el 'monto inicial' o 'base' con el que comienzas a trabajar (el efectivo que tienes en el cajón). Una vez ingresado, el turno se abre y ya puedes realizar operaciones."
      },
      {
        q: "¿Cómo registro un gasto (egreso)?",
        a: "En la sección 'Agregar Nuevo Movimiento', selecciona 'Egreso' en el tipo, escribe el monto, elige el método de pago (ej. 'Efectivo' si salió del cajón) y describe claramente el concepto (ej. 'Compra de productos de limpieza'). Luego, haz clic en 'Agregar Movimiento'."
      },
      {
        q: "¿Cómo realizo el Corte de Caja (cierre de turno)?",
        a: "Al final de tu jornada, haz clic en el botón 'Realizar Corte de Caja'. El sistema te mostrará un resumen detallado con todos los ingresos y egresos, desglosados por cada método de pago (Efectivo, Tarjeta, etc.). Revisa que todo esté correcto y luego presiona 'Confirmar Corte y Enviar'. Esto cerrará tu turno y enviará un reporte detallado por correo electrónico a los administradores."
      },
      {
        q: "¿Qué es el 'Modo Supervisión' para administradores?",
        a: "Es una función avanzada que permite a un administrador ver y gestionar el turno activo de otro recepcionista. Para usarlo, un administrador hace clic en 'Ver Turnos Abiertos', selecciona el turno de un empleado y elige 'Gestionar Turno'. La pantalla cambiará a una vista especial donde el administrador puede registrar movimientos o incluso forzar el cierre de ese turno si es necesario."
      },
      {
        q: "¿Puedo eliminar un movimiento si me equivoqué?",
        a: "Sí, pero solo los usuarios con rol de 'Administrador' pueden hacerlo. Al lado de cada movimiento, verán un ícono de bote de basura. Por seguridad, al eliminar un movimiento, este no desaparece por completo, sino que se mueve a un 'Historial de Movimientos Eliminados' para que siempre haya un registro de la acción."
      },
      {
        q: "¿Dónde puedo ver los movimientos que se han eliminado?",
        a: "Los administradores tienen un botón llamado 'Ver Eliminados'. Al hacer clic, se abre una ventana que muestra un registro de auditoría con cada movimiento que fue eliminado, quién lo eliminó y en qué fecha."
      },
      {
        q: "¿Cómo imprimo el reporte de mi corte de caja?",
        a: "Después de hacer clic en 'Realizar Corte de Caja' y antes de confirmar, verás un botón con un ícono de impresora (🖨️). Al presionarlo, se generará un ticket con el resumen del turno, formateado automáticamente para el tipo de impresora que tengas configurada (térmica de 58mm, 80mm o una impresora de tamaño carta)."
      }
    ]
  },


  {
    category: "Tienda y Restaurante",
    icon: "🍔",
    questions: [
      {
        q: "¿Puedo vender productos de la tienda y del restaurante?",
        a: "Sí, ambos módulos tienen una interfaz de Punto de Venta (POS). Puedes buscar productos por nombre o código, agregarlos a un carrito y procesar el pago. Para el restaurante, además puedes gestionar las categorías de los platos y las recetas (ingredientes)."
      },
      {
        q: "¿Cómo se registra una compra a un proveedor?",
        a: "En la pestaña 'Compras' del módulo de Tienda, puedes seleccionar un proveedor, elegir los productos que estás comprando, e indicar la cantidad y el precio de compra. Al registrarla, la compra queda en estado 'pendiente'."
      },
      {
        q: "¿Cómo ingreso al inventario los productos que compré?",
        a: "En la pestaña 'Compras Pendientes', verás la lista de compras por recibir. Al hacer clic en 'Recibir Pedido', puedes confirmar las cantidades que llegaron (que pueden ser parciales). Al confirmar, el sistema actualiza automáticamente el stock de cada producto y registra el egreso en la caja con el método de pago que selecciones."
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