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

      /* Estilos para la cuadrícula de videos */
      .video-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 1rem;
        margin-top: 1rem;
      }

      /* Estilos para cada miniatura de video */
      .video-thumbnail-container {
        position: relative;
        cursor: pointer;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 4px 8px rgba(0,0,0,0.1);
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }
      .video-thumbnail-container:hover {
        transform: translateY(-5px);
        box-shadow: 0 6px franchising, rgba(0,0,0,0.15);
      }
      .video-thumbnail-container img {
        width: 100%;
        height: auto;
        display: block;
      }
      .play-icon {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 3rem;
        color: white;
        background-color: rgba(0, 0, 0, 0.5);
        border-radius: 50%;
        width: 60px;
        height: 60px;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 60px;
        text-shadow: 0 0 10px black;
        pointer-events: none; /* Para que no interfiera con el clic */
      }
      .video-title {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        background: linear-gradient(to top, rgba(0,0,0,0.8), transparent);
        color: white;
        padding: 1rem 0.5rem 0.5rem;
        font-size: 0.9rem;
        font-weight: bold;
        text-align: center;
        margin: 0;
      }

      /* Estilos para la ventana modal (reproductor) */
      .video-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.85);
        display: none; /* Oculto por defecto */
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }
      .video-modal-content {
        position: relative;
        width: 90%;
        max-width: 900px;
        max-height: 80%;
      }
      .video-modal-close {
        position: absolute;
        top: -40px;
        right: 0;
        color: white;
        font-size: 2.5rem;
        font-weight: bold;
        cursor: pointer;
      }
      .video-modal video {
        width: 100%;
        height: auto;
        max-height: 80vh;
      }
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

  // --- Aquí añadimos los videos SOLO al final de Tienda y Restaurante ---
  if (category.category === "Tienda y Restaurante") {
    html += `
      <div class="faq-video-tutorials mt-6">
        <h3 class="text-xl font-bold mb-2 text-blue-800">Tutoriales en Video: Punto de Venta</h3>
        <div class="video-grid">
          <div class="video-thumbnail-container" data-video-src="../js/modules/faq/Tienda.mp4">
            <img src="../js/modules/faq/Tienda_thumbnail.png" alt="Video sobre POS de Tienda">
            <div class="play-icon">▶</div>
            <p class="video-title">Tutorial: Punto de Venta (Tienda)</p>
          </div>
          <div class="video-thumbnail-container" data-video-src="../js/modules/faq/Restaurante.mp4">
            <img src="../js/modules/faq/Restaurante_thumbnail.png" alt="Video sobre POS de Restaurante">
            <div class="play-icon">▶</div>
            <p class="video-title">Tutorial: Punto de Venta (Restaurante)</p>
          </div>
        </div>
      </div>
    `;
  }
  html += `</div></section>`;
});
  

  // --- PASO 4: AQUÍ AÑADIMOS EL HTML DEL MODAL ---
  html += `
      <div id="video-modal" class="video-modal">
        <div class="video-modal-content">
          <span id="video-modal-close" class="video-modal-close">&times;</span>
          <div id="video-player-container"></div>
        </div>
      </div>
    </div>`;

  container.innerHTML = html;

  // --- Lógica original del acordeón (se mantiene igual) ---
  container.querySelectorAll('.faq-question').forEach(button => {
    button.addEventListener('click', () => {
      const item = button.parentElement;
      // ... (resto de la lógica del acordeón)
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

  // --- PASO 5: AQUÍ AÑADIMOS LA LÓGICA JAVASCRIPT PARA LOS VIDEOS ---
  const modal = container.querySelector('#video-modal');
  const modalClose = container.querySelector('#video-modal-close');
  const videoPlayerContainer = container.querySelector('#video-player-container');

  container.querySelectorAll('.video-thumbnail-container').forEach(thumb => {
    thumb.addEventListener('click', () => {
      const videoSrc = thumb.getAttribute('data-video-src');
      if (videoSrc) {
        // Crea el elemento de video y lo añade al modal
        videoPlayerContainer.innerHTML = `
          <video controls autoplay>
            <source src="${videoSrc}" type="video/mp4">
            Tu navegador no soporta la etiqueta de video.
          </video>
        `;
        modal.style.display = 'flex'; // Muestra el modal
      }
    });
  });

  // Función para cerrar el modal
  const closeModal = () => {
    modal.style.display = 'none'; // Oculta el modal
    videoPlayerContainer.innerHTML = ''; // Detiene y elimina el video
  };

  modalClose.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    // Cierra el modal si se hace clic en el fondo oscuro, pero no en el video
    if (e.target === modal) {
      closeModal();
    }
  });
}

export function unmount(container) {
  // Limpia el contenido al desmontar el módulo
  container.innerHTML = '';
}