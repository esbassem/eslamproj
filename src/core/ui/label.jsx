import * as LabelPrimitive from '@radix-ui/react-label';
import { cn } from '@/core/utils/cn';

export function Label({ className, ...props }) {
  return <LabelPrimitive.Root className={cn('text-right text-sm font-medium text-slate-700', className)} {...props} />;
}

