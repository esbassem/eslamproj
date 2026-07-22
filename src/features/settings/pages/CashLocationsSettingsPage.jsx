import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, Plus, Trash2, WalletCards, X } from 'lucide-react';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import { Label } from '@/core/ui/label';
import { PageHeader } from '@/core/ui/page-header';
import { cashLocationsSettingsService } from '@/features/settings/services/cashLocationsSettings.service';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

function AddCustodyAccountDialog({ open, onOpenChange, tenantId, employees, isLoadingEmployees, onCreated }) {
  const [responsibleUserId, setResponsibleUserId] = useState('');
  const [accountName, setAccountName] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setResponsibleUserId('');
    setAccountName('');
    setError('');
    setIsSubmitting(false);
  }, [open]);

  const handleEmployeeChange = (event) => {
    const employeeId = event.target.value;
    const employee = employees.find((item) => item.id === employeeId);
    setResponsibleUserId(employeeId);
    setAccountName(employee ? `نقدية لدى ${employee.fullName}` : '');
    setError('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const normalizedName = accountName.trim();

    if (!responsibleUserId) {
      setError('اختر الموظف المسؤول.');
      return;
    }

    if (!normalizedName) {
      setError('اكتب اسم حساب العهدة.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      await cashLocationsSettingsService.createCustodyAccount({
        tenantId,
        responsibleUserId,
        name: normalizedName,
      });
      await onCreated();
      onOpenChange(false);
    } catch (submitError) {
      setError(submitError.message || 'تعذر إنشاء حساب العهدة.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !isSubmitting && onOpenChange(nextOpen)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(calc(100vw-1.5rem),30rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl bg-white shadow-2xl outline-none"
          dir="rtl"
        >
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
            <div>
              <Dialog.Title className="text-lg font-black text-slate-950">إضافة حساب عهدة</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs font-medium text-slate-500">
                أنشئ حساب عهدة مرتبطًا بموظف من المؤسسة.
              </Dialog.Description>
            </div>
            <Dialog.Close className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200">
              <X className="h-4 w-4" />
              <span className="sr-only">إغلاق</span>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 p-5">
            <div className="space-y-2">
              <Label htmlFor="custody-responsible-user" className="font-bold">الموظف المسؤول</Label>
              <select
                id="custody-responsible-user"
                value={responsibleUserId}
                onChange={handleEmployeeChange}
                disabled={isLoadingEmployees || isSubmitting}
                className="h-11 w-full rounded-xl border border-border bg-white px-4 text-right text-sm text-slate-900 outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-100 disabled:opacity-60"
              >
                <option value="">{isLoadingEmployees ? 'جاري تحميل الموظفين...' : 'اختر الموظف'}</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>{employee.fullName}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="custody-account-name" className="font-bold">اسم حساب العهدة</Label>
              <Input
                id="custody-account-name"
                value={accountName}
                onChange={(event) => setAccountName(event.target.value)}
                disabled={isSubmitting}
                placeholder="نقدية لدى اسم الموظف"
                autoComplete="off"
              />
            </div>

            {error ? (
              <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-bold text-red-700">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                إلغاء
              </Button>
              <Button type="submit" disabled={isSubmitting || isLoadingEmployees}>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isSubmitting ? 'جاري الحفظ...' : 'حفظ'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DeleteCustodyAccountDialog({ account, onOpenChange, tenantId, onDeleted }) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');
  const open = Boolean(account);

  useEffect(() => {
    if (!open) return;
    setError('');
    setIsDeleting(false);
  }, [account?.id, open]);

  const handleDelete = async () => {
    if (!account?.id) return;

    setIsDeleting(true);
    setError('');
    try {
      await cashLocationsSettingsService.deleteCustodyAccount({
        tenantId,
        accountId: account.id,
      });
      await onDeleted();
      onOpenChange(false);
    } catch (deleteError) {
      setError(deleteError.message || 'تعذر حذف حساب العهدة.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !isDeleting && onOpenChange(nextOpen)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(calc(100vw-1.5rem),28rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl bg-white shadow-2xl outline-none"
          dir="rtl"
        >
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
            <div>
              <Dialog.Title className="text-lg font-black text-slate-950">حذف حساب العهدة</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs font-medium text-slate-500">
                يمكن حذف الحساب فقط إذا لم تُسجّل عليه أي قيود محاسبية.
              </Dialog.Description>
            </div>
            <Dialog.Close className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200">
              <X className="h-4 w-4" />
              <span className="sr-only">إغلاق</span>
            </Dialog.Close>
          </div>

          <div className="space-y-4 p-5">
            <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm font-bold text-slate-800">
              هل تريد حذف «{account?.name}»؟
            </p>

            {error ? (
              <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-bold text-red-700">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isDeleting}>
                إلغاء
              </Button>
              <Button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {isDeleting ? 'جاري الحذف...' : 'حذف الحساب'}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function CashLocationsSettingsPage() {
  const { tenant } = useWorkspace();
  const tenantId = tenant?.id ?? null;
  const [employees, setEmployees] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [accountToDelete, setAccountToDelete] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const loadPageData = useCallback(async () => {
    if (!tenantId) return;

    setIsLoading(true);
    setError('');
    try {
      const [employeeRecords, accountRecords] = await Promise.all([
        cashLocationsSettingsService.listEmployees(tenantId),
        cashLocationsSettingsService.listCustodyAccounts(tenantId),
      ]);
      setEmployees(employeeRecords);
      setAccounts(accountRecords);
    } catch (loadError) {
      setError(loadError.message || 'تعذر تحميل صفحة الخزائن والعهد.');
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    loadPageData();
  }, [loadPageData]);

  const employeesById = useMemo(
    () => new Map(employees.map((employee) => [employee.id, employee])),
    [employees],
  );

  const handleCreated = async () => {
    await loadPageData();
    setSuccessMessage('تم إنشاء حساب العهدة بنجاح');
  };

  const handleDeleted = async () => {
    await loadPageData();
    setSuccessMessage('تم حذف حساب العهدة بنجاح');
  };

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="الخزائن والعهد"
        description="إدارة حسابات عهد الموظفين."
        actions={(
          <Button onClick={() => { setSuccessMessage(''); setIsDialogOpen(true); }}>
            <Plus className="h-4 w-4" />
            إضافة حساب عهدة
          </Button>
        )}
      />

      {successMessage ? (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
          {successMessage}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-10 text-sm font-bold text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            جاري تحميل حسابات العهد...
          </div>
        ) : accounts.length ? (
          <div className="divide-y divide-slate-100">
            {accounts.map((account) => (
              <div key={account.id} className="flex items-center gap-3 px-5 py-4">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                  <WalletCards className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black text-slate-950">{account.name}</p>
                  <p className="mt-1 text-xs font-medium text-slate-500">
                    {employeesById.get(account.responsible_user_id)?.fullName || 'موظف غير محدد'}
                    {account.code ? ` · ${account.code}` : ''}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${
                  account.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                }`}>
                  {account.active ? 'نشط' : 'غير نشط'}
                </span>
                <button
                  type="button"
                  onClick={() => { setSuccessMessage(''); setAccountToDelete(account); }}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200"
                  aria-label={`حذف حساب ${account.name}`}
                  title="حذف الحساب"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-5 py-10 text-center text-sm font-bold text-slate-500">لا توجد حسابات عهدة حتى الآن.</div>
        )}
      </section>

      <AddCustodyAccountDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        tenantId={tenantId}
        employees={employees}
        isLoadingEmployees={isLoading}
        onCreated={handleCreated}
      />

      <DeleteCustodyAccountDialog
        account={accountToDelete}
        onOpenChange={(nextOpen) => { if (!nextOpen) setAccountToDelete(null); }}
        tenantId={tenantId}
        onDeleted={handleDeleted}
      />
    </div>
  );
}
