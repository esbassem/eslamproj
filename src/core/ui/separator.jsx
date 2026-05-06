import * as SeparatorPrimitive from '@radix-ui/react-separator';
import { cn } from '@/core/utils/cn';

export function Separator({ className, orientation = 'horizontal', ...props }) {
  return (
    <SeparatorPrimitive.Root
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      orientation={orientation}
      {...props}
    />
  );
}

