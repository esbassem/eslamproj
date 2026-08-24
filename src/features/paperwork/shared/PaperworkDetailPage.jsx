import { useNavigate } from 'react-router-dom';
import { PaperworkPage } from '@/features/paperwork/shared/PaperworkPage';
import { PaperworkBackButton } from '@/features/paperwork/shared/PaperworkBackButton';

export function PaperworkDetailPage({ title, description, returnContext, actions, children }) {
  const navigate = useNavigate();
  return (
    <PaperworkPage
      title={title}
      description={description}
      contextualBack={(
        <PaperworkBackButton
          onClick={() => navigate(returnContext.returnTo)}
          label={returnContext.returnLabel}
        />
      )}
      actions={actions}
    >
      {children}
    </PaperworkPage>
  );
}
