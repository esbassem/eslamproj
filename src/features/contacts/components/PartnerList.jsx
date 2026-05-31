import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge } from '@/core/ui/badge';
import { LoadingSpinner } from '@/core/ui/loading-spinner';
import { ContactsHeader } from '@/features/contacts/components/ContactsHeader';
import { PartnerCard } from '@/features/contacts/components/PartnerCard';
import { PartnerFormSheet } from '@/features/contacts/components/PartnerFormSheet';
import { partnersService } from '@/features/contacts/services/partners.service';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

const PAGE_META = {
  all: {
    title: 'جهات الاتصال',
    subtitle: 'عرض جميع العملاء والموردين في مكان واحد.',
  },
  customer: {
    title: 'العملاء',
    subtitle: 'قائمة الجهات التي لديها صفة عميل.',
  },
  supplier: {
    title: 'الموردون',
    subtitle: 'قائمة الجهات التي لديها صفة مورد.',
  },
};

function getTypeLabel(partner) {
  if (partner.isCustomer && partner.isSupplier) return 'عميل ومورد';
  if (partner.isCustomer) return 'عميل';
  if (partner.isSupplier) return 'مورد';
  return 'غير محدد';
}

function formatMoney(value) {
  return `${Number(value ?? 0).toLocaleString()} EGP`;
}

export function PartnerList({ filterType = 'all' }) {
  const { tenant } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  const [partners, setPartners] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [editingPartner, setEditingPartner] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const meta = PAGE_META[filterType] ?? PAGE_META.all;

  const loadPartners = useCallback(async () => {
    if (!tenant?.id) {
      setPartners([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    try {
      const data = await partnersService.getPartners({
        tenantId: tenant.id,
        filterType,
        search,
        status: statusFilter,
      });

      setPartners(data);
    } catch (error) {
      setErrorMessage(error.message || 'تعذر تحميل جهات الاتصال.');
    } finally {
      setIsLoading(false);
    }
  }, [tenant?.id, filterType, search, statusFilter]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      loadPartners();
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [loadPartners]);

  useEffect(() => {
    if (searchParams.get('quickCreate') !== 'customer') {
      return;
    }

    setEditingPartner(null);
    setIsSheetOpen(true);
    setSearchParams((current) => {
      const nextParams = new URLSearchParams(current);
      nextParams.delete('quickCreate');
      return nextParams;
    }, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleCreate = async (payload) => {
    if (!tenant?.id) {
      return { ok: false, error: 'لا توجد شركة نشطة.' };
    }

    try {
      setIsSubmitting(true);
      await partnersService.createPartner({
        tenantId: tenant.id,
        ...payload,
      });
      await loadPartners();
      setIsSheetOpen(false);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message || 'تعذر إنشاء جهة الاتصال.' };
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdate = async (payload) => {
    if (!tenant?.id || !editingPartner?.id) {
      return { ok: false, error: 'بيانات جهة الاتصال غير مكتملة.' };
    }

    try {
      setIsSubmitting(true);
      await partnersService.updatePartner({
        id: editingPartner.id,
        tenantId: tenant.id,
        ...payload,
      });
      await loadPartners();
      setIsSheetOpen(false);
      setEditingPartner(null);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message || 'تعذر تعديل جهة الاتصال.' };
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleArchive = async (partner) => {
    const isConfirmed = window.confirm(`تأكيد أرشفة ${partner.name || 'جهة الاتصال'}؟`);
    if (!isConfirmed) return;

    try {
      await partnersService.archivePartner({ id: partner.id, tenantId: tenant?.id });
      await loadPartners();
    } catch (error) {
      setErrorMessage(error.message || 'تعذر أرشفة جهة الاتصال.');
    }
  };

  const activeCount = useMemo(() => partners.filter((partner) => partner.isActive).length, [partners]);

  return (
    <section className="space-y-5">
      <ContactsHeader
        title={meta.title}
        subtitle={meta.subtitle}
        search={search}
        onSearchChange={setSearch}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        filterType={filterType}
        onAdd={() => {
          setEditingPartner(null);
          setIsSheetOpen(true);
        }}
      />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="accent">الإجمالي: {partners.length}</Badge>
        <Badge variant="secondary">نشط: {activeCount}</Badge>
      </div>

      {errorMessage ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>
      ) : null}

      {isLoading ? (
        <LoadingSpinner title="جاري تحميل جهات الاتصال" />
      ) : partners.length ? (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white md:block">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">الاسم</th>
                  <th className="px-4 py-3 font-medium">الهاتف</th>
                  <th className="px-4 py-3 font-medium">النوع</th>
                  <th className="px-4 py-3 font-medium">الرصيد</th>
                  <th className="px-4 py-3 font-medium">الحالة</th>
                  <th className="px-4 py-3 font-medium">الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {partners.map((partner) => (
                  <tr key={partner.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium text-slate-900">{partner.name || '-'}</td>
                    <td className="px-4 py-3 text-slate-600">{partner.phone || '-'}</td>
                    <td className="px-4 py-3 text-slate-700">{getTypeLabel(partner)}</td>
                    <td className="px-4 py-3 text-slate-700">{formatMoney(partner.balance)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          partner.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {partner.isActive ? 'نشط' : 'مؤرشف'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-700 transition hover:bg-slate-50"
                          onClick={() => {
                            setEditingPartner(partner);
                            setIsSheetOpen(true);
                          }}
                        >
                          تعديل
                        </button>
                        {partner.isActive ? (
                          <button
                            type="button"
                            className="rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-600 transition hover:bg-red-50"
                            onClick={() => handleArchive(partner)}
                          >
                            أرشفة
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 md:hidden">
            {partners.map((partner) => (
              <PartnerCard
                key={partner.id}
                partner={partner}
                onEdit={(nextPartner) => {
                  setEditingPartner(nextPartner);
                  setIsSheetOpen(true);
                }}
                onArchive={handleArchive}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center text-slate-500">
          لا توجد جهات اتصال مطابقة للفلتر الحالي.
        </div>
      )}

      <PartnerFormSheet
        open={isSheetOpen}
        onOpenChange={(open) => {
          setIsSheetOpen(open);
          if (!open) {
            setEditingPartner(null);
          }
        }}
        initialValues={editingPartner}
        onSubmit={editingPartner ? handleUpdate : handleCreate}
        isSubmitting={isSubmitting}
      />
    </section>
  );
}
