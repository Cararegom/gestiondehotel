const SANDBOX_KEY = 'gestiondehotel-sandbox-v1';

const scenarios = [
  {
    id: 'hotel-urbano',
    name: 'Hotel urbano',
    description: 'Escenario equilibrado con ocupación media y foco en reservas por noche.',
    metrics: {
      ocupacion: '68%',
      llegadas: '9',
      salidas: '7',
      ventaExtra: '$ 420.000'
    },
    highlights: [
      'Recepción con flujo normal y 2 check-ins prioritarios.',
      'Caja del día con buen mix entre efectivo y transferencia.',
      'Mantenimiento con 1 preventiva programada.'
    ],
    timeline: [
      '08:00 a. m. Llegada grupo corporativo · 3 habitaciones',
      '11:30 a. m. Checkout de larga estadía · Hab. 204',
      '03:00 p. m. Venta adicional destacada en tienda'
    ]
  },
  {
    id: 'motel-horas',
    name: 'Motel por horas',
    description: 'Escenario de alta rotación para revisar tiempos, caja y ocupación rápida.',
    metrics: {
      ocupacion: '82%',
      llegadas: '18',
      salidas: '17',
      ventaExtra: '$ 180.000'
    },
    highlights: [
      'Mayor presión sobre limpieza y cronómetros.',
      'Caja con micro movimientos frecuentes.',
      'Conviene monitorear extensiones y tiempo agotado.'
    ],
    timeline: [
      '10:15 a. m. Extensión de estancia · Hab. 12',
      '02:40 p. m. Pico de ocupación · 3 habitaciones por liberar',
      '08:00 p. m. Inicio de franja alta nocturna'
    ]
  },
  {
    id: 'hostal-demo',
    name: 'Hostal demo',
    description: 'Escenario orientado a onboarding, equipo pequeño y operación sencilla.',
    metrics: {
      ocupacion: '41%',
      llegadas: '4',
      salidas: '3',
      ventaExtra: '$ 95.000'
    },
    highlights: [
      'Ideal para practicar reservas, caja y soporte.',
      'Equipo pequeño con permisos básicos.',
      'Poca presión operativa, útil para capacitación.'
    ],
    timeline: [
      '09:00 a. m. Apertura de turno de recepción',
      '01:00 p. m. Reserva walk-in · habitación compartida',
      '06:00 p. m. Inventario y cierre parcial de tienda'
    ]
  }
];

export function getSandboxScenarios() {
  return scenarios;
}

export function loadSandboxState() {
  try {
    const raw = window.localStorage.getItem(SANDBOX_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn('[Sandbox] No se pudo leer el estado local:', error?.message || error);
    return null;
  }
}

export function activateSandboxScenario(id) {
  const scenario = scenarios.find((item) => item.id === id) || null;
  if (!scenario) return null;
  const payload = {
    ...scenario,
    activatedAt: new Date().toISOString()
  };
  window.localStorage.setItem(SANDBOX_KEY, JSON.stringify(payload));
  return payload;
}

export function clearSandboxState() {
  window.localStorage.removeItem(SANDBOX_KEY);
}
