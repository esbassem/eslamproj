import OneSignal from 'react-onesignal';
import { requireSupabase } from '@/core/lib/supabase';

const ONESIGNAL_APP_ID = import.meta.env.VITE_ONESIGNAL_APP_ID;
const PROVIDER = 'onesignal';
const PLAYER_ID_WAIT_ATTEMPTS = 20;
const PLAYER_ID_WAIT_MS = 500;
const LOG_PREFIX = '[OneSignal Web Push]';

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

function logStep(message: string, details?: unknown) {
  if (typeof details === 'undefined') {
    console.log(LOG_PREFIX, message);
    return;
  }

  console.log(LOG_PREFIX, message, details);
}

function logException(message: string, error: unknown) {
  console.error(LOG_PREFIX, message, error);
}

function isAlreadyInitializedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.toLowerCase().includes('already initialized');
}

function hasLoadedOneSignalNamespaces() {
  return Boolean(window.OneSignal?.Notifications && window.OneSignal?.User?.PushSubscription);
}

function getBrowserNotificationPermission() {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

function getOneSignalPushState() {
  return {
    notificationPermission: getBrowserNotificationPermission(),
    oneSignalPermission: OneSignal.Notifications?.permission,
    subscriptionId: OneSignal.User?.PushSubscription?.id ?? null,
    token: OneSignal.User?.PushSubscription?.token ?? null,
    optedIn: OneSignal.User?.PushSubscription?.optedIn,
  };
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
  logStep('initializeOneSignal:start', {
    alreadyInitialized: Boolean(window.businessHubOneSignalInitialized),
    hasLoadedNamespaces: hasLoadedOneSignalNamespaces(),
    notificationPermission: getBrowserNotificationPermission(),
  });

  if (window.businessHubOneSignalInitialized || hasLoadedOneSignalNamespaces()) {
    window.businessHubOneSignalInitialized = true;
    logStep('initializeOneSignal:already-initialized', getOneSignalPushState());
    return OneSignal;
  }

  if (!window.businessHubOneSignalInitPromise) {
    logStep('initializeOneSignal:init-call');
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
      logStep('initializeOneSignal:init-complete', getOneSignalPushState());
    }).catch((error) => {
      if (isAlreadyInitializedError(error)) {
        window.businessHubOneSignalInitialized = true;
        logStep('initializeOneSignal:init-already-initialized-error', getOneSignalPushState());
        return;
      }

      window.businessHubOneSignalInitPromise = undefined;
      logException('initializeOneSignal:init-exception', error);
      throw error;
    });
  }

  await window.businessHubOneSignalInitPromise;
  logStep('initializeOneSignal:ready', getOneSignalPushState());
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

  try {
    await initializeOneSignal();
  } catch (error) {
    logException('requestAndSave:init-exception', error);
    throw error;
  }

  logStep('requestAndSave:after-init', getOneSignalPushState());

  if (!OneSignal.Notifications.isPushSupported()) {
    logStep('requestAndSave:push-not-supported', getOneSignalPushState());
    throw new Error('هذا المتصفح لا يدعم إشعارات الويب.');
  }

  if (Notification.permission === 'denied') {
    logStep('requestAndSave:browser-permission-denied', getOneSignalPushState());
    return {
      status: 'denied' as const,
      playerId: null,
    };
  }

  if (!OneSignal.Notifications.permission) {
    logStep('requestAndSave:show-slidedown-prompt', getOneSignalPushState());

    try {
      await OneSignal.Slidedown.promptPush({ force: true });
    } catch (error) {
      logException('requestAndSave:slidedown-exception', error);
      throw error;
    }

    logStep('requestAndSave:after-slidedown-prompt', getOneSignalPushState());
  }

  if (Notification.permission === 'default') {
    logStep('requestAndSave:browser-permission-default', getOneSignalPushState());
    return {
      status: 'permission_default' as const,
      playerId: null,
    };
  }

  if (Notification.permission === 'denied') {
    logStep('requestAndSave:browser-permission-denied-after-prompt', getOneSignalPushState());
    return {
      status: 'denied' as const,
      playerId: null,
    };
  }

  if (!OneSignal.User.PushSubscription.optedIn) {
    logStep('requestAndSave:opt-in-start', getOneSignalPushState());

    try {
      await OneSignal.User.PushSubscription.optIn();
    } catch (error) {
      logException('requestAndSave:opt-in-exception', error);
      throw error;
    }

    logStep('requestAndSave:opt-in-complete', getOneSignalPushState());
  }

  const playerId = await getPlayerId();
  logStep('requestAndSave:subscription-id-result', {
    ...getOneSignalPushState(),
    playerId,
  });

  if (!playerId) {
    throw new Error('تم منح الإذن لكن لم نستطع الحصول على OneSignal player id.');
  }

  await saveSubscription({ tenantId, tenantUserId, playerId });
  logStep('requestAndSave:saved', {
    tenantId,
    tenantUserId,
    playerId,
  });

  return {
    status: 'saved' as const,
    playerId,
  };
}
