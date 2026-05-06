import { cva } from 'class-variance-authority';
import { cn } from '@/core/utils/cn';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-3 py-1 text-xs font-medium',
  {
  variants: {
    variant: {
      default: 'bg-slate-100 text-slate-600',
      success: 'bg-emerald-50 text-emerald-700',
      warning: 'bg-amber-50 text-amber-700',
      accent: 'bg-teal-50 text-teal-700',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export function Badge({ className, variant, ...props }) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

