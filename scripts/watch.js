const { google } = require('googleapis');

const CLIENT_ID = '753703331391-r3n2fo5s175e4e6fegdIsp8ht5046i09.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
const REDIRECT_URI = 'https://iikpqpdoslyduecibaij.supabase.co/functions/v1/calendar-oauth-callback'; // El mismo que usaste en tu OAuth
const ACCESS_TOKEN = 'EL_ACCESS_TOKEN_DEL_HOTEL';
const REFRESH_TOKEN = 'EL_REFRESH_TOKEN_DEL_HOTEL';

const WEBHOOK_URL = 'https://iikpqpdoslyduecibaij.supabase.co/functions/v1/calendar-webhook'; // TU URL real

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
      calendarId: 'primary', // o el ID del calendario, si es compartido
      requestBody: {
        id: 'canal-hotel-' + Math.floor(Math.random()*1000000), // ID único para este canal
        type: 'web_hook',
        address: WEBHOOK_URL,
        params: {
          ttl: 86400 // opcional: segundos de vida (aquí 1 día)
        }
      }
    });
    console.log('Canal creado OK. Guárdalo en tu BD:', res.data);
    /*
    {
      kind: 'api#channel',
      id: 'canal-hotel-123456',
      resourceId: 'XYZ',
      resourceUri: 'https://www.googleapis.com/calendar/v3/calendars/xxx/events',
      expiration: '1718224422000'
    }
    */
  } catch (err) {
    console.error('Error creando canal:', err?.errors?.[0] || err);
  }
}
crearWatch();
