import { requireSupabase } from '@/core/lib/supabase';

const TABLE_NAME = 'old_cashbox_transactions';
const COLUMNS = 'id, amount, type, note, date, status, created_by, created_at, ref_id';

export async function listOldCashboxTransactions() {
  const client = requireSupabase();
  const pageSize = 1000;
  let page = 0;
  let hasMore = true;
  let allTransactions = [];

  while (hasMore) {
    const { data, error } = await client
      .from(TABLE_NAME)
      .select(COLUMNS)
      .order('id', { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      throw error;
    }

    if (data?.length) {
      allTransactions = [...allTransactions, ...data];
      page += 1;
      hasMore = data.length === pageSize;
    } else {
      hasMore = false;
    }
  }

  return allTransactions;
}

export function subscribeOldCashboxTransactions(onChange) {
  const client = requireSupabase();
  const channel = client
    .channel('old-cashbox-transactions')
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLE_NAME }, onChange)
    .subscribe();

  return () => client.removeChannel(channel);
}

export async function createOldCashboxTransactions(transactions) {
  const client = requireSupabase();
  const rows = (Array.isArray(transactions) ? transactions : [transactions])
    .filter(Boolean)
    .map((transaction) => ({
      amount: Number(transaction.amount || 0),
      type: transaction.type,
      note: transaction.note,
      date: transaction.date,
      status: transaction.status,
      created_by: transaction.created_by ?? null,
      ref_id: transaction.ref_id ?? null,
    }));

  if (!rows.length) {
    return [];
  }

  const { data, error } = await client
    .from(TABLE_NAME)
    .insert(rows)
    .select(COLUMNS);

  if (error) {
    throw error;
  }

  return data ?? [];
}

export async function updateOldCashboxTransactionsStatus(ids, status) {
  const client = requireSupabase();
  const normalizedIds = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);

  if (!normalizedIds.length) {
    return [];
  }

  const { data, error } = await client
    .from(TABLE_NAME)
    .update({ status })
    .in('id', normalizedIds)
    .select(COLUMNS);

  if (error) {
    throw error;
  }

  return data ?? [];
}
