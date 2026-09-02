import {
  init, captureException, captureMessage, flush,
  inboundFiltersIntegration, browserApiErrorsIntegration,
  globalHandlersIntegration, linkedErrorsIntegration, dedupeIntegration,
} from '@sentry/browser';
import config from '../../sentry.config.json';
import { sanitizeSentryEvent, sentryEnvironment } from './sentry-policy.mjs';

try {
  if (config.enabled && config.dsn && globalThis.__HOTEL_APP_CONFIG__?.sentry?.enabled !== false) {
    init({
      dsn: config.dsn,
      environment: sentryEnvironment(location.hostname),
      release: __SENTRY_RELEASE__,
      sendDefaultPii: false,
      sendClientReports: false,
      enableLogs: false,
      tracesSampleRate: 0,
      maxBreadcrumbs: 0,
      defaultIntegrations: false,
      integrations: [
        inboundFiltersIntegration(), browserApiErrorsIntegration(),
        globalHandlersIntegration(), linkedErrorsIntegration(), dedupeIntegration(),
      ],
      beforeSend: sanitizeSentryEvent,
    });
    globalThis.HotelMonitoring = Object.freeze({ captureException, captureMessage, flush });
  }
} catch {
  console.warn('[Sentry] No se pudo iniciar la captura de errores.');
}
