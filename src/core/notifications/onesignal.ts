import OneSignal from 'react-onesignal';
import { requireSupabase } from '@/core/lib/supabase';

const ONESIGNAL_APP_ID = import.meta.env.VITE_ONESIGNAL_APP_ID;
const PROVIDER = 'onesignal';
const PLAYER_ID_WAIT_ATTEMPTS = 20;
const PLAYER_ID_WAIT_MS = 500;

declare global {
  interface Window {
    businessHubOneSignalInitialized?: boolean;
    businessHubOneSignalInitPromise?: Promise<void>;
  }
}

function isLocalhost() {
  return ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
}

function ensureBrowserSupport() {
  if (typeof window === 'undefined') {
    throw new Error('الإشعارات تعمل داخل المتصفح فقط.');
  }

  if (!ONESIGNAL_APP_ID) {
    throw new Error('إعداد OneSignal غير مكتمل. أضف OneSignal App ID في VITE_ONESIGNAL_APP_ID ثم أعد تشغيل npm run dev.');
  }

  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('هذا المتصفح لا يدعم إشعارات الويب.');
  }

  if (!window.isSecureContext && !isLocalhost()) {
    throw new Error('إشعارات Chrome تحتاج HTTPS أو localhost.');
  }
}

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isAlreadyInitializedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.toLowerCase().includes('already initialized');
}

function hasLoadedOneSignalNamespaces() {
  return Boolean(window.OneSignal?.Notifications && window.OneSignal?.User?.PushSubscription);
}

async function getPlayerId() {
  for (let attempt = 0; attempt < PLAYER_ID_WAIT_ATTEMPTS; attempt += 1) {
    const playerId = OneSignal.User?.PushSubscription?.id;

    if (playerId) {
      return playerId;
    }

    await wait(PLAYER_ID_WAIT_MS);
  }

  return null;
}

export async function initializeOneSignal() {
  ensureBrowserSupport();

  if (window.businessHubOneSignalInitialized || hasLoadedOneSignalNamespaces()) {
    window.businessHubOneSignalInitialized = true;
    return OneSignal;
  }

  if (!window.businessHubOneSignalInitPromise) {
    window.businessHubOneSignalInitPromise = OneSignal.init({
      appId: ONESIGNAL_APP_ID,
      allowLocalhostAsSecureOrigin: true,
      autoRegister: false,
      notifyButton: {
        enable: false,
      },
      serviceWorkerPath: '/OneSignalSDKWorker.js',
      serviceWorkerParam: {
        scope: '/',
      },
      welcomeNotification: {
        disable: true,
      },
    }).then(() => {
      window.businessHubOneSignalInitialized = true;
    }).catch((error) => {
      if (isAlreadyInitializedError(error)) {
        window.businessHubOneSignalInitialized = true;
        return;
      }

      window.businessHubOneSignalInitPromise = undefined;
      throw error;
    });
  }

  await window.businessHubOneSignalInitPromise;
  return OneSignal;
}

async function saveSubscription({ tenantId, tenantUserId, playerId }: { tenantId: string; tenantUserId: string; playerId: string }) {
  const client = requireSupabase();
  const payload = {
    tenant_id: tenantId,
    tenant_user_id: tenantUserId,
    provider: PROVIDER,
    player_id: playerId,
    device_type: 'web',
    browser: navigator.userAgent,
    is_active: true,
    updated_at: new Date().toISOString(),
  };

  const { data: existing, error: existingError } = await client
    .from('user_push_subscriptions')
    .select('id')
    .eq('tenant_user_id', tenantUserId)
    .eq('provider', PROVIDER)
    .eq('player_id', playerId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existing?.id) {
    const { error } = await client.from('user_push_subscriptions').update(payload).eq('id', existing.id);

    if (error) {
      throw error;
    }

    return;
  }

  const { error } = await client.from('user_push_subscriptions').insert(payload);

  if (error) {
    throw error;
  }
}

export async function requestAndSaveOneSignalSubscription({
  tenantId,
  tenantUserId,
}: {
  tenantId?: string | null;
  tenantUserId?: string | null;
}) {
  if (!tenantId || !tenantUserId) {
    throw new Error('لا يمكن تفعيل الإشعارات قبل تحميل بيانات الشركة والمستخدم.');
  }

  await initializeOneSignal();

  if (!OneSignal.Notifications.isPushSupported()) {
    throw new Error('هذا المتصفح لا يدعم إشعارات الويب.');
  }

  if (Notification.permission === 'denied') {
    return {
      status: 'denied' as const,
      playerId: null,
    };
  }

  const granted = OneSignal.Notifications.permission || (await OneSignal.Notifications.requestPermission());

  if (!granted || Notification.permission !== 'granted') {
    return {
      status: 'denied' as const,
      playerId: null,
    };
  }

  if (!OneSignal.User.PushSubscription.optedIn) {
    await OneSignal.User.PushSubscription.optIn();
  }

  const playerId = await getPlayerId();

  if (!playerId) {
    throw new Error('تم منح الإذن لكن لم نستطع الحصول على OneSignal player id.');
  }

  await saveSubscription({ tenantId, tenantUserId, playerId });

  return {
    status: 'saved' as const,
    playerId,
  };
}
