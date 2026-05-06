import { messages } from '@/core/i18n/messages';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

function isPlaceholderValue(value) {
  return !value || value.startsWith('PUT_YOUR_');
}

function isValidSupabaseUrl(value) {
  return typeof value === 'string' && /^https?:\/\//.test(value);
}

export const isSupabaseConfigured =
  !isPlaceholderValue(supabaseUrl) && !isPlaceholderValue(supabaseAnonKey) && isValidSupabaseUrl(supabaseUrl);
export const supabaseConfigError = isSupabaseConfigured
  ? null
  : messages.ar.errors.supabaseConfig;

export const supabase = isSupabaseConfigured ? createClient(supabaseUrl, supabaseAnonKey) : null;

export function requireSupabase() {
  if (!supabase) {
    throw new Error(supabaseConfigError);
  }

  return supabase;
}

