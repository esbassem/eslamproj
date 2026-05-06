import { AuthProvider } from '@/features/auth/context/AuthProvider';
import { LocalizationProvider } from '@/core/i18n/LocalizationProvider';
import { AppProvider } from '@/contexts/AppContext';
import { WorkspaceProvider } from '@/features/workspace/context/WorkspaceProvider';

export function AppProviders({ children }) {
  return (
    <LocalizationProvider>
      <AuthProvider>
        <WorkspaceProvider>
          <AppProvider>{children}</AppProvider>
        </WorkspaceProvider>
      </AuthProvider>
    </LocalizationProvider>
  );
}

