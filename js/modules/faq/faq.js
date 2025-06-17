// js/modules/faq/faq.js

/**
 * Módulo de Preguntas Frecuentes (FAQ) DETALLADO
 * Muestra una lista organizada y específica de preguntas y respuestas sobre las funcionalidades de cada módulo de la aplicación.
 */

// Datos de las preguntas y respuestas, organizadas por categoría y funcionalidad.
const faqData = [
  {
    category: "Mapa de Habitaciones",
    icon: "🗺️",
    questions: [
      {
        q: "¿Qué significan los colores en las tarjetas de las habitaciones?",
        a: "Los colores te indican el estado del tiempo de la estancia:<ul><li><b>Verde:</b> La estancia tiene tiempo de sobra.</li><li><b>Naranja:</b> Quedan menos de 30 minutos.</li><li><b>Amarillo:</b> Quedan menos de 15 minutos.</li><li><b>Rojo y Parpadeando:</b> ¡El tiempo se ha agotado! La habitación está en estado 'tiempo agotado'.</li></ul>"
      },
      {
        q: "¿Qué opciones tengo al hacer clic en una habitación?",
        a: "Abre un menú de acciones rápidas que cambia según el estado de la habitación. Por ejemplo, para una habitación 'Libre' verás 'Alquilar Ahora', mientras que para una 'Ocupada' verás 'Extender Tiempo', 'Ver Consumos', 'Servicios Adicionales', etc.."
      },
      {
        q: "¿Cómo funciona 'Alquilar Ahora'?",
        a: "Esta opción, para habitaciones libres, abre un completo formulario de alquiler tipo POS. Aquí puedes:<ul><li>Buscar un cliente existente o registrar uno nuevo.</li><li>Seleccionar la duración por noches o por horas predefinidas.</li><li>Ajustar la cantidad de huéspedes.</li><li>Aplicar descuentos por código, por cliente o automáticos.</li><li>Registrar el pago con uno o varios métodos (pago mixto).</li></ul>"
      },
      {
        q: "¿Qué información veo en 'Ver Consumos'?",
        a: "Abre un modal que muestra un resumen detallado de TODOS los cargos asociados a la reserva activa:<ul><li>El costo de la estancia principal.</li><li>Todos los productos de la tienda cargados a la habitación.</li><li>Todos los platos del restaurante cargados a la habitación.</li><li>Todos los servicios adicionales y extensiones de tiempo.</li></ul>Calcula el total de cargos, el total pagado y el saldo pendiente exacto. Desde aquí también puedes facturar."
      },
      {
        q: "¿Cómo agrego servicios (ej. lavandería) a una habitación ocupada?",
        a: "Usa el botón 'Servicios Adicionales'. Se abrirá un modal donde puedes seleccionar uno o varios servicios, indicar la cantidad y añadir una nota. Luego, te da dos opciones:<ul><li><b>Cobrar AHORA:</b> Registra el pago del servicio inmediatamente en la caja (si hay un turno abierto).</li><li><b>Cobrar al FINAL:</b> Suma el costo del servicio a la cuenta de la habitación para que se pague al momento del check-out.</li></ul>"
      },
      {
        q: "¿Puedo cambiar a un huésped de habitación?",
        a: "Sí. El botón 'Cambiar de Habitación' te permite seleccionar una habitación que esté 'Libre' y te pide un motivo para el cambio. El sistema automáticamente transfiere la reserva y el cronómetro a la nueva habitación, deja la habitación de origen en estado de 'Limpieza' y registra el cambio en una bitácora."
      },
      {
        q: "¿Qué hace el botón 'Entregar Habitación'?",
        a: "Es la función de Check-out. Antes de proceder, el sistema valida que el saldo pendiente de la habitación sea cero. Si la cuenta está saldada, la reserva se marca como 'Completada', el cronómetro se detiene y la habitación cambia su estado a 'Limpieza'."
      }
    ]
  },
  {
    category: "Reservas",
    icon: "🗓️",
    questions: [
      {
        q: "¿Cómo creo una reserva para el futuro?",
        a: "El módulo de Reservas está diseñado para esto. El formulario te permite seleccionar un cliente (o crearlo), elegir una habitación disponible para un rango de fechas específico, y calcular el total. El sistema usa una función (`validar_cruce_reserva`) para asegurarse de que no haya conflictos de disponibilidad."
      },
      {
        q: "¿Cómo se manejan los pagos de las reservas futuras?",
        a: "Depende de la política del hotel. En 'Configuración', puedes definir si el 'Cobro es al Check-in' (la opción por defecto) o al Check-out. Si es al check-in, el sistema te permitirá registrar un pago completo o un abono al momento de crear la reserva, pero también te exigirá el pago total antes de poder realizar el check-in."
      },
      {
        q: "¿Puedo sincronizar estas reservas con un calendario externo?",
        a: "Sí. El sistema está preparado para sincronizarse con Google Calendar. Al cargar el módulo, intentará buscar nuevos eventos en tu calendario conectado y los importará como nuevas reservas si no existen en el sistema. Reconoce eventos de iCal (Booking, Airbnb) y eventos creados manualmente."
      }
    ]
  },
  {
    category: "Caja y Turnos",
    icon: "💰",
    questions: [
      {
        q: "¿Por qué necesito abrir un turno?",
        a: "Es una medida de control fundamental. Todas las transacciones monetarias (ingresos y egresos) deben estar asociadas a un turno de caja y a un usuario responsable. Si no hay un turno abierto, el sistema no te permitirá registrar pagos, alquileres o ventas."
      },
      {
        q: "¿Cómo abro y cierro un turno?",
        a: "Si no hay un turno activo, el módulo de Caja te mostrará un botón grande para 'Abrir Turno', pidiéndote un monto inicial. Para cerrar, haz clic en 'Realizar Corte de Caja'. El sistema calculará automáticamente todos los totales, los desglosará por método de pago y generará un reporte detallado."
      },
      {
        q: "¿El reporte de cierre de caja se envía a algún lugar?",
        a: "Sí. Después de confirmar el corte, el sistema envía automáticamente el reporte HTML por correo a la dirección configurada en los ajustes del hotel. Una vez enviado, el turno se marca como 'Cerrado' y ya no se pueden registrar más movimientos en él."
      },
      {
        q: "Cometí un error al registrar un pago. ¿Puedo cambiar el método de pago?",
        a: "Sí. En la lista de movimientos del turno activo, cada fila tiene un ícono de lápiz (✏️) al lado del método de pago. Al hacer clic, puedes seleccionar el método correcto y guardarlo. Esto solo cambia el método, no el monto."
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
    category: "Administración y Configuración",
    icon: "⚙️",
    questions: [
        {
            q: "¿Cómo gestiono los horarios de los recepcionistas?",
            a: "En el módulo 'Usuarios', hay una sección de 'Horario Semanal de Recepción'. Allí puedes asignar manualmente los turnos para cada recepcionista y para cada día de la semana. Puedes elegir entre turnos de 8 o 12 horas según la configuración global."
        },
        {
            q: "¿Cómo se generan los horarios automáticamente?",
            a: "El sistema cuenta con un flujo de trabajo en N8N que se ejecuta cada jueves para generar los horarios de la próxima semana. Este proceso es rotativo para ser justo y evita asignar a un recepcionista el turno de mañana del lunes si trabajó el domingo por la noche. Los horarios generados se pueden ajustar manualmente después."
        },
        {
            q: "¿Dónde configuro el tamaño de los tickets de la impresora?",
            a: "En el módulo 'Configuración', dentro de la sección 'Configuración de Impresión', puedes seleccionar el tamaño del papel entre 58mm, 80mm (para impresoras térmicas) o Carta/A4 (para impresoras estándar). El sistema adaptará el formato de impresión automáticamente."
        }
    ]
  }
];

export function mount(container, supabase, user) {
  let html = `
    <style>
      .faq-container { max-width: 800px; margin: 20px auto; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
      .faq-category { margin-bottom: 2rem; }
      .faq-category-title { font-size: 1.75rem; font-weight: 700; color: #1e3a8a; border-bottom: 2px solid #3b82f6; padding-bottom: 0.5rem; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.75rem; }
      .faq-item { border-bottom: 1px solid #e5e7eb; }
      .faq-question { display: flex; justify-content: space-between; align-items: center; width: 100%; text-align: left; padding: 1rem 0.5rem; font-size: 1.1rem; font-weight: 600; color: #1f2937; background: none; border: none; cursor: pointer; transition: background-color 0.2s; }
      .faq-question:hover { background-color: #f9fafb; }
      .faq-question .icon { transition: transform 0.3s ease; font-size: 1.5rem; color: #3b82f6; }
      .faq-answer { display: none; padding: 0.5rem 1rem 1.5rem 1rem; color: #4b5563; line-height: 1.6; border-left: 3px solid #60a5fa; background-color: #f3f4f6; }
      .faq-answer ul { list-style-type: disc; padding-left: 20px; margin-top: 0.5rem; }
      .faq-answer ul li { margin-bottom: 0.5rem; }
      .faq-item.open .faq-answer { display: block; }
      .faq-item.open .faq-question .icon { transform: rotate(45deg); }
    </style>
    <div class="faq-container">
      <h1 class="text-4xl font-extrabold text-center text-gray-800 mb-10">Preguntas Frecuentes Detalladas</h1>
  `;

  faqData.forEach(category => {
    html += `
      <section class="faq-category">
        <h2 class="faq-category-title">
          <span class="text-3xl">${category.icon}</span>
          ${category.category}
        </h2>
        <div class="faq-list">
    `;
    category.questions.forEach((item, index) => {
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
    html += `</div></section>`;
  });

  html += `</div>`;
  container.innerHTML = html;

  // Lógica del acordeón
  container.querySelectorAll('.faq-question').forEach(button => {
    button.addEventListener('click', () => {
      const item = button.parentElement;
      const answer = button.nextElementSibling;
      const icon = button.querySelector('.icon');
      const isOpen = item.classList.contains('open');

      if (isOpen) {
        item.classList.remove('open');
        answer.style.display = 'none';
        icon.textContent = '+';
        icon.style.transform = 'rotate(0deg)';
      } else {
        item.classList.add('open');
        answer.style.display = 'block';
        icon.textContent = '+';
        icon.style.transform = 'rotate(45deg)';
      }
    });
  });
}

export function unmount(container) {
  container.innerHTML = '';
}