import { useContext } from 'react';
import { LocalizationContext } from '@/core/i18n/LocalizationProvider';

export function useI18n() {
  const context = useContext(LocalizationContext);

  if (!context) {
    throw new Error('useI18n must be used within LocalizationProvider');
  }

  return context;
}
