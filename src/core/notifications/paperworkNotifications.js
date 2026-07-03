export async function invokePaperworkNotification(client, requestId) {
  if (!client || !requestId) {
    return null;
  }

  try {
    const { data, error } = await client.functions.invoke('send-paperwork-notification', {
      body: { request_id: requestId },
    });

    if (error) {
      console.warn('[paperwork-notification] Edge Function failed', error);
      return { ok: false, error };
    }

    if (data?.ok === false) {
      console.warn('[paperwork-notification] Notification was not sent', data);
    }

    return data;
  } catch (error) {
    console.warn('[paperwork-notification] Unable to invoke Edge Function', error);
    return { ok: false, error };
  }
}
