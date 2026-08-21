export function PaperworkPage({ title, description, actions, children }) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1500px] flex-col pb-10">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-950">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 text-sm font-semibold text-slate-500">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}
