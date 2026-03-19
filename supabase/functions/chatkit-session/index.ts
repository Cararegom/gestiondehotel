const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_WORKFLOW_ID =
  Deno.env.get('OPENAI_WORKFLOW_ID') ?? 'wf_69b97a86e2f4819087d103eaeba5e56c0bebc52a8ae89a9c';
const OPENAI_SUPPORT_WORKFLOW_ID =
  Deno.env.get('OPENAI_SUPPORT_WORKFLOW_ID') ?? 'wf_69bb83adeb50819085018e4e9c8c403201673fe45e2c1f5d';

const ALLOWED_ORIGINS = new Set([
  'https://gestiondehotel.com',
  'https://www.gestiondehotel.com',
  'http://127.0.0.1:5500',
  'http://localhost:5500'
]);

function buildCorsHeaders(origin: string | null) {
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://gestiondehotel.com';

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'content-type, authorization, x-client-info, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}

function sanitizeVisitorId(rawVisitorId: unknown) {
  const input = typeof rawVisitorId === 'string' ? rawVisitorId : '';
  const cleaned = input.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  return cleaned || crypto.randomUUID().replace(/-/g, '');
}

function resolveWorkflowId(payload: Record<string, unknown>) {
  const source = typeof payload?.source === 'string' ? payload.source.toLowerCase() : '';
  const channel = typeof payload?.channel === 'string' ? payload.channel.toLowerCase() : '';

  if (source === 'internal' || channel === 'support' || source === 'support') {
    return {
      workflowId: OPENAI_SUPPORT_WORKFLOW_ID,
      errorMessage: 'No fue posible iniciar la sesion del chat de soporte.'
    };
  }

  return {
    workflowId: OPENAI_WORKFLOW_ID,
    errorMessage: 'No fue posible iniciar la sesion del chat comercial.'
  };
}

function jsonResponse(body: Record<string, unknown>, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...buildCorsHeaders(origin),
      'Content-Type': 'application/json'
    }
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');

  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: buildCorsHeaders(origin)
    });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405, origin);
  }

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return jsonResponse({ error: 'Origin not allowed.' }, 403, origin);
  }

  if (!OPENAI_API_KEY) {
    return jsonResponse({ error: 'OPENAI_API_KEY is not configured.' }, 500, origin);
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const visitorId = sanitizeVisitorId(payload?.visitorId);
    const { workflowId, errorMessage } = resolveWorkflowId(payload);

    const openAIResponse = await fetch('https://api.openai.com/v1/chatkit/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'chatkit_beta=v1'
      },
      body: JSON.stringify({
        workflow: {
          id: workflowId
        },
        user: visitorId
      })
    });

    const sessionData = await openAIResponse.json().catch(() => ({}));

    if (!openAIResponse.ok || !sessionData?.client_secret) {
      console.error('Error creando sesion ChatKit:', sessionData);
      return jsonResponse(
        { error: errorMessage },
        502,
        origin
      );
    }

    return jsonResponse({ client_secret: sessionData.client_secret }, 200, origin);
  } catch (error) {
    console.error('Error inesperado en chatkit-session:', error);
    return jsonResponse({ error: 'Unexpected error.' }, 500, origin);
  }
});
