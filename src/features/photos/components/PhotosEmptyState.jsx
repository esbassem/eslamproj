import { Image, Images, Link2Off, Settings } from 'lucide-react';

const ICONS = {
  all: Images,
  unlinked: Link2Off,
  settings: Settings,
  default: Image,
};

export function PhotosEmptyState({
  tone = 'default',
  title,
  description,
  children,
}) {
  const Icon = ICONS[tone] ?? ICONS.default;

  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-8 text-center shadow-[0_24px_60px_-48px_rgba(15,23,42,0.35)]">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
        <Icon className="h-8 w-8" />
      </div>
      <h2 className="mt-5 text-xl font-black text-slate-950">{title}</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm font-bold leading-7 text-slate-500">
        {description}
      </p>
      {children ? <div className="mt-6">{children}</div> : null}
    </div>
  );
}
