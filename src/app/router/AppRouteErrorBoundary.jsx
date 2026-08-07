import { Component } from 'react';
import { Button } from '@/core/ui/button';

export class AppRouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    const chunkFailure = /dynamically imported module|loading chunk|failed to fetch/i.test(String(error?.message));
    if (!chunkFailure) return;
    try {
      const retryKey = `businesshub:chunk-retry:${window.location.pathname}`;
      if (!sessionStorage.getItem(retryKey)) {
        sessionStorage.setItem(retryKey, '1');
        window.location.reload();
      }
    } catch {
      // The visible retry action remains available when storage is disabled.
    }
  }

  componentDidUpdate(previousProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    const chunkFailure = /dynamically imported module|loading chunk|failed to fetch/i.test(String(this.state.error?.message));
    return (
      <div className="flex min-h-[55vh] items-center justify-center px-4" dir="rtl">
        <div className="max-w-md rounded-2xl border border-red-100 bg-white p-6 text-center shadow-sm">
          <h2 className="text-lg font-black text-slate-950">تعذر فتح التطبيق</h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
            {chunkFailure ? 'تعذر تحميل ملفات التطبيق. تحقق من الاتصال ثم حاول مرة أخرى.' : 'حدث خطأ غير متوقع داخل التطبيق.'}
          </p>
          <Button className="mt-5" onClick={() => window.location.reload()}>إعادة المحاولة</Button>
          <Button className="mt-5 mr-2" variant="secondary" onClick={() => window.location.assign('/admin')}>العودة للتطبيقات</Button>
        </div>
      </div>
    );
  }
}
