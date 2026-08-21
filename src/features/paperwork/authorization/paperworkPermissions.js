import { PERMISSIONS } from '@/core/authorization/permissions';

export const PAPERWORK_PERMISSIONS = Object.freeze({
  ACCESS: PERMISSIONS.PAPERWORK_ACCESS,
  SEND: PERMISSIONS.PAPERWORK_SEND,
  RECEIVE: PERMISSIONS.PAPERWORK_RECEIVE,
  DELIVER: PERMISSIONS.PAPERWORK_DELIVER,
  CANCEL: PERMISSIONS.PAPERWORK_CANCEL,
  CORRECT: PERMISSIONS.PAPERWORK_CORRECT,
  AUTHORIZE_RELEASE: PERMISSIONS.PAPERWORK_AUTHORIZE_RELEASE,
});

export const REQUEST_ACTION_PERMISSIONS = Object.freeze({
  send: PAPERWORK_PERMISSIONS.SEND,
  receive: PAPERWORK_PERMISSIONS.RECEIVE,
  deliver: PAPERWORK_PERMISSIONS.DELIVER,
  processor_cancellation: PAPERWORK_PERMISSIONS.CANCEL,
  cancel: PAPERWORK_PERMISSIONS.CANCEL,
  reopen: PAPERWORK_PERMISSIONS.CANCEL,
  previous: PAPERWORK_PERMISSIONS.CORRECT,
  link: PAPERWORK_PERMISSIONS.CORRECT,
});

export function getPaperworkErrorMessage(error, fallback = 'تعذر تنفيذ الإجراء.') {
  const message = String(error?.message || '');
  const diagnostic = `${error?.code || ''} ${message}`.toLowerCase();
  if (
    diagnostic.includes('42501')
    || diagnostic.includes('paperwork_action_permission_required')
    || diagnostic.includes('permission denied')
    || diagnostic.includes('ليس لديك صلاحية لتنفيذ هذا الإجراء')
  ) {
    return 'ليس لديك صلاحية لتنفيذ هذا الإجراء.';
  }
  return message || fallback;
}
