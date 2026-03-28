// outlook-calendar-events.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// === Variables CORS ===
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

// === Función de DESCIFRADO (CORREGIDA) ===
async function decrypt(ciphertextB64, password) {
    const { iv, ct } = JSON.parse(atob(ciphertextB64));
    const pwUtf8 = new TextEncoder().encode(password);
    const pwHash = await crypto.subtle.digest('SHA-256', pwUtf8);
    const alg = {
        name: 'AES-GCM',
        iv: new Uint8Array(iv)
    };
    const key = await crypto.subtle.importKey('raw', pwHash, alg, false, ['decrypt']);
    const ptBuffer = await crypto.subtle.decrypt(alg, key, new Uint8Array(ct)); 
    return new TextDecoder().decode(ptBuffer);
}

// === Función de CIFRADO ===
async function encrypt(text, password) {
    const pwUtf8 = new TextEncoder().encode(password);
    const pwHash = await crypto.subtle.digest('SHA-256', pwUtf8);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const alg = {
        name: 'AES-GCM',
        iv: iv
    };
    const key = await crypto.subtle.importKey('raw', pwHash, alg, false, ['encrypt']);
    const ptUint8 = new TextEncoder().encode(text);
    const ctBuffer = await crypto.subtle.encrypt(alg, key, ptUint8);
    return btoa(JSON.stringify({
        iv: Array.from(iv),
        ct: Array.from(new Uint8Array(ctBuffer))
    }));
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const { hotelId, action, eventDetails, eventId } = await req.json();

        // 1. Log al inicio de la función para ver los datos de entrada
        console.log("Edge Function received request.");
        console.log("Input: hotelId =", hotelId, ", action =", action, ", eventDetails =", eventDetails, ", eventId =", eventId, "");

        if (!hotelId) throw new Error("hotelId es requerido.");

        const supabaseAdmin = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
        );

        // 2. Log antes de la consulta a la tabla oauth_tokens
        console.log("Attempting to fetch token from oauth_tokens for hotelId:", hotelId, "and provider: outlook", "");

        const { data: dbTokenData, error: tokenError } = await supabaseAdmin
            .from("oauth_tokens")
            .select("access_token_encrypted, refresh_token_encrypted, user_email")
            .eq("hotel_id", hotelId)
            .eq("provider", "outlook")
            .single();

        // 3. Log después de la consulta a la tabla oauth_tokens
        if (tokenError) {
            console.error("Error fetching token from oauth_tokens:", tokenError, "");
            throw new Error("No hay token de Outlook registrado para este hotel. " + tokenError?.message);
        }
        if (!dbTokenData) {
            console.error("No token data found for Outlook.");
            throw new Error("No hay token de Outlook registrado para este hotel.");
        }
        console.log("Token data fetched successfully (encrypted). User email:", dbTokenData.user_email, "");

        const ENCRYPTION_KEY = Deno.env.get("MY_ENCRYPTION_SECRET");
        console.log("Attempting to decrypt tokens.");
        let accessToken = await decrypt(dbTokenData.access_token_encrypted, ENCRYPTION_KEY);
        let refreshToken = await decrypt(dbTokenData.refresh_token_encrypted, ENCRYPTION_KEY);
        console.log("Tokens decrypted successfully. AccessToken starts with:", accessToken.substring(0, 10), ""); 

        let responseData;
        let attemptCount = 0;
        const MAX_ATTEMPTS = 2; 

        while (attemptCount < MAX_ATTEMPTS) {
            try {
                let msGraphUrl;
                let graphResponse;

                // Definimos la URL y el método según la acción
                switch (action) {
                    case 'list': {
                        msGraphUrl = 'https://graph.microsoft.com/v1.0/me/calendar/events?' +
                                     `$select=id,subject,start,end&` +
                                     `$orderby=start/dateTime&` +
                                     `$top=10&` +
                                     `$filter=end/dateTime ge '${new Date().toISOString()}'`;
                        graphResponse = await fetch(msGraphUrl, {
                            headers: {
                                'Authorization': `Bearer ${accessToken}`,
                                'Content-Type': 'application/json'
                            }
                        });
                        break;
                    }
                    case 'create': {
                        msGraphUrl = 'https://graph.microsoft.com/v1.0/me/calendar/events';
                        const newEventPayload = {
                            subject: eventDetails.summary,
                            body: { contentType: 'HTML', content: eventDetails.description },
                            start: { dateTime: eventDetails.start, timeZone: 'America/Bogota' }, // Usar zona horaria local
                            end: { dateTime: eventDetails.end, timeZone: 'America/Bogota' },     // Usar zona horaria local
                            isAllDay: eventDetails.isAllDay || false
                        };
                        graphResponse = await fetch(msGraphUrl, {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify(newEventPayload)
                        });
                        break;
                    }
                    case 'delete': {
                        msGraphUrl = `https://graph.microsoft.com/v1.0/me/calendar/events/${eventId}`;
                        graphResponse = await fetch(msGraphUrl, {
                            method: 'DELETE',
                            headers: { 'Authorization': `Bearer ${accessToken}` }
                        });
                        break;
                    }
                    default:
                        throw new Error("Acción no soportada.");
                }

                console.log(`Received response from MS Graph for action '${action}'. Status:`, graphResponse.status, "");

                if (!graphResponse.ok) {
                    // Si el token es inválido/expirado, intentar refrescar
                    if (graphResponse.status === 401 && refreshToken && attemptCount === 0) {
                        console.log("Access token expired (401). Attempting to refresh token...", "");
                        const refreshResponse = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
                            method: "POST",
                            headers: { "Content-Type": "application/x-www-form-urlencoded" },
                            body: new URLSearchParams({
                                client_id: Deno.env.get("OUTLOOK_CLIENT_ID") || '',
                                client_secret: Deno.env.get("OUTLOOK_CLIENT_SECRET") || '',
                                refresh_token: refreshToken,
                                grant_type: "refresh_token"
                            }).toString(),
                        });

                        if (!refreshResponse.ok) {
                            const errorDetails = await refreshResponse.json();
                            console.error("Outlook token refresh failed:", refreshResponse.status, errorDetails, "");
                            throw new Error(`Failed to refresh Outlook token: ${errorDetails.error_description || refreshResponse.statusText}. Please reconnect your account.`);
                        }

                        const newTokens = await refreshResponse.json();
                        accessToken = newTokens.access_token;
                        if (newTokens.refresh_token) { // El refresh token también puede cambiar
                            refreshToken = newTokens.refresh_token;
                        }

                        // Cifrar y guardar el nuevo token
                        const newAccessEncrypted = await encrypt(accessToken, ENCRYPTION_KEY);
                        const newRefreshEncrypted = await encrypt(refreshToken, ENCRYPTION_KEY);
                        console.log("Updating refreshed tokens in DB...", "");
                        await supabaseAdmin.from("oauth_tokens").update({
                            access_token_encrypted: newAccessEncrypted,
                            refresh_token_encrypted: newRefreshEncrypted,
                            updated_at: new Date().toISOString()
                        }).eq("hotel_id", hotelId).eq("provider", "outlook");
                        console.log("Tokens refreshed and updated in DB. Retrying request...", "");

                        attemptCount++; // Incrementar el contador e intentar de nuevo la petición principal
                        continue; // Ir al inicio del bucle while para reintentar con el nuevo token
                    } else {
                        // Si no es 401, o ya intentamos refrescar, es un error fatal
                        const errorBody = await graphResponse.json();
                        console.error(`MS Graph API (${action}) returned non-ok status:`, graphResponse.status, "Error Body:", errorBody, "");
                        throw new Error(`Error de MS Graph (${action}): ${graphResponse.status} - ${errorBody.error?.message || JSON.stringify(errorBody)}`);
                    }
                }

                // Procesar la respuesta exitosa
                switch (action) {
                    case 'list': {
                        const graphData = await graphResponse.json();
                        console.log("Raw Graph Data (list):", JSON.stringify(graphData, null, 2), "");
                        responseData = {
                            items: graphData.value.map((event: any) => ({
                                id: event.id,
                                summary: event.subject,
                                start: {
                                    dateTime: event.start?.dateTime,
                                    date: event.start?.date
                                },
                                end: {
                                    dateTime: event.end?.dateTime,
                                    date: event.end?.date
                                }
                            }))
                        };
                        console.log("Normalized responseData (list):", responseData, "");
                        break;
                    }
                    case 'create': {
                        const createdEvent = await graphResponse.json();
                        console.log("Created event response:", createdEvent, "");
                        responseData = { message: "Evento creado", id: createdEvent.id, ok: true };
                        break;
                    }
                    case 'delete': {
                        console.log("Event deleted successfully.", "");
                        responseData = { message: "Evento eliminado", ok: true };
                        break;
                    }
                    default:
                        // Esto ya debería haber sido capturado al inicio del bucle
                        throw new Error("Acción no reconocida después de una respuesta exitosa.");
                }
                // Si llegamos aquí, la operación fue exitosa, salimos del bucle
                break;

            } catch (error) {
                // Captura errores específicos de la llamada a la API o del refresco
                console.error("Error during MS Graph API call or token refresh (inside while loop):", error, "");
                throw error; // Relanza el error para que el catch global lo maneje y devuelva 400
            }
        } // Fin del bucle while

        // 8. Log antes de devolver la respuesta final exitosa
        console.log("Returning successful response.", "");
        return new Response(JSON.stringify(responseData), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200
        });

    } catch (error) {
        // 9. Log completo en el catch para cualquier error
        console.error("Global catch error in Edge Function:", error, "");
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400
        });
    }
});