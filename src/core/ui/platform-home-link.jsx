import { House } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ROUTES } from '@/core/config/routes.config';
import { cn } from '@/core/utils/cn';

export function PlatformHomeLink({ className, label = 'العودة إلى التطبيقات', ...props }) {
  return (
    <Link
      to={ROUTES.app}
      aria-label={label}
      title={label}
      className={cn('inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', className)}
      {...props}
    >
      <House className="h-5 w-5" aria-hidden="true" />
    </Link>
  );
}
