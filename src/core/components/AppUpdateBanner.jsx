import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';

const APP_VERSION_STORAGE_KEY = 'businesshub:app-version';
const VERSION_CHECK_INTERVAL_MS = 60_000;

export function AppUpdateBanner() {
  const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);
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

  if (!isUpdateAvailable) return null;

  return (
    <div
      className="fixed inset-x-0 top-0 z-[10000] border-b border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 shadow-lg"
      dir="rtl"
      role="alert"
      aria-live="assertive"
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <p className="text-sm font-semibold sm:text-base">
          يتوفر تحديث جديد للمنصة لضمان استمرار العمل بصورة صحيحة.
        </p>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg bg-amber-900 px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-700 focus:ring-offset-2 focus:ring-offset-amber-50"
            onClick={() => window.location.reload()}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            تحديث الآن
          </button>

          <button
            type="button"
            className="rounded-lg p-2 text-amber-900 transition-colors hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-700"
            onClick={() => setIsUpdateAvailable(false)}
            aria-label="إغلاق تنبيه التحديث"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
