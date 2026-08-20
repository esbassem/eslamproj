import { useContext } from 'react';
import { AuthorizationContext } from '@/core/authorization/AuthorizationProvider';

export function useAuthorization() {
  const context = useContext(AuthorizationContext);

  if (!context) {
    throw new Error('useAuthorization must be used within AuthorizationProvider');
  }

  return context;
}
