import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TENANT_USER_COLUMNS = 'id, tenant_id, auth_user_id, partner_id, full_name, phone, email, role, is_active, created_at, updated_at';
const ALLOWED_ROLES = new Set(['owner', 'admin', 'cashier', 'sales', 'accountant', 'staff']);

function logError(message: string, details?: unknown) {
  console.error(`[create-tenant-user] ${message}`, details ?? '');
}

function errorResponse(message: string, status: number, details?: unknown) {
  logError(message, details);
  return jsonResponse({ error: message }, status);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Missing edge function environment variables.' }, 500);
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing authorization header.' }, 401);
  }

  const accessToken = authHeader.replace('Bearer ', '').trim();

  let payload: {
    tenant_id?: string;
    tenantId?: string;
    full_name?: string;
    fullName?: string;
    email?: string;
    password?: string;
    role?: string;
    phone?: string | null;
  };

  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON payload.' }, 400);
  }

  const tenantId = payload.tenant_id?.trim() ?? payload.tenantId?.trim();
  const fullName = payload.full_name?.trim() ?? payload.fullName?.trim();
  const email = payload.email?.trim().toLowerCase();
  const password = payload.password?.trim();
  const role = payload.role?.trim().toLowerCase();
  const phone = payload.phone?.trim() || null;

  console.log('[create-tenant-user] payload', {
    tenantId,
    fullName,
    email,
    role,
    phone,
    passwordLength: password?.length ?? 0,
  });

  if (!tenantId || !fullName || !email || !password || !role) {
    return errorResponse('Missing required fields.', 400, { tenantId, fullName, email, role });
  }

  if (!ALLOWED_ROLES.has(role)) {
    return errorResponse('Unsupported role.', 400, { role });
  }

  if (password.length < 8) {
    return errorResponse('Password must be at least 8 characters.', 400, { passwordLength: password.length });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const {
    data: { user: authUser },
    error: authUserError,
  } = await adminClient.auth.getUser(accessToken);

  if (authUserError || !authUser) {
    return errorResponse('Unauthorized request.', 401, { authUserError });
  }

  const { data: requesterMembership, error: requesterError } = await adminClient
    .from('tenant_users')
    .select('tenant_id, role, is_active')
    .eq('auth_user_id', authUser.id)
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  console.log('[create-tenant-user] requesterMembership', {
    authUserId: authUser.id,
    tenantId,
    requesterMembership,
  });

  if (requesterError) {
    return errorResponse(requesterError.message, 400, { requesterError });
  }

  if (!requesterMembership || requesterMembership.role !== 'owner') {
    return errorResponse('Only the tenant owner can create employees.', 403, {
      authUserId: authUser.id,
      tenantId,
      requesterMembership,
    });
  }

  const { data: existingTenantUser } = await adminClient
    .from('tenant_users')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('email', email)
    .limit(1)
    .maybeSingle();

  if (existingTenantUser) {
    return errorResponse('This email is already assigned inside the current tenant.', 409, {
      tenantId,
      email,
      existingTenantUser,
    });
  }

  const { data: createdAuthUser, error: createAuthError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      phone,
    },
    app_metadata: {
      tenant_id: tenantId,
      role,
    },
  });

  if (createAuthError || !createdAuthUser.user) {
    return errorResponse(createAuthError?.message || 'Unable to create auth user.', 400, {
      tenantId,
      email,
      role,
      createAuthError,
    });
  }

  const { data: createdMember, error: insertTenantUserError } = await adminClient
    .from('tenant_users')
    .insert({
      tenant_id: tenantId,
      auth_user_id: createdAuthUser.user.id,
      full_name: fullName,
      email,
      role,
      phone,
      is_active: true,
    })
    .select(TENANT_USER_COLUMNS)
    .single();

  if (insertTenantUserError) {
    await adminClient.auth.admin.deleteUser(createdAuthUser.user.id);
    return errorResponse(insertTenantUserError.message, 400, {
      tenantId,
      email,
      createdAuthUserId: createdAuthUser.user.id,
      insertTenantUserError,
    });
  }

  console.log('[create-tenant-user] success', {
    tenantId,
    createdAuthUserId: createdAuthUser.user.id,
    tenantUserId: createdMember.id,
    email,
    role,
  });

  return jsonResponse({ member: createdMember }, 200);
});
