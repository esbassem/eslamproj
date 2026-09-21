import { useEffect, useRef } from 'react';

const WIDTH_CLASSES = Object.freeze({
  compact: 'max-w-3xl',
  standard: 'max-w-6xl',
  wide: 'max-w-[1500px]',
  fullBleed: 'max-w-none',
});

export function PlatformContent({ children, contentWidth = 'standard', variant = 'standard', scrollKey }) {
  const fullBleed = variant === 'fullBleed' || contentWidth === 'fullBleed';
  const viewportRef = useRef(null);
  useEffect(() => {
    if (!fullBleed) viewportRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [fullBleed, scrollKey]);
  return (
    <main ref={viewportRef} className={`min-h-0 min-w-0 flex-1 overflow-x-clip ${fullBleed ? 'overflow-hidden' : 'overflow-y-auto'}`}>
      <div className={`${WIDTH_CLASSES[contentWidth] ?? WIDTH_CLASSES.standard} mx-auto min-h-full w-full ${fullBleed ? '' : 'px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-6 sm:px-6 lg:px-8 lg:py-7'}`}>
        {children}
      </div>
    </main>
  );
}
