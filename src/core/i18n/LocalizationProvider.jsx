import { createContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_LOCALE, LOCALE_META, LOCALE_STORAGE_KEY } from '@/core/i18n/config';
import { messages } from '@/core/i18n/messages';

export const LocalizationContext = createContext(null);

function resolveInitialLocale() {
  if (typeof window === 'undefined') {
    return DEFAULT_LOCALE;
  }

  const storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  return storedLocale && LOCALE_META[storedLocale] ? storedLocale : DEFAULT_LOCALE;
}

function getValueByPath(target, path) {
  return path.split('.').reduce((result, segment) => (result == null ? result : result[segment]), target);
}

function interpolate(message, variables) {
  if (!variables) {
    return message;
  }

  return message.replace(/\{(\w+)\}/g, (_, key) => `${variables[key] ?? ''}`);
}

export function LocalizationProvider({ children }) {
  const [locale, setLocale] = useState(resolveInitialLocale);

  useEffect(() => {
    const { direction, htmlLang } = LOCALE_META[locale] ?? LOCALE_META[DEFAULT_LOCALE];

    document.documentElement.lang = htmlLang;
    document.documentElement.dir = direction;
    document.body.dir = direction;
    document.body.dataset.locale = locale;
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }, [locale]);

  const value = useMemo(() => {
    const localeMessages = messages[locale] ?? messages[DEFAULT_LOCALE];
    const fallbackMessages = messages.en;
    const localeMeta = LOCALE_META[locale] ?? LOCALE_META[DEFAULT_LOCALE];

    return {
      locale,
      direction: localeMeta.direction,
      isRTL: localeMeta.direction === 'rtl',
      setLocale,
      toggleLocale: () => setLocale((current) => (current === 'ar' ? 'en' : 'ar')),
      t: (path, variables) => {
        const resolved = getValueByPath(localeMessages, path) ?? getValueByPath(fallbackMessages, path) ?? path;
        return typeof resolved === 'string' ? interpolate(resolved, variables) : resolved;
      },
    };
  }, [locale]);

  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>;
}
