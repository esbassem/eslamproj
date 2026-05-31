export async function resolveCurrentTenantUserId(client, { tenantId, tenantUserId } = {}) {
  if (!tenantId) {
    throw new Error('لا توجد شركة نشطة.');
  }

  if (tenantUserId) {
    const { data, error } = await client
      .from('tenant_users')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('id', tenantUserId)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data?.id) {
      throw new Error('تعذر تحديد مستخدم الشركة الحالي.');
    }

    return data.id;
  }

  const { data: authResult, error: authError } = await client.auth.getUser();
  if (authError) {
    throw authError;
  }

  const authUserId = authResult?.user?.id;
  if (!authUserId) {
    throw new Error('تعذر تحديد المستخدم الحالي.');
  }

  const { data, error } = await client
    .from('tenant_users')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('auth_user_id', authUserId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data?.id) {
    throw new Error('تعذر تحديد مستخدم الشركة الحالي.');
  }

  return data.id;
}
