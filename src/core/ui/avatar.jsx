import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cn } from '@/core/utils/cn';

export function Avatar({ className, ...props }) {
  return <AvatarPrimitive.Root className={cn('relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full', className)} {...props} />;
}

export function AvatarImage(props) {
  return <AvatarPrimitive.Image className="aspect-square h-full w-full" {...props} />;
}

export function AvatarFallback({ className, ...props }) {
  return (
    <AvatarPrimitive.Fallback
      className={cn('flex h-full w-full items-center justify-center bg-slate-200 text-sm font-semibold text-slate-700', className)}
      {...props}
    />
  );
}

