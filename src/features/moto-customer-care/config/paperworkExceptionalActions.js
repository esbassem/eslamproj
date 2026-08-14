import { ArchiveRestore, Ban, FileCheck2 } from 'lucide-react';

// هذا هو السجل المركزي لكل الإجراءات الاستثنائية الخاصة بطلبات الأوراق.
// عند تنفيذ إجراء جديد: فعّله هنا، ثم أضف معالج الـ id نفسه إلى
// executePaperworkExceptionalAction داخل motoCustomerCare.service.js.
export const PAPERWORK_EXCEPTIONAL_ACTION_IDS = Object.freeze({
  PREVIOUS_CUSTOMER_DELIVERY: 'previous_customer_delivery',
  LINK_EXISTING_VAULT_DOCUMENT: 'link_existing_vault_document',
  CANCEL: 'cancel',
});

export const PAPERWORK_EXCEPTIONAL_ACTIONS = [
  { id: PAPERWORK_EXCEPTIONAL_ACTION_IDS.PREVIOUS_CUSTOMER_DELIVERY, label: 'تسجيل أن العميل استلم الأوراق سابقًا', icon: FileCheck2, disabled: false },
  { id: PAPERWORK_EXCEPTIONAL_ACTION_IDS.LINK_EXISTING_VAULT_DOCUMENT, label: 'الورق مستلم سابقًا وموجود حاليًا بالخزنة', icon: ArchiveRestore, disabled: false },
  { id: PAPERWORK_EXCEPTIONAL_ACTION_IDS.CANCEL, label: 'إلغاء الطلب', icon: Ban, disabled: false, tone: 'danger', dividerAfter: true },
];
