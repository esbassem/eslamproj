import { useOptionalPlatformShell } from '../shell/PlatformShellContext';
import { PageHeader } from './PageHeader';

const WIDTH_CLASSES = Object.freeze({
  compact: 'max-w-3xl',
  standard: 'max-w-6xl',
  wide: 'max-w-[1500px]',
  fullBleed: 'max-w-none',
});

export function PageLayout({
  title,
  description,
  actions,
  breadcrumbs,
  contextualBack,
  contentWidth,
  variant,
  header = true,
  children,
}) {
  const shell = useOptionalPlatformShell();
  const resolvedWidth = contentWidth ?? shell?.policy.contentWidth ?? 'standard';
  const resolvedVariant = variant ?? shell?.policy.variant ?? 'standard';
  const resolvedBreadcrumbs = breadcrumbs ?? shell?.breadcrumbs ?? [];
  const fullBleed = resolvedVariant === 'fullBleed' || resolvedWidth === 'fullBleed';
  return (
    <section className={`${WIDTH_CLASSES[resolvedWidth] ?? WIDTH_CLASSES.standard} mx-auto w-full ${fullBleed ? '' : 'space-y-6'}`} data-page-variant={resolvedVariant}>
      {header ? <PageHeader title={title} description={description} actions={actions} breadcrumbs={resolvedBreadcrumbs} contextualBack={contextualBack} /> : null}
      {children}
    </section>
  );
}
