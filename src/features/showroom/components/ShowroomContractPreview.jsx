function formatContractMoney(value) {
  return `${Number(value || 0).toLocaleString('ar-EG-u-nu-latn')} ج.م`;
}

function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleDateString('ar-EG-u-nu-latn', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function getProductTitle(product) {
  return product?.displayName || product?.name || product?.description || 'منتج';
}

function getProductAttributes(product) {
  const trackingIdentifiers = Array.isArray(product?.trackingIdentifiers) ? product.trackingIdentifiers : [];
  const configuredAttributes = Array.isArray(product?.configuredAttributes) ? product.configuredAttributes : [];
  const trackingAttributes = trackingIdentifiers
    .map((identifier) => ({
      label: identifier?.label || identifier?.name || 'تعريف تتبع',
      value: identifier?.value || '',
    }))
    .filter((attribute) => String(attribute.value).trim());

  if (configuredAttributes.length) {
    const configuredProductAttributes = configuredAttributes
      .map((attribute) => ({
        label: attribute?.label || attribute?.attributeName || attribute?.attribute_name || 'خاصية',
        value: attribute?.value || attribute?.valueName || attribute?.value_name || '',
      }))
      .filter((attribute) => String(attribute.value).trim());

    return [
      ...trackingAttributes,
      ...configuredProductAttributes,
    ];
  }

  const attributesJsonb = Array.isArray(product?.attributesJsonb ?? product?.attributes_jsonb)
    ? product.attributesJsonb ?? product.attributes_jsonb
    : [];

  const templateAttributes = attributesJsonb
    .map((attribute) => ({
      label: attribute?.label || attribute?.attributeName || attribute?.attribute_name || attribute?.name || 'خاصية',
      value: attribute?.value || attribute?.valueName || attribute?.value_name || attribute?.selectedValue || attribute?.selected_value || '',
    }))
    .filter((attribute) => String(attribute.value).trim());

  return [
    ...trackingAttributes,
    ...templateAttributes,
  ];
}

function getPaperworkGuardianshipLabel(note) {
  const guardianshipCode = String(note || '').match(/حالة الوصاية:\s*([^\n]+)/)?.[1]?.trim();
  return {
    father_guardian: 'وصاية والده',
    mother_guardian: 'وصاية والدته',
  }[guardianshipCode] || guardianshipCode || '';
}

function getProductPaperworkInfo(item) {
  const request = item?.paperworkRequest || item?.paperwork_request || null;

  if (!request) {
    return {
      exists: false,
      ownerName: 'غير محدد',
      guardianshipLabel: '',
      statusLabel: 'لم يتم تحديد بيانات الأوراق بعد',
    };
  }

  const ownerStatus = request.documentOwnerStatus || request.document_owner_status || '';
  const ownerName = request.documentOwnerName
    || request.document_owner_name
    || request.documentOwner?.name
    || request.document_owner?.name
    || (ownerStatus === 'later' ? 'سيتم تحديده لاحقًا' : 'غير محدد');

  return {
    exists: true,
    ownerName,
    guardianshipLabel: ownerStatus === 'later'
      ? ''
      : getPaperworkGuardianshipLabel(request.documentOwnerNote || request.document_owner_note),
    statusLabel: ownerStatus === 'later' ? 'صاحب الورق سيتم تحديده لاحقًا' : 'احيانا قد يتاخر الورق حتي اسبوعان',
  };
}

export function ShowroomContractPreview({ companyName, customer, items, totalAmount, paidAmount, remainingAmount, paymentMethod, notes }) {
  const safeItems = Array.isArray(items) ? items : [];
  const safePaidAmount = Number(paidAmount) || 0;
  const safeRemainingAmount = Math.max(Number(remainingAmount) || 0, 0);
  const sellerName = typeof companyName === 'string' && companyName.trim() ? companyName.trim() : 'الشركة';
  const today = new Date();
  const documentNumber = `SR-${today.getFullYear()}-${String(today.getTime()).slice(-6)}`;

  return (
    <div className="showroom-contract-preview-wrapper mx-auto w-full max-w-[210mm] bg-slate-100 p-2" dir="rtl">
      <section
        className="showroom-contract-page border border-slate-300 bg-white px-6 py-6 text-slate-800 shadow-[0_10px_30px_rgba(2,6,23,0.08)] sm:px-8 sm:py-7"
        style={{ fontFamily: "'Cairo', 'Tajawal', 'Segoe UI', sans-serif" }}
      >
        <header className="-mx-6 -mt-6 mb-6 bg-slate-900 px-6 py-5 text-white sm:-mx-8 sm:-mt-7 sm:px-8 sm:py-6">
          <div className="flex items-start justify-between gap-6" dir="ltr">
            <div className="min-w-[220px] text-left">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Sales Contract</p>
              <p className="mt-1 text-2xl font-black leading-tight text-white">{sellerName}</p>
            </div>

            <div className="border-r border-white/20 pr-5 text-right" dir="rtl">
              <h1 className="text-xl font-bold text-white">عقد بيع / اتفاق بيع</h1>
              <div className="mt-3 space-y-1 text-sm">
                <p>
                  <span className="font-semibold text-slate-300">رقم المستند:</span>
                  <span className="mr-2 font-mono text-white" dir="ltr">{documentNumber}</span>
                </p>
                <p>
                  <span className="font-semibold text-slate-300">تاريخ الإصدار:</span>
                  <span className="mr-2 text-white">{formatDate(today)}</span>
                </p>
              </div>
            </div>
          </div>
        </header>

        <section className="mb-4 px-1 pb-2">
          <p className="text-[13px] leading-6 text-slate-700">
            إنه في يوم <span className="font-bold text-slate-900">{formatDate(today)}</span> تم الاتفاق بين
            <span className="font-bold text-slate-900"> الطرف الأول / {sellerName}</span>
            <br />
            <span className="font-bold text-slate-900">والطرف الثاني (العميل)</span>.
          </p>

          <div className="mt-2 overflow-hidden rounded-sm border border-slate-300 bg-white text-xs text-slate-800">
            <div className="grid grid-cols-1 divide-y divide-slate-200 sm:grid-cols-3 sm:divide-x sm:divide-x-reverse sm:divide-y-0">
              <p className="px-2.5 py-2">
                <span className="font-semibold text-slate-500">الاسم:</span>
                <span className="mr-1.5 font-bold text-slate-900">{customer?.name || '--'}</span>
              </p>
              <p className="px-2.5 py-2" dir="ltr">
                <span className="font-semibold text-slate-500">رقم الهاتف:</span>
                <span className="mr-1.5 font-mono font-bold text-slate-900">{customer?.phone || customer?.phone1 || '--'}</span>
              </p>
              <p className="px-2.5 py-2" dir="ltr">
                <span className="font-semibold text-slate-500">الرقم القومي:</span>
                <span className="mr-1.5 font-mono font-bold text-slate-900">{customer?.nationalId || '--'}</span>
              </p>
            </div>
            <div className="border-t border-slate-200 px-2.5 py-2">
              <span className="font-semibold text-slate-500">العنوان:</span>
              <span className="mr-1.5 font-bold text-slate-900">{customer?.address || '--'}</span>
            </div>
          </div>
        </section>

        <section className="mt-5 pb-5">
          <div className="mb-3">
            <h2 className="text-sm font-bold text-slate-900">
              على إجمالي قيمة بيع
              <span className="mx-2 font-mono">({formatContractMoney(totalAmount)})</span>
              وذلك في مقابل:
            </h2>
          </div>
          <div className="space-y-3 px-2 sm:px-4">
            {safeItems.map((item, index) => {
              const paperworkInfo = getProductPaperworkInfo(item);

              return (
                <div key={item?.lineId || item?.id || index} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <div className="flex items-start justify-between gap-4 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-extrabold text-slate-900">{getProductTitle(item)}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                        {getProductAttributes(item).map((attribute, attributeIndex) => (
                          <span key={`${attribute.label}-${attribute.value}-${attributeIndex}`}>
                            {attribute.label}: {attribute.value}
                          </span>
                        ))}
                      </div>
                      <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                        paperworkInfo.exists
                          ? 'border-blue-100 bg-blue-50 text-blue-950'
                          : 'border-amber-100 bg-amber-50 text-amber-900'
                      }`}>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_150px] sm:items-end">
                          <div>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="font-bold text-slate-500">بيانات الأوراق:</span>
                              <span className="font-black">باسم {paperworkInfo.ownerName}</span>
                              {paperworkInfo.guardianshipLabel ? (
                                <span className="font-bold text-blue-700">· {paperworkInfo.guardianshipLabel}</span>
                              ) : null}
                            </div>
                            <p className="mt-1 text-[11px] font-bold opacity-75">{paperworkInfo.statusLabel}</p>
                          </div>
                          <div className="text-center">
                            <p className="mb-1 text-[10px] font-bold text-slate-500">توقيع تأكيد بيانات الورق</p>
                            <div className="h-7 border-b border-slate-500" />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="text-left" dir="ltr">
                      <p className="text-xs font-semibold text-slate-500">السعر</p>
                      <p className="mt-1 font-mono text-lg font-extrabold text-slate-900">
                        {formatContractMoney(Number(item?.total ?? item?.line_total ?? (Number(item?.price ?? item?.unit_price) || 0) * (Number(item?.quantity) || 1)))}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="pb-5">
          <p className="mb-3 text-sm text-slate-800">
            وقد سدّد الطرف الثاني مبلغاً إجمالياً قدره{' '}
            <span className="font-bold text-slate-900">{formatContractMoney(safePaidAmount)}</span>
            {' '}وذلك على التفصيل الآتي:
          </p>
          <div className="w-fit max-w-full overflow-hidden rounded-sm border border-slate-300 bg-white text-xs text-slate-800">
            <div className="border-b border-slate-200 px-3 py-2.5 last:border-b-0">
              <div className="flex items-center justify-between gap-3">
                <p className="text-slate-900">
                  <span className="font-semibold">{paymentMethod?.trim() || 'وسيلة دفع'}</span>
                  <span className="mx-1.5 text-slate-300">|</span>
                  <span className="text-[11px] text-slate-500" dir="ltr">{formatDate(today)}</span>
                </p>
                <p className="text-left font-mono font-bold text-slate-900" dir="ltr">{formatContractMoney(safePaidAmount)}</p>
              </div>
            </div>
          </div>
        </section>

        {safeRemainingAmount > 0 ? (
          <section className="pb-5">
            <p className="text-sm text-slate-800">
              وبذلك يتبقى بذمة الطرف الثاني مبلغ قدره{' '}
              <span className="font-bold text-slate-900">{formatContractMoney(safeRemainingAmount)}</span>
              {' '}ويقر الطرف الثاني بالتزامه بسداد هذا المبلغ وفق الاتفاق المبرم.
            </p>
          </section>
        ) : null}

        <section className="mt-5 rounded-xl border border-slate-200 bg-white px-5 py-4">
          <h2 className="text-sm font-extrabold text-slate-900">إقرار الطرف الثاني</h2>
          <p className="mt-2 text-sm leading-8 text-slate-700">
            أقر أنا / <span className="font-bold text-slate-900">{customer?.name || '--'}</span>
            بأنني وافقت على شراء المنتجات الموضحة أعلاه، واستلمت أو قبلت بيانات البيع والسداد كما هي مثبتة بهذا العقد،
            وقد سددت مبلغًا قدره <span className="font-bold text-slate-900">{formatContractMoney(safePaidAmount)}</span>،
            {safeRemainingAmount > 0 ? (
              <>
                والمتبقي بذمتي مبلغ <span className="font-bold text-slate-900">{formatContractMoney(safeRemainingAmount)}</span>،
                وألتزم بسداده وفق الاتفاق المبرم بيني وبين الطرف الأول.
              </>
            ) : (
              <>ولا يوجد بذمتي أي مبلغ متبقٍ وقت تحرير هذا العقد.</>
            )}
          </p>

          {notes?.trim() ? (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-bold text-slate-600">ملاحظات إضافية</p>
              <p className="mt-1 text-sm leading-7 text-slate-700">{notes.trim()}</p>
            </div>
          ) : null}
        </section>

        <section className="mt-8 flex items-end justify-end gap-3">
          <p className="text-sm font-bold text-slate-700">توقيع العميل</p>
          <div className="h-8 w-48 border-b border-slate-500" />
        </section>

        <footer className="mt-5 border-t border-slate-200 pt-3 text-center text-[11px] text-slate-500">
          تم إنشاء هذا العقد إلكترونيًا من نظام {sellerName}
        </footer>
      </section>
    </div>
  );
}
