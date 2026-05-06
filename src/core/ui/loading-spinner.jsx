import { LoaderCircle } from 'lucide-react';
import { cn } from '@/core/utils/cn';

export function LoadingSpinner({ title = 'جاري تحميل المحتوى', description = 'لحظات قليلة...', className = '' }) {
  return (
    <div className={cn('flex min-h-72 w-full items-center justify-center', className)}>
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="relative flex h-14 w-14 items-center justify-center">
          <div className="absolute inset-0 rounded-full border-4 border-slate-100" />
          <LoaderCircle className="relative h-12 w-12 animate-spin text-[rgb(2,27,76)]" strokeWidth={2.4} />
        </div>
        <div>
          <p className="text-sm font-extrabold text-slate-950">{title}</p>
          {description ? <p className="mt-1 text-xs font-semibold text-slate-500">{description}</p> : null}
        </div>
      </div>
    </div>
  );
}
