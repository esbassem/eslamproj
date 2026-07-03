import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PAPERWORK_COLUMNS = 'id, tenant_id, assigned_to, customer_id, sale_id, current_stage';
const ONESIGNAL_NOTIFICATIONS_URL = 'https://onesignal.com/api/v1/notifications';
const PAPERWORK_URL_PREFIX = '/apps/paperwork';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function getRequiredEnv(name: string) {
  const value = Deno.env.get(name);

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405);
  }

  let requestId: string | undefined;

  try {
    const body = await request.json();
    requestId = typeof body?.request_id === 'string' ? body.request_id.trim() : undefined;
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON payload.' }, 400);
  }

  if (!requestId) {
    return jsonResponse({ ok: false, error: 'request_id is required.' }, 400);
  }

  let supabaseUrl: string;
  let serviceRoleKey: string;
  let oneSignalAppId: string;
  let oneSignalRestApiKey: string;

  try {
    supabaseUrl = getRequiredEnv('SUPABASE_URL');
    serviceRoleKey = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY');
    oneSignalAppId = getRequiredEnv('ONESIGNAL_APP_ID');
    oneSignalRestApiKey = getRequiredEnv('ONESIGNAL_REST_API_KEY');
  } catch (error) {
    console.error('[send-paperwork-notification] missing env', error);
    return jsonResponse({ ok: false, error: 'Missing edge function environment variables.' }, 500);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: paperworkRequest, error: requestError } = await adminClient
    .from('paperwork_requests')
    .select(PAPERWORK_COLUMNS)
    .eq('id', requestId)
    .maybeSingle();

  if (requestError) {
    console.error('[send-paperwork-notification] request lookup failed', requestError);
    return jsonResponse({ ok: false, error: requestError.message }, 400);
  }

  if (!paperworkRequest) {
    return jsonResponse({ ok: false, reason: 'request_not_found' }, 404);
  }

  if (!paperworkRequest.assigned_to) {
    return jsonResponse({ ok: false, reason: 'no_assigned_user' });
  }

  const { data: subscriptions, error: subscriptionsError } = await adminClient
    .from('user_push_subscriptions')
    .select('player_id')
    .eq('tenant_id', paperworkRequest.tenant_id)
    .eq('tenant_user_id', paperworkRequest.assigned_to)
    .eq('is_active', true)
    .eq('provider', 'onesignal');

  if (subscriptionsError) {
    console.error('[send-paperwork-notification] subscriptions lookup failed', subscriptionsError);
    return jsonResponse({ ok: false, error: subscriptionsError.message }, 400);
  }

  const subscriptionIds = [...new Set((subscriptions || []).map((subscription) => subscription.player_id).filter(Boolean))];

  if (!subscriptionIds.length) {
    return jsonResponse({ ok: false, reason: 'no_push_subscription' });
  }

  const notificationPayload = {
    app_id: oneSignalAppId,
    include_subscription_ids: subscriptionIds,
    headings: {
      en: 'New paperwork request',
      ar: 'طلب أوراق جديد',
    },
    contents: {
      en: 'A new paperwork request was created and needs review.',
      ar: 'تم إنشاء طلب أوراق جديد ويحتاج إلى المراجعة',
    },
    url: PAPERWORK_URL_PREFIX,
    data: {
      request_id: paperworkRequest.id,
      tenant_id: paperworkRequest.tenant_id,
      customer_id: paperworkRequest.customer_id,
      sale_id: paperworkRequest.sale_id,
      current_stage: paperworkRequest.current_stage,
    },
  };

  const oneSignalResponse = await fetch(ONESIGNAL_NOTIFICATIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Key ${oneSignalRestApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(notificationPayload),
  });

  const responseText = await oneSignalResponse.text();
  let responseBody: unknown = null;

  try {
    responseBody = responseText ? JSON.parse(responseText) : null;
  } catch {
    responseBody = responseText;
  }

  if (!oneSignalResponse.ok) {
    console.error('[send-paperwork-notification] OneSignal send failed', {
      status: oneSignalResponse.status,
      responseBody,
    });

    return jsonResponse(
      {
        ok: false,
        reason: 'onesignal_error',
        status: oneSignalResponse.status,
        details: responseBody,
      },
      502,
    );
  }

  return jsonResponse({
    ok: true,
    request_id: paperworkRequest.id,
    sent_to: subscriptionIds.length,
    onesignal: responseBody,
  });
});
