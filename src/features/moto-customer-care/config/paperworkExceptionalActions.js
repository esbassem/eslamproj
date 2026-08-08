import { ArchiveRestore, Ban, FileCheck2, FileDown, ListRestart, PauseCircle, PlayCircle, RotateCcw, SendHorizontal } from 'lucide-react';

// هذا هو السجل المركزي لكل الإجراءات الاستثنائية الخاصة بطلبات الأوراق.
// عند تنفيذ إجراء جديد: فعّله هنا، ثم أضف معالج الـ id نفسه إلى
// executePaperworkExceptionalAction داخل motoCustomerCare.service.js.
export const PAPERWORK_EXCEPTIONAL_ACTION_IDS = Object.freeze({
  PREVIOUS_CUSTOMER_DELIVERY: 'previous_customer_delivery',
  LINK_EXISTING_VAULT_DOCUMENT: 'link_existing_vault_document',
  DIRECT_PROCESSOR_RECEIPT: 'direct_processor_receipt',
  PREVIOUS_PROCESSOR_SEND: 'previous_processor_send',
  MOVE_STAGE: 'move_stage',
  CANCEL: 'cancel',
  REOPEN: 'reopen',
  PAUSE: 'pause',
  RESUME: 'resume',
});

export const PAPERWORK_EXCEPTIONAL_ACTIONS = [
  { id: PAPERWORK_EXCEPTIONAL_ACTION_IDS.PREVIOUS_CUSTOMER_DELIVERY, label: 'تسجيل أن العميل استلم الأوراق سابقًا', icon: FileCheck2, disabled: false },
  { id: PAPERWORK_EXCEPTIONAL_ACTION_IDS.LINK_EXISTING_VAULT_DOCUMENT, label: 'الورق مستلم سابقًا وموجود حاليًا بالخزنة', icon: ArchiveRestore, disabled: false },
  { id: PAPERWORK_EXCEPTIONAL_ACTION_IDS.DIRECT_PROCESSOR_RECEIPT, label: 'تسجيل استلام الأوراق من جهة الإصدار مباشرة', icon: FileDown, disabled: true },
  { id: PAPERWORK_EXCEPTIONAL_ACTION_IDS.PREVIOUS_PROCESSOR_SEND, label: 'تسجيل أن الطلب أُرسل إلى جهة الإصدار سابقًا', icon: SendHorizontal, disabled: true },
  { id: PAPERWORK_EXCEPTIONAL_ACTION_IDS.MOVE_STAGE, label: 'الانتقال إلى مرحلة أخرى...', icon: ListRestart, disabled: true, dividerAfter: true },
  { id: PAPERWORK_EXCEPTIONAL_ACTION_IDS.CANCEL, label: 'إلغاء الطلب', icon: Ban, disabled: false, tone: 'danger', dividerAfter: true },
  { id: PAPERWORK_EXCEPTIONAL_ACTION_IDS.REOPEN, label: 'إعادة فتح الطلب', icon: RotateCcw, disabled: true },
  { id: PAPERWORK_EXCEPTIONAL_ACTION_IDS.PAUSE, label: 'إيقاف الطلب مؤقتًا', icon: PauseCircle, disabled: true },
  { id: PAPERWORK_EXCEPTIONAL_ACTION_IDS.RESUME, label: 'استئناف الطلب', icon: PlayCircle, disabled: true },
];
