import { requireSupabase } from '@/core/lib/supabase';

export async function createManualReceivable(payload) {
  try {
    const client = requireSupabase();
    const { data, error } = await client.rpc('create_manual_receivable', {
      payload,
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error.message || 'تعذر إنشاء المديونية.' };
  }
}
