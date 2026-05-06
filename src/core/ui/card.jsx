import { cn } from '@/core/utils/cn';

export function Card({ className, ...props }) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-border bg-card shadow-soft transition-[transform,box-shadow,border-color] duration-200 motion-safe:transform-gpu motion-safe:hover:-translate-y-1 motion-safe:hover:shadow-[0_28px_70px_-36px_rgba(15,23,42,0.32)]',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }) {
  return <div className={cn('flex flex-col gap-2 p-6', className)} {...props} />;
}

export function CardTitle({ className, ...props }) {
  return <h3 className={cn('text-lg font-semibold tracking-tight', className)} {...props} />;
}

export function CardDescription({ className, ...props }) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export function CardContent({ className, ...props }) {
  return <div className={cn('p-6 pt-0', className)} {...props} />;
}

export function CardFooter({ className, ...props }) {
  return <div className={cn('flex items-center gap-3 p-6 pt-0', className)} {...props} />;
}

