export function PageTransition({ children, pathname }) {
  return (
    <div
      key={pathname}
      className="flex min-h-full flex-col overflow-hidden"
    >
      {children}
    </div>
  );
}
