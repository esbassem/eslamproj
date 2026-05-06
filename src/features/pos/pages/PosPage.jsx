import { useParams } from 'react-router-dom';
import { PosOverview } from '@/features/pos/components/PosOverview';
import { PosSellPage } from '@/features/pos/pages/PosSellPage';

export function PosPage() {
  const { posId, sessionId } = useParams();

  if (posId && sessionId) {
    return <PosSellPage />;
  }

  return <PosOverview />;
}
