import { AuthProvider } from '@/features/auth/context/AuthProvider';
import { LocalizationProvider } from '@/core/i18n/LocalizationProvider';
import { AuthorizationProvider } from '@/core/authorization/AuthorizationProvider';
import { AppProvider } from '@/contexts/AppContext';
import { WorkspaceProvider } from '@/features/workspace/context/WorkspaceProvider';

export function AppProviders({ children }) {
  return (
    <LocalizationProvider>
      <AuthProvider>
        <WorkspaceProvider>
          <AuthorizationProvider>
            <AppProvider>{children}</AppProvider>
          </AuthorizationProvider>
        </WorkspaceProvider>
      </AuthProvider>
    </LocalizationProvider>
  );
}
