import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { paperworkService } from '@/features/paperwork/services/paperwork.service';

const labels = { release: 'اعتماد إذن صرف', previous: 'تسجيل صرف سابق', cancel: 'إلغاء صلاحية المستند', owner: 'تصحيح صاحب المستند' };

function DocumentActionDialog({ action, document, tenantId, onClose, onDone }) {
  const firstField = useRef(null);
  const [reason, setReason] = useState(''); const [notes, setNotes] = useState('');
  const [deliveredAt, setDeliveredAt] = useState(''); const [recipientType, setRecipientType] = useState('owner');
  const [recipientName, setRecipientName] = useState(''); const [partnerId, setPartnerId] = useState('');
  const [partners, setPartners] = useState([]); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  useEffect(() => { firstField.current?.focus(); }, []);
  useEffect(() => { if (action === 'owner') paperworkService.listPaperworkMoveTargets({ tenantId }).then((result) => setPartners(result.partners)).catch((nextError) => setError(nextError.message)); }, [action, tenantId]);
  const submit = async () => { setLoading(true); setError(''); try {
    if (action === 'release') await paperworkService.authorizePaperworkDocumentRelease({ tenantId, documentId: document.id, recipientType, recipientName, notes });
    if (action === 'previous') await paperworkService.recordPreviousPaperworkDocumentDelivery({ tenantId, documentId: document.id, deliveredAt: new Date(deliveredAt).toISOString(), reason, notes });
    if (action === 'cancel') await paperworkService.cancelPaperworkDocument({ tenantId, documentId: document.id, reason, notes });
    if (action === 'owner') await paperworkService.setPaperworkDocumentOwnerPartner({ tenantId, documentId: document.id, partnerId });
    await onDone(); onClose();
  } catch (nextError) { setError(nextError?.message || 'تعذر تنفيذ الإجراء.'); } finally { setLoading(false); } };
  const invalid = loading || (['previous', 'cancel'].includes(action) && !reason) || (action === 'previous' && !deliveredAt) || (action === 'owner' && !partnerId);
  return <Dialog.Root open onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[150] bg-slate-950/45" /><Dialog.Content className="fixed inset-x-0 bottom-0 z-[151] w-full rounded-t-3xl bg-white p-5 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl" aria-describedby={undefined}><div className="flex items-center justify-between"><h2 className="font-black">{labels[action]}</h2><button onClick={onClose} className="grid h-10 w-10 place-items-center rounded-xl" aria-label="إغلاق"><X className="h-5 w-5" /></button></div><div className="mt-5 space-y-4">{action === 'release' ? <><label className="block text-sm font-black">المستلم<select ref={firstField} value={recipientType} onChange={(event) => setRecipientType(event.target.value)} className="mt-2 h-11 w-full rounded-xl border px-3"><option value="owner">صاحب المستند</option><option value="other">شخص آخر</option></select></label>{recipientType === 'other' ? <label className="block text-sm font-black">اسم المستلم<input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} className="mt-2 h-11 w-full rounded-xl border px-3" /></label> : null}</> : null}{['previous', 'cancel'].includes(action) ? <label className="block text-sm font-black">السبب<input ref={firstField} value={reason} onChange={(event) => setReason(event.target.value)} className="mt-2 h-11 w-full rounded-xl border px-3" /></label> : null}{action === 'previous' ? <label className="block text-sm font-black">تاريخ ووقت التسليم<input type="datetime-local" value={deliveredAt} onChange={(event) => setDeliveredAt(event.target.value)} className="mt-2 h-11 w-full rounded-xl border px-3" /></label> : null}{action === 'owner' ? <label className="block text-sm font-black">صاحب المستند<select ref={firstField} value={partnerId} onChange={(event) => setPartnerId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border px-3"><option value="">اختر Partner</option>{partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name}</option>)}</select></label> : null}{action !== 'owner' ? <label className="block text-sm font-black">ملاحظات<textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-2 min-h-24 w-full rounded-xl border p-3" /></label> : null}{error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-black text-red-700">{error}</p> : null}<button disabled={invalid} onClick={submit} className="h-11 w-full rounded-xl bg-blue-600 text-sm font-black text-white disabled:opacity-40">{loading ? 'جارٍ التنفيذ…' : 'تأكيد الإجراء'}</button></div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

export function DocumentActions({ document, tenantId, isOwner, onChanged }) {
  const [menuOpen, setMenuOpen] = useState(false); const [action, setAction] = useState(null);
  if (!isOwner) return null;
  const actions = [{ id: 'owner', label: labels.owner }];
  if (document.status === 'in_custody') actions.unshift({ id: 'release', label: labels.release }, { id: 'previous', label: labels.previous }, { id: 'cancel', label: labels.cancel });
  return <div className="relative"><button type="button" onClick={() => setMenuOpen((value) => !value)} className="grid h-10 w-10 place-items-center rounded-xl border bg-white" aria-label="الإجراءات الاستثنائية" aria-expanded={menuOpen}><MoreHorizontal className="h-5 w-5" /></button>{menuOpen ? <div className="absolute left-0 top-12 z-20 w-60 rounded-xl border bg-white p-1 shadow-xl">{actions.map((item) => <button key={item.id} onClick={() => { setMenuOpen(false); setAction(item.id); }} className="block w-full rounded-lg px-3 py-2.5 text-right text-sm font-black hover:bg-slate-50">{item.label}</button>)}</div> : null}{action ? <DocumentActionDialog action={action} document={document} tenantId={tenantId} onClose={() => setAction(null)} onDone={onChanged} /> : null}</div>;
}
