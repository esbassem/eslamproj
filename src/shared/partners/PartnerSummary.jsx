import { UserRound } from 'lucide-react';
import { cn } from '@/core/utils/cn';

export function PartnerSummary({ partner, className, compact = false }) {
  if (!partner) return null;
  const phone = partner.phone || partner.mobile || partner.phone1 || partner.phone2 || '';
  return <div className={cn('flex min-w-0 items-center gap-3', className)}>
    <span className={cn('grid shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500', compact ? 'h-7 w-7' : 'h-9 w-9')}><UserRound className={compact ? 'h-4 w-4' : 'h-5 w-5'} /></span>
    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-black text-slate-950">{partner.name || 'عميل بدون اسم'}</span>{phone ? <span dir="ltr" className="mt-0.5 block truncate text-right text-xs font-bold text-slate-500">{phone}</span> : null}</span>
  </div>;
}
