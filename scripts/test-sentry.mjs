import { readFile } from 'node:fs/promises';
import { init, captureException, flush } from '@sentry/browser';
import { sanitizeSentryEvent } from '../js/monitoring/sentry-policy.mjs';

// Explicit manual command only; never invoked by npm test or npm run build.
const config = JSON.parse(await readFile(new URL('../sentry.config.json', import.meta.url), 'utf8'));
let accepted = false;
const client = init({
  dsn: config.dsn,
  environment: 'verification',
  defaultIntegrations: false,
  sendDefaultPii: false,
  sendClientReports: false,
  enableLogs: false,
  beforeSend: sanitizeSentryEvent,
});
client.on('afterSendEvent', (_event, response) => { accepted = response?.statusCode === 200; });
const eventId = captureException(new Error('Gestiondehotel: verificacion de conexion Sentry'));
const completed = await flush(10000);
if (!completed || !accepted) {
  console.error('No se confirmo la recepcion del evento de verificacion.');
  process.exitCode = 1;
} else {
  console.log(`Evento de verificacion recibido: ${eventId}`);
}
