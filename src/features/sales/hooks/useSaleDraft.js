import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { salesService } from '@/features/sales/services/sales.service';
import {
  buildDraftCommandPayload,
  createDraftLine,
  draftLineTotal,
  validateDraftForm,
} from '@/features/sales/services/salesDraft.model';

const today = () => new Date().toISOString().slice(0, 10);

function attemptKey(ref, prefix, fingerprint) {
  if (ref.current.fingerprint !== fingerprint) {
    ref.current = { fingerprint, key: `${prefix}-${crypto.randomUUID()}` };
  }
  return ref.current.key;
}
function initialForm(sale) {
  return {
    branchId: sale?.branch?.id ?? '',
    customer: sale?.customer?.id ? sale.customer : null,
    effectiveSaleDate: sale?.effectiveSaleDate || today(),
    currencyCode: sale?.currencyCode || 'EGP',
    notes: sale?.notes || '',
    locationId: sale?.draftInventoryLocationId || '',
    lines: sale?.lines ?? [],
  };
}

export function useSaleDraft({ tenantId, initialSale = null, onSaved }) {
  const [form, setForm] = useState(() => initialForm(initialSale));
  const [options, setOptions] = useState({ branches: [], locations: [], defaultBranchId: null, defaultStockLocationId: null });
  const [status, setStatus] = useState('loading');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [readiness, setReadiness] = useState(null);
  const [version, setVersion] = useState(initialSale?.version ?? 1);
  const createdDraftRef = useRef(initialSale?.id ? { saleId: initialSale.id, version: initialSale.version } : null);
  const createAttemptRef = useRef({ fingerprint: '', key: '' });
  const updateAttemptRef = useRef({ fingerprint: '', key: '' });
  const submitLockRef = useRef(false);

  const loadOptions = useCallback(async () => {
    if (!tenantId) return;
    setStatus('loading');
    setError('');
    try {
      const nextOptions = await salesService.getSaleDraftOptions({ tenantId });
      setOptions(nextOptions);
      setForm((current) => {
        if (initialSale?.id || current.branchId) return current;
        const branchId = nextOptions.defaultBranchId
          || (nextOptions.branches.length === 1 ? nextOptions.branches[0].id : '');
        const locations = nextOptions.locations.filter((location) => location.branchId === branchId);
        const locationId = nextOptions.defaultStockLocationId
          && locations.some((location) => location.id === nextOptions.defaultStockLocationId)
          ? nextOptions.defaultStockLocationId
          : locations.length === 1 ? locations[0].id : '';
        return { ...current, branchId, locationId };
      });
      setStatus('ready');
    } catch (nextError) {
      setError(nextError.message);
      setStatus('error');
    }
  }, [initialSale?.id, tenantId]);

  useEffect(() => { void loadOptions(); }, [loadOptions]);

  const branchLocations = useMemo(
    () => options.locations.filter((location) => location.branchId === form.branchId),
    [form.branchId, options.locations],
  );
  const total = useMemo(() => form.lines.reduce((sum, line) => sum + draftLineTotal(line), 0), [form.lines]);

  const setField = (field, value) => {
    setError(''); setSuccess('');
    setForm((current) => ({ ...current, [field]: value }));
  };

  const setBranch = (branchId) => {
    const locations = options.locations.filter((location) => location.branchId === branchId);
    const preferred = options.defaultStockLocationId
      && locations.some((location) => location.id === options.defaultStockLocationId)
      ? options.defaultStockLocationId
      : locations.length === 1 ? locations[0].id : '';
    setError(''); setSuccess('');
    setForm((current) => ({
      ...current,
      branchId,
      locationId: preferred,
      lines: current.lines.map((line) => ({ ...line, trackingUnit: null })),
    }));
  };

  const setLocation = (locationId) => {
    setError(''); setSuccess('');
    setForm((current) => ({
      ...current,
      locationId,
      lines: current.lines.map((line) => ({ ...line, trackingUnit: null })),
    }));
  };

  const addProduct = (product) => {
    setError(''); setSuccess('');
    setForm((current) => ({ ...current, lines: [...current.lines, createDraftLine(product)] }));
  };

  const updateLine = (key, changes) => {
    setError(''); setSuccess('');
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line) => line.key === key ? { ...line, ...changes } : line),
    }));
  };

  const removeLine = (key) => {
    setError(''); setSuccess('');
    setForm((current) => ({ ...current, lines: current.lines.filter((line) => line.key !== key) }));
  };

  const save = async () => {
    if (submitLockRef.current) return;
    const validation = validateDraftForm(form);
    if (validation) { setError(validation); return; }
    const payload = buildDraftCommandPayload(form);
    const payloadFingerprint = JSON.stringify(payload);
    submitLockRef.current = true;
    setSaving(true); setError(''); setSuccess('');
    try {
      let draft = createdDraftRef.current;
      if (!draft) {
        const header = JSON.stringify({
          branchId: payload.branchId, customerId: payload.customerId,
          effectiveSaleDate: payload.effectiveSaleDate, currencyCode: payload.currencyCode, notes: payload.notes,
        });
        const created = await salesService.createSale({
          tenantId,
          branchId: payload.branchId,
          customerId: payload.customerId,
          effectiveSaleDate: payload.effectiveSaleDate,
          currencyCode: payload.currencyCode,
          notes: payload.notes,
          idempotencyKey: attemptKey(createAttemptRef, 'sales-draft-create', header),
        });
        draft = { saleId: created.sale_id, version: Number(created.version) || 1 };
        createdDraftRef.current = draft;
        setVersion(draft.version);
      }
      const updateKey = attemptKey(
        updateAttemptRef,
        'sales-draft-update',
        `${draft.saleId}:${draft.version}:${payloadFingerprint}`,
      );
      const updated = await salesService.updateSaleDraft({
        tenantId,
        saleId: draft.saleId,
        expectedVersion: draft.version,
        payload,
        idempotencyKey: updateKey,
      });
      const nextVersion = Number(updated.version) || draft.version;
      createdDraftRef.current = { saleId: draft.saleId, version: nextVersion };
      setVersion(nextVersion);
      setSuccess('تم حفظ المسودة.');
      try {
        setReadiness(await salesService.getSaleReadiness({ tenantId, saleId: draft.saleId }));
      } catch {
        setReadiness(null);
      }
      await onSaved?.({ saleId: draft.saleId, version: nextVersion, created: !initialSale?.id });
    } catch (nextError) {
      setError(nextError.message || 'تعذر حفظ المسودة. حاول مرة أخرى.');
    } finally {
      submitLockRef.current = false;
      setSaving(false);
    }
  };

  return {
    form, options, branchLocations, total, version, status, saving, error, success, readiness,
    retryOptions: loadOptions, setField, setBranch, setLocation, addProduct, updateLine, removeLine, save,
  };
}
