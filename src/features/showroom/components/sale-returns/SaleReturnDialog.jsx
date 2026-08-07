import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { useSaleReturn } from '@/features/showroom/hooks/useSaleReturn';
import { SALE_RETURN_STEPS } from '@/features/showroom/constants/saleReturn.constants';
import { SaleReturnLinesStep } from './SaleReturnLinesStep';
import { SaleReturnActionStep } from './SaleReturnActionStep';
import { SaleReturnReplacementUnitsStep } from './SaleReturnReplacementUnitsStep';
import { SaleReturnReasonStep } from './SaleReturnReasonStep';
import { SaleReturnReviewStep } from './SaleReturnReviewStep';

export function SaleReturnDialog({ open, onOpenChange, tenantId, sale, onSuccess }) {
  const workflow = useSaleReturn({ tenantId, sale, open });
  const [step, setStep] = useState(0);
  const [reasonCode, setReasonCode] = useState('');
  const [reason, setReason] = useState('');
  const hasExchange = workflow.rows.some((row) => row.action === 'exchange');

  useEffect(() => {
    if (open) { setStep(0); setReasonCode(''); setReason(''); }
  }, [open]);

  const updateAction = (id, action, quantity) => {
    const current = workflow.rows.find((row) => row.line.id === id);
    workflow.updateRow(id, {
      action,
      quantity: quantity ?? current?.quantity,
      newTrackingUnitId: action === 'return' ? null : current?.newTrackingUnitId,
    });
  };
  const next = async () => {
    if (step === 1 && !hasExchange) { setStep(3); return; }
    if (step === 3) { await workflow.loadPreview(); setStep(4); return; }
    setStep((value) => value + 1);
  };
  const previous = () => setStep((value) => value === 3 && !hasExchange ? 1 : value - 1);
  const canContinue = step === 0 ? workflow.rows.length > 0
    : step === 2 ? !workflow.validationError
      : step === 3 ? Boolean(reasonCode && reason.trim()) : true;
  const submit = async () => {
    const result = await workflow.submit({ reasonCode, reason: reason.trim() });
    await onSuccess?.(result); onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[2147483644] bg-slate-950/60" />
        <Dialog.Content dir="rtl" className="fixed left-1/2 top-1/2 z-[2147483645] flex max-h-[92vh] w-[calc(100vw-1rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
          <header className="flex items-center justify-between border-b p-4">
            <div><Dialog.Title className="font-black">مرتجع أو استبدال</Dialog.Title><p className="text-xs text-slate-500">{SALE_RETURN_STEPS[step]} · المرحلة {step + 1} من 5</p></div>
            <Dialog.Close className="p-2"><X className="h-4 w-4" /></Dialog.Close>
          </header>
          <div className="overflow-y-auto p-5">
            {step === 0 && <SaleReturnLinesStep lines={workflow.lines} selected={workflow.selectedIds} onToggle={workflow.toggleLine} onAll={workflow.selectAll} />}
            {step === 1 && <SaleReturnActionStep rows={workflow.rows} onChange={updateAction} />}
            {step === 2 && <SaleReturnReplacementUnitsStep rows={workflow.rows} candidates={workflow.candidates} search={workflow.candidateSearch} onSearch={workflow.setCandidateSearch} onChange={(id, value) => workflow.updateRow(id, { newTrackingUnitId: value })} />}
            {step === 3 && <SaleReturnReasonStep code={reasonCode} reason={reason} onCode={setReasonCode} onReason={setReason} />}
            {step === 4 && <SaleReturnReviewStep sale={sale} rows={workflow.rows} preview={workflow.preview} />}
            {workflow.isLoading && <p>جاري تجهيز السطور...</p>}
            {workflow.error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700">{workflow.error}</p>}
          </div>
          <footer className="flex justify-between border-t p-4">
            <button type="button" disabled={!step || workflow.isSubmitting} onClick={previous} className="flex h-10 items-center gap-1 rounded-xl border px-4 disabled:opacity-40"><ArrowRight className="h-4 w-4" />السابق</button>
            {step < 4 ? <button type="button" disabled={!canContinue || workflow.isPreviewing} onClick={next} className="flex h-10 items-center gap-1 rounded-xl bg-blue-600 px-4 font-black text-white disabled:opacity-40">{workflow.isPreviewing ? 'جاري المعاينة...' : 'التالي'}<ArrowLeft className="h-4 w-4" /></button>
              : <button type="button" disabled={workflow.isSubmitting} onClick={submit} className="rounded-xl bg-red-600 px-4 font-black text-white disabled:opacity-50">{workflow.isSubmitting ? 'جاري التنفيذ...' : hasExchange ? 'تأكيد المرتجع والاستبدال' : 'تأكيد المرتجع'}</button>}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
