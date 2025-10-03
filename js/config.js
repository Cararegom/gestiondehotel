// js/config.js

export const APP_CONFIG = {
  defaultLanguage: 'es',
  // Otras configuraciones globales de la aplicación
};

export const I18N_TEXTS = {
  es: {
    limpieza: {
      title: "Gestión de Limpieza de Habitaciones",
      pendingTitle: "Habitaciones Pendientes de Limpieza",
      loadingPending: "Cargando habitaciones pendientes…",
      nonePending: "No hay habitaciones pendientes por limpiar.",
      errorLoadingPending: "Error cargando las habitaciones pendientes",
      manualTitle: "Confirmar Limpieza Manual",
      roomNameLabel: "Nombre/Número de Habitación",
      roomNamePlaceholder: "Ej: 101, Suite Presidencial",
      confirmButton: "Confirmar Limpieza Completada",
      confirmingButton: "Confirmando...",
      errorNoHotelId: "Error: Hotel no identificado. No se puede gestionar la limpieza.",
      errorFetchingHotelId: "Error crítico: No se pudo obtener la información del hotel para el módulo de limpieza.",
      errorRoomNameRequired: "El nombre o número de la habitación es obligatorio.",
      errorRoomNotFoundForUpdate: "Habitación '{habitacionNombre}' no encontrada o no pertenece a este hotel.",
      errorConfirmingCleaning: "Error al confirmar la limpieza de la habitación. Detalles: {details}",
      successMessage: "Limpieza de la habitación '{habitacionNombre}' confirmada y registrada.",
      notificationMessage: "La habitación '{habitacionNombre}' ha sido marcada como limpia y está lista.",
    },
    tienda: {
      moduleTitle: "Gestión de Tienda/Minimarket",
      tabPOS: "Punto de Venta (POS)",
      tabInventory: "Inventario Productos",
      tabSuppliers: "Proveedores",
      tabCategories: "Categorías Prod.",
      tabShoppingList: "Lista de Compra",
      pos: {
        title: "Punto de Venta (Tienda)",
        availableProducts: "Productos Disponibles",
        currentOrder: "Pedido Actual",
        total: "Total",
        chargeMode: "Forma de Cobro",
        chargeImmediate: "Pago Inmediato",
        chargeToRoom: "Cargar a Habitación",
        selectReservationForCharge: "Seleccionar Reserva para Cargo",
        paymentMethod: "Método de Pago",
        clientNameOptional: "Nombre Cliente (Opcional)",
        clientNamePlaceholder: "Para boleta/factura",
        finalizeSaleButton: "Finalizar y Pagar",
        cartEmpty: "El carrito está vacío."
      },
      loadingReservations: "Cargando reservaciones...",
      selectReservation: "-- Cargar a Reserva --",
      noActiveReservations: "No hay reservaciones activas (check-in)",
      errorLoadingReservations: "Error cargando reservaciones",
      errorLoadingData: "Error cargando datos: {details}",
      errorUserNotAuthenticated: "Usuario no autenticado.",
      errorCartEmpty: "El carrito está vacío. Agregue productos.",
      errorSelectReservation: "Debe seleccionar una reservación para cargar a la habitación.",
      errorSelectPaymentMethod: "Debe seleccionar un método de pago para pago inmediato.",
      processingSale: "Procesando venta...",
      successChargedToRoom: "Venta cargada a la habitación exitosamente.",
      successSaleRegistered: "Venta registrada exitosamente (ID: {ventaId}).",
      errorRegisteringSale: "Error al registrar la venta. {details}",
      loadingTab: "Cargando pestaña {tabName}...",
      tabNotImplemented: "Pestaña {tabName} aún no implementada.",
      errorLoadingTabContent: "Error al cargar contenido de la pestaña. {details}",
      errorCriticalHotelIdMissing: "Error crítico: Hotel no identificado. Módulo de tienda deshabilitado.",
      errorInitialLoad: "Error en la carga inicial de datos para la tienda. {details}",
      inventory: {
        title: "Gestión de Inventario",
        addProductButton: "＋ Agregar Producto",
        exportButton: "Exportar a Excel",
        generateCatalogButton: "Generar Catálogo PDF",
        moveStockButton: "Registrar Movimiento de Stock"
      },
      suppliers: {
        title: "Gestión de Proveedores",
        addSupplierButton: "＋ Agregar Proveedor"
      },
      categories: {
        title: "Gestión de Categorías de Productos",
        categoryNameLabel: "Nombre Categoría",
        saveCategoryButton: "Guardar Categoría"
      },
      shoppingList: {
        title: "Lista de Compra Inteligente",
        generateButton: "Generar Lista Sugerida",
        exportButton: "Exportar Lista",
        shoppingListPrompt: "Haga clic en 'Generar Lista' para ver productos con stock bajo o por agotarse."
      },
      modalTitleAddProduct: "Agregar Nuevo Producto",
      modalTitleEditProduct: "Editar Producto",
      modalTitleAddSupplier: "Agregar Nuevo Proveedor",
      modalTitleEditSupplier: "Editar Proveedor",
    },
    // ... otros módulos ...
  },
  // en: { ... } // Para inglés u otros idiomas
};

export const ROOM_STATUS_OPTIONS = {
  libre:               { key: 'libre',                text: 'Libre',              color: 'green' },
  ocupada:             { key: 'ocupada',              text: 'Ocupada',            color: 'red'   },
  limpieza:            { key: 'limpieza',             text: 'En Limpieza',        color: 'blue'  },
  pendiente_limpieza:  { key: 'pendiente_limpieza',   text: 'Pendiente de Limpieza', color: 'yellow' },
  mantenimiento:       { key: 'mantenimiento',        text: 'En Mantenimiento',   color: 'orange'},
  bloqueada:           { key: 'bloqueada',            text: 'Bloqueada',          color: 'grey'  },
  disponible:          { key: 'disponible',           text: 'Disponible',         color: 'green' },
  // ... otros estados que puedas necesitar ...
};

export const DEFAULT_CURRENCY = 'COP';
