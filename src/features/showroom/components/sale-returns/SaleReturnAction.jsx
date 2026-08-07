import { RotateCcw } from 'lucide-react';
import { DropdownMenuItem } from '@/core/ui/dropdown-menu';

export function SaleReturnAction({ onSelect }) {
  return <DropdownMenuItem onSelect={onSelect} className="gap-2 font-bold"><RotateCcw className="h-4 w-4" />مرتجع أو استبدال</DropdownMenuItem>;
}
