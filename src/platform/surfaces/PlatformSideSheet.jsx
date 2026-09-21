import { useContext } from 'react';
import { X } from 'lucide-react';
import { LocalizationContext } from '@/core/i18n/LocalizationProvider';
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/core/ui/sheet';
import { cn } from '@/core/utils/cn';
import {
  PLATFORM_SIDE_SHEET_SIZES,
  PLATFORM_SURFACE_LAYERS,
  resolvePlatformSideSheetSide,
} from './platformSideSheetContract.js';

function PlatformSideSheetLoading({ label }) {
  return (
    <div role="status" className="space-y-4" aria-label={label}>
      <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="h-32 animate-pulse rounded-xl bg-slate-100" />
        <div className="h-32 animate-pulse rounded-xl bg-slate-100" />
      </div>
      <div className="h-48 animate-pulse rounded-xl bg-slate-100" />
    </div>
  );
}

export function PlatformSideSheet({
  open,
  onOpenChange,
  placement = 'end',
  size = 'md',
  title,
  description,
  headerNotice,
  headerActions,
  footer,
  loading = false,
  loadingContent,
  dismissible = true,
  density = 'comfortable',
  closeLabel,
  className,
  bodyClassName,
  children,
}) {
  if (title == null || title === '') {
    throw new TypeError('PlatformSideSheet requires a title for accessible dialog semantics.');
  }

  const localization = useContext(LocalizationContext);
  const documentDirection = typeof document === 'undefined' ? 'ltr' : document.documentElement.dir;
  const direction = localization?.direction || documentDirection || 'ltr';
  const side = resolvePlatformSideSheetSide(placement, direction);
  const resolvedSize = PLATFORM_SIDE_SHEET_SIZES[size] ?? PLATFORM_SIDE_SHEET_SIZES.md;
  const resolvedCloseLabel = closeLabel ?? (direction === 'rtl' ? 'إغلاق' : 'Close');
  const loadingLabel = direction === 'rtl' ? 'جاري تحميل المحتوى' : 'Loading content';
  const compact = density === 'compact';
  const preventDismiss = (event) => {
    if (!dismissible) event.preventDefault();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        dir={direction}
        data-density={compact ? 'compact' : 'comfortable'}
        {...(!description ? { 'aria-describedby': undefined } : {})}
        onEscapeKeyDown={preventDismiss}
        onPointerDownOutside={preventDismiss}
        onInteractOutside={preventDismiss}
        overlayClassName={PLATFORM_SURFACE_LAYERS.sideSheetOverlay}
        className={cn(
          PLATFORM_SURFACE_LAYERS.sideSheet,
          'h-[100dvh] max-h-[100dvh] w-full max-w-none border-slate-200 bg-white shadow-xl',
          resolvedSize,
          className,
        )}
      >
        <SheetHeader className={cn(
          'flex shrink-0 flex-row items-start justify-between space-y-0 pt-[max(1.25rem,env(safe-area-inset-top))]',
          compact ? 'gap-3 px-4 pb-3 sm:px-5' : 'gap-4 px-5 pb-4 sm:px-6',
        )}>
          <div className={cn('min-w-0 flex-1', compact ? 'space-y-1' : 'space-y-1.5')}>
            <div className="flex min-w-0 items-center gap-2">
              <SheetTitle className={cn('min-w-0 truncate', compact ? 'text-base leading-6' : undefined)}>{title}</SheetTitle>
              {headerNotice}
            </div>
            {description ? (
              <SheetDescription className={compact ? 'text-[11px] leading-4' : undefined}>
                {description}
              </SheetDescription>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {headerActions}
            {dismissible ? (
              <SheetClose
                type="button"
                aria-label={resolvedCloseLabel}
                className={cn(
                  'inline-flex items-center justify-center rounded-full border border-border bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2',
                  compact ? 'h-8 w-8' : 'h-9 w-9',
                )}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </SheetClose>
            ) : null}
          </div>
        </SheetHeader>

        <SheetBody
          className={cn(
            'min-h-0 overscroll-y-contain',
            compact ? 'px-3 py-3 sm:px-4' : 'px-5 py-5 sm:px-6',
            bodyClassName,
          )}
          aria-busy={loading || undefined}
        >
          {loading
            ? loadingContent ?? <PlatformSideSheetLoading label={loadingLabel} />
            : children}
        </SheetBody>

        {footer ? (
          <SheetFooter className={cn(
            'shrink-0 flex-wrap pb-[max(1rem,env(safe-area-inset-bottom))]',
            compact ? 'px-4 sm:px-5' : 'px-5 sm:px-6',
          )}>
            {footer}
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
