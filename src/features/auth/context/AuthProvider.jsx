import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clearScopedStorage, storageKeys } from '@/core/lib/storage';
import { supabaseConfigError } from '@/core/lib/supabase';
import { messages } from '@/core/i18n/messages';
import { authService } from '@/features/auth/api/auth.api';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [authStatus, setAuthStatus] = useState('loading_session');
  const [authError, setAuthError] = useState(null);
  const bootstrapRunRef = useRef(0);
  const currentAccessTokenRef = useRef(null);
  const currentUserIdRef = useRef(null);

  const resetAuthState = useCallback(() => {
    currentAccessTokenRef.current = null;
    currentUserIdRef.current = null;
    setSession(null);
    setUser(null);
    setAuthError(null);
    setAuthStatus('unauthenticated');
  }, []);

  const handleSessionBootstrap = useCallback(
    async (nextSession, options = {}) => {
      const runId = ++bootstrapRunRef.current;
      const { updateUser = true } = options;

      if (!authService.isConfigured) {
        resetAuthState();
        setAuthError(supabaseConfigError);
        return;
      }

      if (!nextSession?.user) {
        resetAuthState();
        return;
      }

      const nextUserId = nextSession.user.id;
      const nextAccessToken = nextSession.access_token ?? null;
      const isSameUser = currentUserIdRef.current === nextUserId;
      const isSameAccessToken = currentAccessTokenRef.current === nextAccessToken;

      if (isSameUser && isSameAccessToken) {
        return;
      }

      currentUserIdRef.current = nextUserId;
      currentAccessTokenRef.current = nextAccessToken;
      setAuthStatus('authenticated');
      setAuthError(null);
      setSession(nextSession);

      if (updateUser || !isSameUser) {
        setUser(nextSession.user);
      }

      if (bootstrapRunRef.current !== runId) {
        return;
      }
    },
    [resetAuthState],
  );

  useEffect(() => {
    let mounted = true;

    if (!authService.isConfigured) {
      resetAuthState();
      setAuthError(supabaseConfigError);
      return undefined;
    }

    authService
      .getCurrentSession()
      .then((currentSession) => {
        if (!mounted) {
          return;
        }

        handleSessionBootstrap(currentSession);
      })
      .catch((error) => {
        if (!mounted) {
          return;
        }

        resetAuthState();
        setAuthError(error.message || messages.ar.errors.authSessionCheck);
      });

    const {
      data: { subscription },
    } = authService.onAuthStateChange((nextSession, event) => {
      if (!mounted) {
        return;
      }

      handleSessionBootstrap(nextSession, { updateUser: event !== 'TOKEN_REFRESHED' });
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [handleSessionBootstrap, resetAuthState]);

  const value = useMemo(
    () => ({
      session,
      user,
      authStatus,
      authError,
      isAuthenticated: Boolean(user),
      isCheckingSession: authStatus === 'loading_session',
      isAuthReady: authStatus !== 'loading_session',
      signIn: async (payload) => {
        try {
          setAuthError(null);
          const result = await authService.signIn(payload);
          await handleSessionBootstrap(result.session);
          return result;
        } catch (error) {
          resetAuthState();
          setAuthError(error.message || messages.ar.errors.authSignIn);
          throw error;
        }
      },
      signUp: async (payload) => {
        try {
          setAuthError(null);
          const result = await authService.signUp(payload);

          if (!result.session) {
            resetAuthState();
            return result;
          }

          await handleSessionBootstrap(result.session);
          return result;
        } catch (error) {
          resetAuthState();
          setAuthError(error.message || messages.ar.errors.authSignUp);
          throw error;
        }
      },
      signOut: async () => {
        try {
          await authService.signOut();
        } finally {
          clearScopedStorage([storageKeys.tenant]);
          resetAuthState();
        }
      },
      clearAuthError: () => setAuthError(null),
    }),
    [authError, authStatus, handleSessionBootstrap, resetAuthState, session, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
