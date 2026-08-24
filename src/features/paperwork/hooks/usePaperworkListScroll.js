import { useEffect, useRef } from 'react';
import { getPaperworkLocationPath, getPaperworkScrollContainer } from '@/features/paperwork/routes/paperworkNavigation';

const STORAGE_PREFIX = 'paperwork:list-scroll:';

export function usePaperworkListScroll(location, ready) {
  const restoredRef = useRef(false);
  const locationPath = getPaperworkLocationPath(location);

  useEffect(() => {
    if (!ready || restoredRef.current || typeof sessionStorage === 'undefined') return undefined;
    const container = getPaperworkScrollContainer();
    if (!container) return undefined;
    restoredRef.current = true;
    const saved = Number(sessionStorage.getItem(`${STORAGE_PREFIX}${locationPath}`)) || 0;
    const frame = window.requestAnimationFrame(() => container.scrollTo({ top: saved, behavior: 'auto' }));
    return () => window.cancelAnimationFrame(frame);
  }, [locationPath, ready]);

  useEffect(() => {
    if (typeof sessionStorage === 'undefined') return undefined;
    const container = getPaperworkScrollContainer();
    if (!container) return undefined;
    const save = () => sessionStorage.setItem(`${STORAGE_PREFIX}${locationPath}`, String(container.scrollTop));
    container.addEventListener('scroll', save, { passive: true });
    return () => {
      save();
      container.removeEventListener('scroll', save);
    };
  }, [locationPath]);
}
