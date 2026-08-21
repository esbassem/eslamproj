import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { MoreHorizontal, X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { useAuthorization } from '@/core/authorization/useAuthorization';
import { getPaperworkErrorMessage, PAPERWORK_PERMISSIONS, REQUEST_ACTION_PERMISSIONS } from '@/features/paperwork/authorization/paperworkPermissions';
import { paperworkService } from '@/features/paperwork/services/paperwork.service';
import { paperworkReadService } from '@/features/paperwork/services/queries/paperworkRead.service';
import { getRequestPrimaryAction } from '@/features/paperwork/adapters/paperworkViewModels';

const BulkReceipt = lazy(() => import('@/features/paperwork/processors/BulkReceiptFlow').then((module) => ({ default: module.BulkReceiptFlow })));

const actionLabels = {
  send: 'إرسال الطلب إلى جهة الإصدار', receive: 'استلام الورق من الجهة', deliver: 'تسليم الورق للعميل',
  processor_cancellation: 'تأكيد إلغاء الطلب لدى الجهة', cancel: 'إلغاء الطلب',
  reopen: 'إعادة فتح الطلب', previous: 'تسجيل تسليم سابق', link: 'ربط مستند موجود بالخزنة',
};

function ActionDialog({ action, request, tenantId, onClose, onDone }) {
  const firstField = useRef(null);
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [file, setFile] = useState(null);
  const [documentId, setDocumentId] = useState('');
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { firstField.current?.focus(); }, []);
  useEffect(() => {
    if (action !== 'link') return;
    paperworkReadService.listVaultCandidates({ tenantId, trackingUnitId: request.trackingUnitId }).then(setDocuments).catch((nextError) => setError(nextError.message));
  }, [action, request.trackingUnitId, tenantId]);
  const submit = async () => {
    setLoading(true); setError('');
    try {
      if (action === 'send') await paperworkService.sendPaperworkRequestToProcessor({ tenantId, requestId: request.id, notes });
      if (action === 'deliver') await paperworkService.deliverPaperworkToCustomer({ tenantId, requestId: request.id, receiptImage: file });
      if (action === 'processor_cancellation') await paperworkService.confirmProcessorPaperworkCancellation({ tenantId, requestId: request.id, notes });
      if (action === 'cancel') await paperworkService.cancelPaperworkRequest({ tenantId, requestId: request.id, reason, notes, processorCancellationConfirmed: true });
      if (action === 'reopen') await paperworkService.reopenCancelledPaperworkRequest({ tenantId, requestId: request.id, notes });
      if (action === 'previous') await paperworkService.recordPreviousCustomerDelivery({ tenantId, requestId: request.id, reason, notes });
      if (action === 'link') await paperworkService.linkExistingVaultDocumentToRequest({ tenantId, requestId: request.id, documentId, notes });
      await onDone(); onClose();
    } catch (nextError) { setError(getPaperworkErrorMessage(nextError)); } finally { setLoading(false); }
  };
  return <Dialog.Root open onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[150] bg-slate-950/45" /><Dialog.Content className="fixed inset-x-0 bottom-0 z-[151] w-full rounded-t-3xl bg-white p-5 shadow-2xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl" aria-describedby={undefined}><div className="flex items-center justify-between"><h2 id="request-action-title" className="font-black">{actionLabels[action]}</h2><button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-slate-100" aria-label="إغلاق"><X className="h-5 w-5" /></button></div><div className="mt-5 space-y-4">{['cancel', 'previous'].includes(action) ? <label className="block text-sm font-black">السبب<input ref={firstField} value={reason} onChange={(event) => setReason(event.target.value)} className="mt-2 h-11 w-full rounded-xl border px-3" /></label> : null}{action === 'deliver' ? <label className="block text-sm font-black">صورة إيصال التسليم<input ref={firstField} type="file" accept="image/*" onChange={(event) => setFile(event.target.files?.[0] || null)} className="mt-2 block w-full text-sm" /></label> : null}{action === 'link' ? <label className="block text-sm font-black">المستند<select ref={firstField} value={documentId} onChange={(event) => setDocumentId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border px-3"><option value="">اختر مستندًا</option>{documents.map((document) => <option key={document.id} value={document.id}>{document.title} — {document.ownerName}</option>)}</select></label> : null}<label className="block text-sm font-black">ملاحظات<textarea ref={!['cancel', 'previous', 'deliver', 'link'].includes(action) ? firstField : undefined} value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-2 min-h-24 w-full rounded-xl border p-3" /></label>{error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-black text-red-700">{error}</p> : null}<button type="button" disabled={loading || (['cancel', 'previous'].includes(action) && !reason) || (action === 'deliver' && !file) || (action === 'link' && !documentId)} onClick={submit} className="h-11 w-full rounded-xl bg-blue-600 text-sm font-black text-white disabled:opacity-40">{loading ? 'جارٍ التنفيذ…' : 'تأكيد الإجراء'}</button></div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

export function RequestActions({ request, tenantId, onChanged }) {
  const { can } = useAuthorization();
  const [action, setAction] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const primary = getRequestPrimaryAction(request);
  const allowedPrimary = primary && can(REQUEST_ACTION_PERMISSIONS[primary.id]) ? primary : null;
  const linkStages = new Set(['preparation', 'owner_confirmation', 'sent_to_processor', 'processor_ready']);
  const cancelStages = new Set(['preparation', 'owner_confirmation', 'sent_to_processor']);
  const exceptional = request.status === 'cancelled'
    ? (can(PAPERWORK_PERMISSIONS.CANCEL) ? [{ id: 'reopen', label: 'إعادة فتح الطلب' }] : [])
    : [
      can(PAPERWORK_PERMISSIONS.CORRECT) && request.status === 'open' && request.currentStage !== 'delivered'
        ? { id: 'previous', label: 'تسجيل تسليم سابق' } : null,
      can(PAPERWORK_PERMISSIONS.CORRECT) && request.status === 'open' && linkStages.has(request.currentStage)
        ? { id: 'link', label: 'ربط مستند من الخزنة' } : null,
      can(PAPERWORK_PERMISSIONS.CANCEL) && request.status === 'open' && cancelStages.has(request.currentStage)
        ? { id: 'cancel', label: 'إلغاء الطلب' } : null,
    ].filter(Boolean);
  if (action === 'receive') {
    const processor = { id: request.processor?.id, name: request.processor?.name, requests: [{ ...request, customerName: request.customer?.name || '', customerPhone: request.customer?.phone || '', trackingIdentifiers: request.trackingIdentifiers || [] }] };
    return <Suspense fallback={null}><BulkReceipt processor={processor} open onOpenChange={(open) => { if (!open) setAction(null); }} tenantId={tenantId} onReceived={onChanged} /></Suspense>;
  }
  return <div className="relative flex gap-2">{allowedPrimary ? <button type="button" disabled={allowedPrimary.disabled} onClick={() => !allowedPrimary.disabled && setAction(allowedPrimary.id)} className="h-10 rounded-xl bg-blue-600 px-4 text-sm font-black text-white disabled:bg-emerald-600">{allowedPrimary.label}</button> : null}{exceptional.length ? <button type="button" onClick={() => setMenuOpen((value) => !value)} className="grid h-10 w-10 place-items-center rounded-xl border bg-white" aria-label="المزيد من الإجراءات" aria-expanded={menuOpen}><MoreHorizontal className="h-5 w-5" /></button> : null}{menuOpen && exceptional.length ? <div className="absolute left-0 top-12 z-20 w-64 rounded-xl border bg-white p-1 shadow-xl">{exceptional.map((item) => <button key={item.id} type="button" onClick={() => { setMenuOpen(false); setAction(item.id); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-right text-sm font-black hover:bg-slate-50">{item.label}</button>)}</div> : null}{action ? <ActionDialog action={action} request={request} tenantId={tenantId} onClose={() => setAction(null)} onDone={onChanged} /> : null}</div>;
}
