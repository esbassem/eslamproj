import { useMemo, useState } from 'react';
import { CheckCircle2, CircleAlert, ClipboardPaste, Image, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import { Label } from '@/core/ui/label';
import {
  buildBulkReceivingColumns,
  createBulkReceivingRow,
  pasteBulkReceivingGrid,
  validateBulkReceivingRows,
} from '@/features/inventory/bulkReceiving.model';

const GENERIC_TRACKING_COLUMN = {
  key: 'identity:__tracking_number', kind: 'identity', id: '__tracking_number', label: 'رقم تتبع الوحدة', required: true,
};

export function BulkReceivingGrid({
  rows, onRowsChange, identifierDefinitions, attributes, documentDefinitions,
}) {
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const dynamicColumns = useMemo(() => buildBulkReceivingColumns(identifierDefinitions, attributes), [attributes, identifierDefinitions]);
  const columns = identifierDefinitions.length ? dynamicColumns : [GENERIC_TRACKING_COLUMN, ...dynamicColumns];
  const validatedRows = useMemo(
    () => validateBulkReceivingRows(rows, identifierDefinitions, attributes, documentDefinitions),
    [attributes, documentDefinitions, identifierDefinitions, rows],
  );
  const updateRow = (rowId, updater) => onRowsChange(rows.map((row) => (row.id === rowId ? updater(row) : row)));
  const applyPaste = () => {
    if (!pasteText.trim()) return;
    let result = pasteBulkReceivingGrid({ rows, columns, startRow: 0, startColumn: 0, text: pasteText });
    if (result.conflicts.length) {
      const overwrite = window.confirm(`اللصق سيستبدل ${result.conflicts.length} حقلًا يحتوي بيانات. هل تريد المتابعة؟`);
      if (!overwrite) return;
      result = pasteBulkReceivingGrid({ rows, columns, startRow: 0, startColumn: 0, text: pasteText, overwrite: true });
    }
    onRowsChange(result.rows);
    setPasteText('');
    setShowPaste(false);
  };

  return (
    <div className="space-y-3 text-[13px] md:col-span-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" className="h-8 rounded-md bg-slate-800 px-3 text-xs font-bold text-white shadow-none hover:bg-slate-700" onClick={() => onRowsChange([...rows, createBulkReceivingRow()])} disabled={rows.length >= 100}><Plus className="ml-1.5 h-3.5 w-3.5" />إضافة وحدة</Button>
          <Button type="button" variant="secondary" className="h-8 rounded-md border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 shadow-none hover:bg-slate-50" onClick={() => onRowsChange([...rows, ...Array.from({ length: Math.min(5, 100 - rows.length) }, () => createBulkReceivingRow())])} disabled={rows.length >= 100}><Plus className="ml-1.5 h-3.5 w-3.5" />إضافة 5 وحدات</Button>
          <Button type="button" variant="secondary" className="h-8 rounded-md border border-slate-300 bg-white px-3 text-xs font-bold text-slate-600 shadow-none hover:bg-slate-50" onClick={() => setShowPaste((current) => !current)}><ClipboardPaste className="ml-1.5 h-3.5 w-3.5" />لصق جماعي</Button>
        </div>
        {showPaste ? <div className="mt-3 space-y-2 border-t pt-3"><Label>الصق صفوف Excel بحسب ترتيب الحقول الظاهر</Label><textarea value={pasteText} onChange={(event) => setPasteText(event.target.value)} className="min-h-24 w-full rounded-xl border bg-white p-3 font-mono text-sm" dir="ltr" /><div className="text-xs font-bold text-slate-500">{columns.map((column) => column.label).join(' ← ')}</div><Button type="button" onClick={applyPaste} disabled={!pasteText.trim()}>توزيع البيانات</Button></div> : null}
      </div>

      <div className="space-y-2">
        {rows.map((row, rowIndex) => {
          const validation = validatedRows[rowIndex];
          return <article key={row.id} className="overflow-hidden rounded-lg bg-slate-100">
            <div className="flex w-full items-center justify-between gap-2 bg-transparent px-3 py-2 text-right">
              <span className="flex min-w-0 items-center gap-3"><input type="checkbox" checked={row.selected} onClick={(event) => event.stopPropagation()} onChange={(event) => updateRow(row.id, (current) => ({ ...current, selected: event.target.checked }))} /><span className="font-black text-slate-950">الوحدة {rowIndex + 1}</span><span className="truncate text-xs font-bold text-slate-500">{validation.trackingNumber || 'لم يُدخل رقم التتبع'}</span></span>
              <span className="flex flex-shrink-0 items-center gap-2">{validation.complete ? <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" />مكتملة</span> : <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700"><CircleAlert className="h-4 w-4" />تحتاج بيانات</span>}<button type="button" aria-label="حذف الوحدة" onClick={() => { const hasData = Object.values(row.identities).some(Boolean) || Object.values(row.attributes).some(Boolean) || Object.values(row.documents).some(Boolean); if (hasData && !window.confirm('هذه الوحدة تحتوي بيانات غير محفوظة. هل تريد حذفها؟')) return; if (rows.length > 1) onRowsChange(rows.filter((item) => item.id !== row.id)); }} className={`rounded-md p-1.5 text-red-600 ${rows.length === 1 ? 'pointer-events-none opacity-30' : ''}`}><Trash2 className="h-4 w-4" /></button></span>
            </div>
            <div className="space-y-3 p-3 pt-0">
              <UnitSection title="أرقام التتبع"><div className="flex flex-wrap gap-2">{identifierDefinitions.length ? identifierDefinitions.map((definition, index) => <IdentityField key={definition.identifierTypeId} row={row} definition={definition} primary={index === 0} onChange={(next) => updateRow(row.id, () => next)} />) : <Field className="sm:w-[170px]" label="رقم تتبع الوحدة" required><Input className="h-8 rounded-md border-0 bg-white text-[13px] shadow-none ring-1 ring-slate-200 focus-visible:ring-slate-400" value={row.identities.__tracking_number ?? ''} onChange={(event) => updateRow(row.id, (current) => ({ ...current, identities: { ...current.identities, __tracking_number: event.target.value } }))} dir="ltr" /></Field>}</div></UnitSection>
              {attributes.length ? <UnitSection title="خصائص الوحدة"><div className="flex flex-wrap gap-2">{attributes.map((attribute) => <Field key={attribute.id} label={attribute.name} required={attribute.isRequired}><BulkCellInput column={{ kind: 'attribute', id: attribute.id, definition: attribute }} value={row.attributes[attribute.id] ?? ''} onChange={(value) => updateRow(row.id, (current) => ({ ...current, attributes: { ...current.attributes, [attribute.id]: value } }))} /></Field>)}</div></UnitSection> : null}
              <UnitSection title="الصور والتوثيق"><div className="flex flex-wrap gap-2">{documentDefinitions.length ? documentDefinitions.map((document) => <label key={document.documentType} className="block w-full rounded-md p-2 sm:w-[210px]"><span className="mb-1.5 flex items-center gap-2 text-xs font-bold"><Image className="h-3.5 w-3.5" />{document.name}{document.isRequired ? <span className="text-red-600">*</span> : null}</span><input className="w-full text-xs file:ml-2 file:rounded-md file:border-0 file:bg-white file:px-2.5 file:py-1.5 file:text-xs file:font-bold file:text-slate-700" type="file" accept="image/*" onChange={(event) => updateRow(row.id, (current) => ({ ...current, documents: { ...current.documents, [document.documentType]: event.target.files?.[0] ?? null } }))} /><span className={`mt-1.5 block text-[11px] font-bold ${row.documents[document.documentType] ? 'text-emerald-700' : 'text-slate-500'}`}>{row.documents[document.documentType]?.name ?? (document.isRequired ? 'ناقصة — لن تمنع الاستلام' : 'اختيارية')}</span></label>) : <p className="text-sm text-slate-500">لا توجد متطبات صور لهذا التصنيف.</p>}</div></UnitSection>
            </div>
          </article>;
        })}
      </div>
    </div>
  );
}

function BulkCellInput({ column, value, onChange }) {
  if (!column) return <Input className="h-8 rounded-md border-0 bg-white text-[13px] shadow-none ring-1 ring-slate-200" value="" disabled />;
  if (column.kind === 'attribute' && column.definition?.inputMode !== 'text') return <select value={value} onChange={(event) => onChange(event.target.value)} className="h-8 w-full rounded-md border-0 bg-white px-2 text-[13px] outline-none ring-1 ring-slate-200 focus:ring-slate-400"><option value="">بدون</option>{(column.definition.values ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>;
  return <Input className="h-8 rounded-md border-0 bg-white text-[13px] shadow-none ring-1 ring-slate-200 focus-visible:ring-slate-400" value={value} onChange={(event) => onChange(event.target.value)} dir={column.kind === 'identity' ? 'ltr' : 'rtl'} />;
}

function IdentityField({ row, definition, primary, onChange }) {
  const unavailable = Boolean(row.identityNotAvailable?.[definition.identifierTypeId]);
  return <Field className="sm:w-[170px]" label={definition.name} required={primary || definition.isRequired} trailing={!primary && definition.allowNotAvailable ? <label className="text-[11px] font-bold text-slate-500"><input className="ml-1" type="checkbox" checked={unavailable} onChange={(event) => onChange({ ...row, identities: { ...row.identities, [definition.identifierTypeId]: event.target.checked ? '' : row.identities[definition.identifierTypeId] }, identityNotAvailable: { ...row.identityNotAvailable, [definition.identifierTypeId]: event.target.checked } })} />غير متوفر</label> : null}><Input className="h-8 rounded-md border-0 bg-white text-[13px] shadow-none ring-1 ring-slate-200 focus-visible:ring-slate-400" value={row.identities[definition.identifierTypeId] ?? ''} disabled={unavailable} onChange={(event) => onChange({ ...row, identities: { ...row.identities, [definition.identifierTypeId]: event.target.value } })} dir="ltr" /></Field>;
}

function Field({ className = 'sm:w-[140px]', label, required, trailing, children }) { return <div className={`w-full space-y-1 ${className}`}><div className="flex items-center justify-between gap-2"><Label className="text-xs">{label}{required ? <span className="text-red-600"> *</span> : null}</Label>{trailing}</div>{children}</div>; }
function UnitSection({ children }) { return <section className="space-y-2">{children}</section>; }
