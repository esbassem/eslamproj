const DEFAULT_COPY = Object.freeze({
  loading: { title: 'جاري تحميل المحتوى', description: 'لحظات قليلة...' },
  error: { title: 'تعذر تحميل المحتوى', description: 'حاول مرة أخرى.' },
  empty: { title: 'لا توجد بيانات', description: '' },
});

export function PageState({ state, title, description, action, children }) {
  if (state === 'ready') return children ?? null;
  if (!DEFAULT_COPY[state]) return null;
  const copy = DEFAULT_COPY[state];
  return (
    <div role={state === 'error' ? 'alert' : 'status'} className={`flex min-h-72 flex-col items-center justify-center rounded-2xl border p-8 text-center ${state === 'error' ? 'border-red-200 bg-red-50' : 'border-dashed border-slate-200 bg-white'}`}>
      {state === 'loading' ? <span className="mb-4 h-9 w-9 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800" aria-hidden="true" /> : null}
      <h2 className="text-lg font-black text-slate-950">{title ?? copy.title}</h2>
      {description ?? copy.description ? <p className="mt-2 max-w-md text-sm font-semibold leading-6 text-slate-500">{description ?? copy.description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
