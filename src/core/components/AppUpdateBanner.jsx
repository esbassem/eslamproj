import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw } from 'lucide-react';

const APP_VERSION_STORAGE_KEY = 'businesshub:app-version';
const VERSION_CHECK_INTERVAL_MS = 60_000;
const VERSION_CHECK_ENABLED = import.meta.env.PROD;
const UPDATE_BANNER_PREVIEW_ENABLED = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('previewUpdateBanner') === '1';

export function AppUpdateBanner() {
  const [isUpdateAvailable, setIsUpdateAvailable] = useState(UPDATE_BANNER_PREVIEW_ENABLED);
  const requestControllerRef = useRef(null);

  const checkForUpdate = useCallback(async () => {
    requestControllerRef.current?.abort();

    const controller = new AbortController();
    requestControllerRef.current = controller;

    try {
      const response = await fetch(`/version.json?t=${Date.now()}`, {
        cache: 'no-store',
        signal: controller.signal,
      });

      if (!response.ok) return;

      const { version } = await response.json();

      if (typeof version === 'string' && version !== __APP_VERSION__) {
        setIsUpdateAvailable(true);
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.warn('تعذر التحقق من وجود تحديث للمنصة.', error);
      }
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    if (!VERSION_CHECK_ENABLED) return undefined;

    try {
      localStorage.setItem(APP_VERSION_STORAGE_KEY, __APP_VERSION__);
    } catch {
      // يستمر فحص الإصدار حتى عندما يكون التخزين المحلي غير متاح.
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkForUpdate();
      }
    };

    const intervalId = window.setInterval(checkForUpdate, VERSION_CHECK_INTERVAL_MS);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', checkForUpdate);
    checkForUpdate();

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', checkForUpdate);
      requestControllerRef.current?.abort();
    };
  }, [checkForUpdate]);

  useEffect(() => {
    if (!isUpdateAvailable) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isUpdateAvailable]);

  const reloadWithLatestVersion = () => {
    const url = new URL(window.location.href);

    if (UPDATE_BANNER_PREVIEW_ENABLED) {
      url.searchParams.delete('previewUpdateBanner');
    } else {
      url.searchParams.set('_appUpdate', Date.now().toString());
    }

    window.location.replace(url.toString());
  };

  if ((!VERSION_CHECK_ENABLED && !UPDATE_BANNER_PREVIEW_ENABLED) || !isUpdateAvailable) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center overflow-y-auto bg-[rgba(8,15,30,0.68)] px-6 py-12 backdrop-blur-sm"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="platform-update-title"
      aria-describedby="platform-update-description"
    >
      <section className="relative w-full max-w-2xl text-center text-white">
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/15 blur-[90px]" />

        <div className="relative">
          <div className="mx-auto inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-white/[0.07] px-3.5 py-2 text-[11px] font-black text-slate-200 backdrop-blur-md">
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-400" />
            </span>
            تحديث للنظام
          </div>

          <div className="mx-auto mt-6 flex h-14 w-14 items-center justify-center text-sky-300">
            <RefreshCw className="h-8 w-8" strokeWidth={1.8} aria-hidden="true" />
          </div>

          <h1 id="platform-update-title" className="mt-4 text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl">
            نسخة أحدث جاهزة الآن
          </h1>
          <p id="platform-update-description" className="mx-auto mt-4 max-w-xl text-sm font-semibold leading-7 text-slate-300 sm:text-base">
            يلزم تحديث المنصة قبل المتابعة لضمان أفضل أداء.
          </p>

          <button
            type="button"
            className="mt-8 inline-flex min-w-48 items-center justify-center gap-2.5 rounded-xl bg-blue-600 px-7 py-3.5 text-sm font-black text-white shadow-[0_18px_45px_-16px_rgba(37,99,235,0.9)] transition duration-200 hover:-translate-y-0.5 hover:bg-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-400/30 active:translate-y-0"
            onClick={reloadWithLatestVersion}
            autoFocus
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            تحديث الآن
          </button>

          <p className="mt-4 text-[11px] font-bold text-slate-400">
            ستُعاد الصفحة مرة واحدة فقط
          </p>
        </div>
      </section>
    </div>,
    document.body,
  );
}
