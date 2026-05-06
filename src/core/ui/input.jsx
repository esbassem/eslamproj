import { cn } from '@/core/utils/cn';

export function Input({ className, ...props }) {
  return (
    <input
      className={cn(
        'flex h-11 w-full rounded-xl border border-border bg-white px-4 py-3 text-right text-sm text-foreground outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:ring-4 focus:ring-slate-100',
        className,
      )}
      {...props}
    />
  );
}

