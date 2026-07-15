import { requireSupabase } from '@/core/lib/supabase';
import { resolveCurrentTenantUserId } from '@/features/workspace/api/currentTenantUser.api';

const TENANT_FILES_BUCKET = 'tenant-files';

function requireTenantId(tenantId) {
  if (!tenantId) {
    throw new Error('لا توجد شركة نشطة.');
  }
}

function toMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function byId(records) {
  return new Map((records || []).filter((record) => record?.id).map((record) => [record.id, record]));
}

function formatDateLabel(value) {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const current = new Date();
  const isToday = date.toDateString() === current.toDateString();
  const yesterday = new Date(current);
  yesterday.setDate(current.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  const time = date.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

  if (isToday) return `اليوم ${time}`;
  if (isYesterday) return `أمس ${time}`;

  return date.toLocaleDateString('ar-EG', { day: '2-digit', month: 'long', year: 'numeric' });
}

function getFileExtension(file) {
  const nameExtension = String(file?.name || '').split('.').pop();
  const mimeExtension = String(file?.type || '').split('/').pop();
  return (nameExtension && nameExtension !== file?.name ? nameExtension : mimeExtension || 'jpg')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase() || 'jpg';
}

function assertImage(file) {
  if (!file) {
    throw new Error('ارفق صورة العملية أولاً.');
  }

  if (!file.type?.startsWith('image/')) {
    throw new Error('يمكن رفع صور فقط.');
  }
}

export const accountantService = {
  async listPaymentEntityCustomerCredits({ tenantId, limit = 100 } = {}) {
    requireTenantId(tenantId);

    const client = requireSupabase();
    const { data: account, error: accountError } = await client
      .from('account_accounts')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('code', '114002')
      .eq('active', true)
      .maybeSingle();

    if (accountError) throw accountError;
    if (!account?.id) return [];

    const { data: lines, error: linesError } = await client
      .from('account_move_lines')
      .select('id, move_id, partner_id, debit, credit, created_at')
      .eq('tenant_id', tenantId)
      .eq('account_id', account.id)
      .ilike('label', 'اعتماد دفعة من جهة%')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (linesError) throw linesError;
    if (!lines?.length) return [];

    const moveIds = unique(lines.map((line) => line.move_id));
    const { data: moves, error: movesError } = await client
      .from('account_moves')
      .select('id, partner_id, amount_total, notes, state, date, created_at')
      .eq('tenant_id', tenantId)
      .in('id', moveIds);

    if (movesError) throw movesError;

    const movesById = byId(moves);
    const partnerIds = unique([
      ...lines.map((line) => line.partner_id),
      ...(moves || []).map((move) => move.partner_id),
    ]);
    const { data: partners, error: partnersError } = partnerIds.length
      ? await client
        .from('partners')
        .select('id, name, display_config')
        .eq('tenant_id', tenantId)
        .in('id', partnerIds)
      : { data: [], error: null };

    if (partnersError) throw partnersError;

    const partnersById = byId(partners);

    return lines.map((line) => {
      const move = movesById.get(line.move_id) || {};
      const customer = partnersById.get(move.partner_id);
      const entity = partnersById.get(line.partner_id);
      const amount = toMoney(line.debit) - toMoney(line.credit);

      return {
        id: line.move_id || line.id,
        entityId: line.partner_id,
        customerId: move.partner_id || null,
        customerName: customer?.name || 'عميل غير محدد',
        entityName: entity?.name || 'جهة غير محددة',
        entityDisplayConfig: entity?.display_config || null,
        amount,
        status: move.state === 'posted' ? 'approved' : 'review',
        dateLabel: formatDateLabel(move.date || move.created_at || line.created_at),
        note: move.notes || 'تم تسجيل القيد المحاسبي.',
      };
    });
  },

  async getPaymentEntityReceivableTotal({ tenantId } = {}) {
    requireTenantId(tenantId);

    const client = requireSupabase();
    const { data: account, error: accountError } = await client
      .from('account_accounts')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('code', '114002')
      .eq('active', true)
      .maybeSingle();

    if (accountError) throw accountError;
    if (!account?.id) return 0;

    const { data: lines, error: linesError } = await client
      .from('account_move_lines')
      .select('debit, credit')
      .eq('tenant_id', tenantId)
      .eq('account_id', account.id)
      .ilike('label', 'اعتماد دفعة من جهة%');

    if (linesError) throw linesError;

    return (lines || []).reduce((total, line) => (
      total + toMoney(line.debit) - toMoney(line.credit)
    ), 0);
  },

  async createPaymentEntityCustomerCredit({
    tenantId,
    branchId,
    customerId,
    paymentEntityId,
    amount,
    note,
    attachmentFile,
    userId,
  } = {}) {
    requireTenantId(tenantId);
    if (!customerId) throw new Error('اختر العميل أولاً.');
    if (!paymentEntityId) throw new Error('اختر الجهة أولاً.');

    const safeAmount = toMoney(amount);
    if (safeAmount <= 0) {
      throw new Error('اكتب مبلغ صحيح أكبر من صفر.');
    }

    assertImage(attachmentFile);

    const client = requireSupabase();
    const createdBy = await resolveCurrentTenantUserId(client, { tenantId, tenantUserId: userId });
    const extension = getFileExtension(attachmentFile);
    const path = `${tenantId}/accountant/payment-entity-credits/${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await client.storage.from(TENANT_FILES_BUCKET).upload(path, attachmentFile, {
      cacheControl: '3600',
      contentType: attachmentFile.type || 'image/jpeg',
      upsert: false,
    });

    if (uploadError) {
      throw new Error(uploadError.message || 'تعذر رفع صورة العملية.');
    }

    const payload = {
      tenant_id: tenantId,
      branch_id: branchId || null,
      customer_id: customerId,
      payment_entity_id: paymentEntityId,
      amount: safeAmount,
      notes: String(note || '').trim() || null,
      created_by: createdBy,
      attachment: {
        bucket_name: TENANT_FILES_BUCKET,
        file_path: path,
        document_type: 'accountant_payment_entity_credit',
        original_file_name: attachmentFile.name || null,
        mime_type: attachmentFile.type || null,
        file_size: attachmentFile.size || null,
      },
    };

    const { data, error } = await client.rpc('create_accountant_payment_entity_credit', { payload });

    if (error) {
      await client.storage.from(TENANT_FILES_BUCKET).remove([path]);
      throw new Error(error.message || 'تعذر تسجيل العملية.');
    }

    return data;
  },
};
