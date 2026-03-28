const { google } = require('googleapis');

function readRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const CLIENT_ID = readRequiredEnv('GOOGLE_CLIENT_ID');
const CLIENT_SECRET = readRequiredEnv('GOOGLE_CLIENT_SECRET');
const REDIRECT_URI = readRequiredEnv('GOOGLE_REDIRECT_URI');
const ACCESS_TOKEN = readRequiredEnv('GOOGLE_ACCESS_TOKEN');
const REFRESH_TOKEN = readRequiredEnv('GOOGLE_REFRESH_TOKEN');
const WEBHOOK_URL = readRequiredEnv('GOOGLE_CALENDAR_WEBHOOK_URL');

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

oauth2Client.setCredentials({
  access_token: ACCESS_TOKEN,
  refresh_token: REFRESH_TOKEN
});

async function crearWatch() {
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  try {
    const res = await calendar.events.watch({
      calendarId: 'primary',
      requestBody: {
        id: 'canal-hotel-' + Math.floor(Math.random() * 1000000),
        type: 'web_hook',
        address: WEBHOOK_URL,
        params: {
          ttl: 86400
        }
      }
    });

    console.log('Canal creado OK. Guardalo en tu BD:', res.data);
  } catch (err) {
    console.error('Error creando canal:', err?.errors?.[0] || err);
  }
}

crearWatch().catch((error) => {
  console.error('Fallo al ejecutar el script watch:', error);
  process.exitCode = 1;
});
