function formatContractMoney(value) {
  return `${Number(value || 0).toLocaleString('ar-EG-u-nu-latn')} ج.م`;
}

function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return '--';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function getInstallmentName(installment) {
  const installmentNumber = installment?.installment_no || '--';
  return installment?.name || installment?.title || installment?.notes || `القسط ${installmentNumber}`;
}

function getContractDetails(notes) {
  const details = {
    trustReceiptStatus: '',
    paperworkStatus: '',
    extraNotes: '',
  };

  String(notes || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const separatorIndex = line.indexOf(':');
      if (separatorIndex < 0) return;

      const label = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();

      if (label === 'حالة إيصالات الأمانة') {
        details.trustReceiptStatus = value;
      } else if (label === 'الموقف الورقي') {
        details.paperworkStatus = value;
      } else if (label === 'ملاحظات إضافية') {
        details.extraNotes = value;
      }
    });

  return details;
}

export function ReceivableContractPreview({ companyName, receivable }) {
  const sellerName = typeof companyName === 'string' && companyName.trim() ? companyName.trim() : 'معرض الوكيل';
  const installments = Array.isArray(receivable?.installments) ? receivable.installments : [];
  const guarantors = Array.isArray(receivable?.guarantors) ? receivable.guarantors : [];
  const totalAmount = Number(receivable?.total_amount || 0);
  const contractDate = receivable?.opened_at || receivable?.created_at || Date.now();
  const contractDetails = getContractDetails(receivable?.notes);
  const installmentColumnSize = Math.ceil(installments.length / 2);
  const installmentColumns = [
    installments.slice(0, installmentColumnSize),
    installments.slice(installmentColumnSize),
  ].filter((column) => column.length);

  return (
    <div className="receivable-contract-preview-wrapper mx-auto w-full max-w-[210mm] bg-slate-100 p-2" dir="rtl">
      <section
        className="receivable-contract-page border border-slate-300 bg-white px-6 py-6 text-right text-slate-800 shadow-[0_10px_30px_rgba(2,6,23,0.08)] sm:px-8 sm:py-7"
        dir="rtl"
        style={{ fontFamily: "'Cairo', 'Tajawal', 'Segoe UI', sans-serif" }}
      >
        <div className="mb-5 flex justify-start px-1">
          <div className="text-right">
            <p className="text-sm font-black text-slate-900">{sellerName}</p>
            <p className="mt-1 text-xs font-bold text-slate-400">
              تاريخ العقد: <span className="inline-block" dir="ltr">{formatDate(contractDate)}</span>
            </p>
          </div>
        </div>

        <section className="mb-5 px-1 pb-2">
          <div className="border-b border-slate-200 pb-3 text-sm leading-7 text-slate-800">
            <div className="min-w-0">
              <p className="truncate text-lg font-black leading-6 text-slate-950">
                {receivable?.partnerName || '--'}
              </p>
              <p className="mb-3 mt-2 truncate text-sm font-bold leading-5 text-slate-400">
                {receivable?.title || '--'}
              </p>
            </div>
            <div className="mt-0 min-w-0">
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <span className="font-bold text-slate-500">إجمالي المديونية</span>
                <span className="inline-block font-mono font-black text-slate-950" dir="ltr">{formatContractMoney(totalAmount)}</span>
                <span className="inline-flex min-w-[20rem] flex-col">
                  <span className="inline-flex h-5 items-start gap-1 text-slate-950">
                    <span className="font-bold">(</span>
                    <span className="h-5 flex-1 border-b border-slate-500" />
                    <span className="font-bold">)</span>
                  </span>
                  <span className="mt-0.5 text-[11px] font-bold leading-4 text-slate-400">
                    يكتب المدين المبلغ بالعربي داخل القوسين
                  </span>
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="pb-5">
          {installments.length ? (
            <div className="grid grid-cols-1 gap-x-6 gap-y-0 border-b border-slate-200 bg-white sm:grid-cols-2" dir="rtl">
              {installmentColumns.map((column, columnIndex) => (
                <div key={`installment-column-${columnIndex}`} className="min-w-0">
                  {column.map((installment, index) => {
                    const globalIndex = columnIndex * installmentColumnSize + index;
                    const installmentNumber = installment?.installment_no || globalIndex + 1;
                    const installmentName = getInstallmentName(installment);

                    return (
                      <div
                        key={installment?.id || globalIndex}
                        className="border-b border-slate-100 px-0 py-3"
                      >
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 font-mono text-xs font-extrabold text-[#73849a]" dir="ltr">
                            {installmentNumber}
                          </span>
                          <div className="min-w-0 w-fit max-w-[calc(100%-2.75rem)] text-right">
                            <p className="font-mono text-lg font-extrabold leading-5 text-slate-950" dir="ltr">
                              {Number(installment?.amount || 0).toLocaleString('ar-EG-u-nu-latn', {
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 2,
                              })}
                            </p>
                            <p className="flex min-w-0 items-center justify-end gap-1.5 text-[11px] font-black leading-4 text-[#73849a]">
                              <span className="truncate">{installmentName}</span>
                              <span className="h-1 w-1 shrink-0 rounded-full bg-[#b8c3d1]" />
                              <span className="shrink-0 font-mono" dir="ltr">{formatDate(installment?.due_date)}</span>
                            </p>
                          </div>
                        </div>
                        {globalIndex === 0 ? (
                          <div className="mt-2 pr-11 text-[11px] font-bold leading-4 text-slate-400">
                            <span className="inline-flex min-w-[12rem] flex-col">
                              <span className="inline-flex h-5 items-start gap-1 text-slate-700">
                                <span>(</span>
                                <span className="h-5 flex-1 border-b border-slate-400" />
                                <span>)</span>
                              </span>
                              <span className="mt-0.5">يقر المدين بخط يده أن هذا الاستحقاق يحل سداده بعد مدة</span>
                            </span>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-slate-200 px-4 py-5 text-center text-xs font-bold text-slate-500">
              لا توجد استحقاقات مسجلة
            </p>
          )}
        </section>

        {guarantors.length ? (
          <section className="pb-5">
            <h2 className="mb-3 text-sm font-extrabold text-slate-900">الضامنين</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {guarantors.map((guarantor, index) => (
                <div key={guarantor?.id || guarantor?.partner_id || index} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                  <p className="font-black text-slate-900">{guarantor?.name || `ضامن ${index + 1}`}</p>
                  <p className="mt-0.5 font-mono font-bold text-slate-500"><span className="inline-block" dir="ltr">{guarantor?.phone || '--'}</span></p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {(contractDetails.trustReceiptStatus || contractDetails.paperworkStatus || contractDetails.extraNotes) ? (
          <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
            <h2 className="text-sm font-extrabold text-slate-900">عقود ومستندات المديونية</h2>
            <div className="mt-3 space-y-2 text-sm leading-7 text-slate-700">
              {contractDetails.trustReceiptStatus ? <p><span className="font-bold text-slate-900">إيصالات الأمانة:</span> {contractDetails.trustReceiptStatus}</p> : null}
              {contractDetails.paperworkStatus ? <p><span className="font-bold text-slate-900">التوكيلات:</span> {contractDetails.paperworkStatus}</p> : null}
              {contractDetails.extraNotes ? <p><span className="font-bold text-slate-900">ملاحظات:</span> {contractDetails.extraNotes}</p> : null}
            </div>
          </section>
        ) : null}

        <section className="mt-8 flex flex-wrap items-end justify-end gap-x-4 gap-y-2">
          <p className="text-sm font-bold text-slate-700">توقيع الطرف الثاني</p>
          <div className="h-8 w-48 border-b border-slate-500" />
        </section>

        <footer className="mt-5 border-t border-slate-200 pt-3 text-center text-[11px] text-slate-500">
          تم إنشاء هذا العقد إلكترونيًا من نظام {sellerName}
        </footer>
      </section>
    </div>
  );
}
