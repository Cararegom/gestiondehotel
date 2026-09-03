import {
  init, captureException, captureMessage, getCurrentScope, setTag, getActiveSpan, spanToJSON,
  startBrowserTracingNavigationSpan, startInactiveSpan, startNewTrace, startSpan,
  flush, breadcrumbsIntegration, browserTracingIntegration,
  inboundFiltersIntegration, browserApiErrorsIntegration, globalHandlersIntegration,
  linkedErrorsIntegration, dedupeIntegration,
} from '@sentry/browser';
import config from '../../sentry.config.json';
import { sanitizeSentryEvent } from './sentry-policy.mjs';
import { installTelemetry } from '../telemetry/sentry-client.js';

const telemetry = installTelemetry({
  init, captureException, getCurrentScope, setTag, getActiveSpan, spanToJSON,
  startBrowserTracingNavigationSpan, startInactiveSpan, startNewTrace, startSpan,
  flush, breadcrumbsIntegration, browserTracingIntegration,
  inboundFiltersIntegration, browserApiErrorsIntegration, globalHandlersIntegration,
  linkedErrorsIntegration, dedupeIntegration,
}, globalThis, {
  dsn: config.dsn,
  enabled: config.enabled,
  productionHosts: ['gestiondehotel.com', 'www.gestiondehotel.com'],
  productionEnvironment: 'prod',
  tracesSampleRate: 0.1,
  sanitizeErrorEvent: sanitizeSentryEvent,
}, __SENTRY_RELEASE__);

// Conservar la API existente; ambos nombres usan una sola instancia del SDK.
if (telemetry.getStatus().enabled) {
  globalThis.HotelMonitoring = Object.freeze({
    captureException: telemetry.captureException, captureMessage, flush,
  });
}
