import { messages } from '@/core/i18n/messages';
import { requireSupabase, isSupabaseConfigured, supabaseConfigError } from '@/core/lib/supabase';

function createConfigurationError() {
  return new Error(supabaseConfigError || messages.ar.errors.supabaseConfig);
}

export const authService = {
  isConfigured: isSupabaseConfigured,

  async getCurrentSession() {
    if (!isSupabaseConfigured) {
      return null;
    }

    const client = requireSupabase();
    const {
      data: { session },
      error,
    } = await client.auth.getSession();

    if (error) {
      throw error;
    }

    return session;
  },

  onAuthStateChange(callback) {
    if (!isSupabaseConfigured) {
      return {
        data: {
          subscription: {
            unsubscribe() {},
          },
        },
      };
    }

    const client = requireSupabase();
    return client.auth.onAuthStateChange((event, session) => {
      callback(session, event);
    });
  },

  async signIn({ email, password }) {
    if (!isSupabaseConfigured) {
      throw createConfigurationError();
    }

    const client = requireSupabase();
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw error;
    }

    return {
      session: data.session,
      user: data.user,
    };
  },

  async signUp({ fullName, email, password }) {
    if (!isSupabaseConfigured) {
      throw createConfigurationError();
    }

    const client = requireSupabase();
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
      },
    });

    if (error) {
      throw error;
    }

    return {
      session: data.session,
      user: data.user,
      requiresEmailVerification: !data.session,
    };
  },

  async resetPassword(email, redirectTo) {
    if (!isSupabaseConfigured) {
      throw createConfigurationError();
    }

    const client = requireSupabase();
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    if (error) {
      throw error;
    }
  },

  async signOut() {
    if (!isSupabaseConfigured) {
      return;
    }

    const client = requireSupabase();
    const { error } = await client.auth.signOut();

    if (error) {
      throw error;
    }
  },
};
