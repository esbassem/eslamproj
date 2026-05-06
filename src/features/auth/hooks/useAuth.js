import { useContext } from 'react';
import { AuthContext } from '@/features/auth/context/AuthProvider';
import { WorkspaceContext } from '@/features/workspace/context/WorkspaceProvider';

export function useAuth() {
  const authContext = useContext(AuthContext);
  const workspaceContext = useContext(WorkspaceContext);

  if (!authContext) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  if (!workspaceContext) {
    return authContext;
  }

  return {
    ...authContext,
    tenant: workspaceContext.tenant,
    tenant_user: workspaceContext.tenantUser,
  };
}

