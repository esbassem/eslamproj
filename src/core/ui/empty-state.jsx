import { Button } from '@/core/ui/button';
import { Card, CardContent } from '@/core/ui/card';

export function EmptyState({ icon: Icon, title, description, actionLabel, onAction, actionDisabled = false, surface = 'card' }) {
  const content = (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-14 text-center">
      <div className="rounded-2xl bg-blue-50 p-4 text-primary">
        <Icon className="h-7 w-7" />
      </div>
      <div className="space-y-2">
        <h3 className="text-xl font-bold text-slate-950">{title}</h3>
        <p className="max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <Button variant="secondary" className="border-slate-200 bg-slate-50 shadow-none" onClick={onAction} disabled={actionDisabled}>
        {actionLabel}
      </Button>
    </div>
  );

  if (surface === 'plain') {
    return content;
  }

  return (
    <Card className="border-dashed border-slate-200 bg-white shadow-none">
      <CardContent className="p-0">{content}</CardContent>
    </Card>
  );
}

