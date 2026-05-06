import { LoadingSpinner } from '@/core/ui/loading-spinner';
import { Logo } from '@/core/ui/logo';

export function RouteLoadingFallback() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6">
      <Logo />
      <LoadingSpinner title="جاري تحميل التطبيق" className="min-h-0" />
    </div>
  );
}
