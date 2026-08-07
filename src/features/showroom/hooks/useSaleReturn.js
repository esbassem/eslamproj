import { useCallback, useEffect, useMemo, useState } from 'react';
import { saleReturnService } from '@/features/showroom/services/saleReturn.service';

export function buildSaleReturnPayload(rows) {
  return rows.map((row) => ({
    sale_line_id: row.line.id,
    quantity: Number(row.quantity),
    action: row.action,
    new_tracking_unit_id: row.newTrackingUnitId || null,
    note: row.note?.trim() || null,
  }));
}

export function validateSaleReturnRows(rows) {
  if (!rows.length) return 'اختر سطرًا واحدًا على الأقل.';
  const alternatives = new Set();
  for (const row of rows) {
    const quantity = Number(row.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return 'الكمية المرتجعة يجب أن تكون أكبر من صفر.';
    if (quantity > Number(row.line.availableQuantity)) return 'الكمية المرتجعة تتجاوز المتاح.';
    if (row.action === 'exchange') {
      if (quantity !== 1) return 'الاستبدال بوحدة تتبع واحدة يتطلب كمية تساوي واحدًا.';
      if (!row.newTrackingUnitId) return 'اختر قطعة بديلة لكل سطر مستبدل.';
      if (alternatives.has(row.newTrackingUnitId)) return 'لا يمكن استخدام القطعة البديلة نفسها أكثر من مرة.';
      alternatives.add(row.newTrackingUnitId);
    }
  }
  return '';
}

export function useSaleReturn({ tenantId, sale, open }) {
  const [lines, setLines] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [rows, setRows] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [preview, setPreview] = useState(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [isLoading, setIsLoading] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !tenantId || !sale?.id) return undefined;
    let active = true;
    setIsLoading(true); setError(''); setPreview(null); setSelectedIds(new Set()); setRows([]); setIdempotencyKey(crypto.randomUUID());
    saleReturnService.listSaleReturnContext({ tenantId, sale })
      .then((nextLines) => active && setLines(nextLines))
      .catch((nextError) => active && setError(nextError.message))
      .finally(() => active && setIsLoading(false));
    return () => { active = false; };
  }, [open, sale, tenantId]);

  useEffect(() => {
    if (!open || !tenantId) return undefined;
    const timer = window.setTimeout(() => {
      saleReturnService.listReplacementCandidates({ tenantId, search: candidateSearch, limit: 50 })
        .then(setCandidates).catch((nextError) => setError(nextError.message));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [candidateSearch, open, tenantId]);

  const selectedLines = useMemo(() => lines.filter((line) => selectedIds.has(line.id)), [lines, selectedIds]);
  useEffect(() => setRows((current) => selectedLines.map((line) => current.find((row) => row.line.id === line.id)
    || { line, action: 'return', quantity: line.trackingUnitId ? 1 : line.availableQuantity, newTrackingUnitId: null, note: '' })), [selectedLines]);

  const toggleLine = useCallback((id) => setSelectedIds((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; }), []);
  const selectAll = useCallback(() => setSelectedIds(new Set(lines.filter((line) => !line.blockedReason).map((line) => line.id))), [lines]);
  const updateRow = useCallback((id, patch) => setRows((current) => current.map((row) => row.line.id === id ? { ...row, ...patch } : row)), []);
  const validationError = validateSaleReturnRows(rows);
  const loadPreview = useCallback(async () => {
    if (validationError) { setError(validationError); throw new Error(validationError); }
    setIsPreviewing(true); setError('');
    try { const result = await saleReturnService.previewConfirmedSaleReturn({ tenantId, saleId: sale.id, lines: buildSaleReturnPayload(rows) }); setPreview(result); return result; }
    catch (nextError) { setError(nextError.message); throw nextError; }
    finally { setIsPreviewing(false); }
  }, [rows, sale?.id, tenantId, validationError]);
  const submit = useCallback(async ({ reasonCode, reason }) => {
    if (validationError) throw new Error(validationError);
    setIsSubmitting(true); setError('');
    try { return await saleReturnService.createConfirmedSaleReturn({ tenantId, saleId: sale.id, lines: buildSaleReturnPayload(rows), reasonCode, reason, idempotencyKey }); }
    catch (nextError) { setError(nextError.message); throw nextError; }
    finally { setIsSubmitting(false); }
  }, [idempotencyKey, rows, sale?.id, tenantId, validationError]);

  return { lines, selectedIds, rows, candidates, candidateSearch, setCandidateSearch, preview, isLoading, isPreviewing, isSubmitting, error, validationError, toggleLine, selectAll, updateRow, loadPreview, submit };
}
