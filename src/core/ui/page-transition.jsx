export function PageTransition({ children, pathname, allowOverflow = false }) {
  return (
    <div
      key={pathname}
      className={`flex min-h-full flex-col ${allowOverflow ? 'overflow-visible' : 'overflow-hidden'}`}
    >
      {children}
    </div>
  );
}
