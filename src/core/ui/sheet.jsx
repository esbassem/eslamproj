import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/core/utils/cn';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export function SheetContent({ className, children, side = 'right', ...props }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="sheet-overlay fixed inset-0 z-40 bg-slate-950/25 backdrop-blur-sm" />
      <DialogPrimitive.Content
        className={cn(
          'sheet-content fixed z-50 flex max-h-screen flex-col overflow-hidden bg-white shadow-2xl outline-none will-change-transform',
          side === 'right' && 'sheet-content-right right-0 top-0 h-full w-full max-w-xl border-l border-border',
          side === 'left' && 'sheet-content-left left-0 top-0 h-full w-full max-w-xl border-r border-border',
          side === 'bottom' && 'sheet-content-bottom bottom-0 left-0 right-0 rounded-t-[28px] border-t border-border',
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function SheetHeader({ className, ...props }) {
  return <div className={cn('space-y-2 border-b border-border px-6 py-5', className)} {...props} />;
}

export function SheetTitle({ className, ...props }) {
  return <DialogPrimitive.Title className={cn('text-xl font-semibold text-slate-950', className)} {...props} />;
}

export function SheetDescription({ className, ...props }) {
  return <DialogPrimitive.Description className={cn('text-sm leading-6 text-muted-foreground', className)} {...props} />;
}

export function SheetBody({ className, ...props }) {
  return <div className={cn('flex-1 overflow-y-auto px-6 py-5', className)} {...props} />;
}

export function SheetFooter({ className, ...props }) {
  return <div className={cn('flex items-center justify-between gap-3 border-t border-border px-6 py-4', className)} {...props} />;
}

export function SheetDismissButton({ className, ...props }) {
  return (
    <SheetClose
      className={cn(
        'absolute left-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-800',
        className,
      )}
      {...props}
    >
      <X className="h-4 w-4" />
    </SheetClose>
  );
}
