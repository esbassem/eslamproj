import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { showroomService } from '@/features/showroom/services/showroom.service';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

const ShowroomConfigContext = createContext(null);

function storageKey(tenantId) {
  return `showroom:currentConfig:${tenantId}`;
}

export function ShowroomConfigProvider({ children }) {
  const { tenant } = useWorkspace();
  const tenantId = tenant?.id ?? null;
  const [configs, setConfigs] = useState([]);
  const [currentShowroomConfig, setCurrentShowroomConfig] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');

  const activeConfigs = useMemo(() => configs.filter((config) => config.is_active !== false), [configs]);

  const selectConfig = useCallback((config) => {
    setCurrentShowroomConfig(config ?? null);

    if (!tenantId) return;

    if (config?.id) {
      sessionStorage.setItem(storageKey(tenantId), config.id);
    } else {
      sessionStorage.removeItem(storageKey(tenantId));
    }
  }, [tenantId]);

  const reloadConfigs = useCallback(async () => {
    if (!tenantId) {
      setConfigs([]);
      setCurrentShowroomConfig(null);
      setStatus('ready');
      return [];
    }

    setStatus('loading');
    setError('');

    try {
      const nextConfigs = await showroomService.listConfigs({ tenantId });
      const nextActiveConfigs = nextConfigs.filter((config) => config.is_active !== false);
      const savedId = sessionStorage.getItem(storageKey(tenantId));
      const savedConfig = nextActiveConfigs.find((config) => config.id === savedId) ?? null;
      const nextCurrent = savedConfig ?? nextActiveConfigs[0] ?? null;

      setConfigs(nextConfigs);
      setCurrentShowroomConfig(nextCurrent);

      if (nextCurrent?.id) {
        sessionStorage.setItem(storageKey(tenantId), nextCurrent.id);
      } else {
        sessionStorage.removeItem(storageKey(tenantId));
      }

      setStatus('ready');
      return nextConfigs;
    } catch (err) {
      setConfigs([]);
      setCurrentShowroomConfig(null);
      setError(err.message || 'تعذر تحميل نقاط المعرض.');
      setStatus('error');
      return [];
    }
  }, [tenantId]);

  useEffect(() => {
    reloadConfigs();
  }, [reloadConfigs]);

  const value = useMemo(() => ({
    configs,
    activeConfigs,
    currentShowroomConfig,
    currentShowroomConfigId: currentShowroomConfig?.id ?? null,
    isLoadingConfigs: status === 'loading',
    configsError: error,
    selectConfig,
    reloadConfigs,
  }), [activeConfigs, configs, currentShowroomConfig, error, reloadConfigs, selectConfig, status]);

  return (
    <ShowroomConfigContext.Provider value={value}>
      {children}
    </ShowroomConfigContext.Provider>
  );
}

export function useShowroomConfig() {
  const context = useContext(ShowroomConfigContext);

  if (!context) {
    throw new Error('useShowroomConfig must be used within ShowroomConfigProvider');
  }

  return context;
}

export function useOptionalShowroomConfig() {
  return useContext(ShowroomConfigContext);
}
