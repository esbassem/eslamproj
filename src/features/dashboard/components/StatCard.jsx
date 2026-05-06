import { ArrowUpRight } from 'lucide-react';
import { Badge } from '@/core/ui/badge';
import { Card, CardContent } from '@/core/ui/card';
import { cn } from '@/core/utils/cn';

export function StatCard({ label, value, change, tone = 'default' }) {
  const badgeVariant = tone === 'success' ? 'success' : tone === 'warning' ? 'warning' : 'default';

  return (
    <Card className="border-white/80 bg-white/90">
      <CardContent className="space-y-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
          </div>
          <div className={cn('rounded-2xl bg-slate-100 p-3 text-slate-700')}>
            <ArrowUpRight className="rtl-flip h-5 w-5" />
          </div>
        </div>
        <Badge variant={badgeVariant} className="ltr-content inline-flex">
          {change}
        </Badge>
      </CardContent>
    </Card>
  );
}

