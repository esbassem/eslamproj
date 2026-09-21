export const PLATFORM_SIDE_SHEET_SIZES = Object.freeze({
  sm: 'sm:max-w-[24rem]',
  md: 'sm:max-w-[32rem]',
  lg: 'sm:max-w-[42rem]',
  xl: 'sm:max-w-[52rem]',
});

export const PLATFORM_SIDE_SHEET_PLACEMENTS = Object.freeze(['start', 'end']);

// The Side Sheet sits above shell chrome. Later portals at the same core Sheet
// layers still stack naturally; dedicated nested overlays can use 60/70.
export const PLATFORM_SURFACE_LAYERS = Object.freeze({
  sideSheetOverlay: 'platform-side-sheet-overlay',
  sideSheet: 'platform-side-sheet-content',
  nestedOverlay: 'z-[60]',
  nestedContent: 'z-[70]',
});

export function resolvePlatformSideSheetSide(placement = 'end', direction = 'ltr') {
  const normalizedPlacement = PLATFORM_SIDE_SHEET_PLACEMENTS.includes(placement) ? placement : 'end';
  const normalizedDirection = direction === 'rtl' ? 'rtl' : 'ltr';

  if (normalizedPlacement === 'start') return normalizedDirection === 'rtl' ? 'right' : 'left';
  return normalizedDirection === 'rtl' ? 'left' : 'right';
}
