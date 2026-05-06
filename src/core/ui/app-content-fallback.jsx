import { LoadingSpinner } from '@/core/ui/loading-spinner';

export function AppContentFallback() {
  return <LoadingSpinner title="جاري تحميل الصفحة" className="min-h-[calc(100vh-4rem)]" />;
}
