import { paperworkReportsService } from '@/features/paperwork/services/internal/paperworkReports.service';
import { paperworkRequestsService } from '@/features/paperwork/services/internal/paperworkRequests.service';
import { paperworkDocumentsService } from '@/features/paperwork/services/internal/paperworkDocuments.service';
import { paperworkWorkflowService } from '@/features/paperwork/services/internal/paperworkWorkflow.service';

export {
  getPaperworkDocumentMoveDirectionLabel,
  getPaperworkDocumentSourceLabel,
  getPaperworkDocumentStatusLabel,
} from '@/features/paperwork/services/internal/paperworkDataSupport';

export const paperworkService = {
  ...paperworkReportsService,
  ...paperworkRequestsService,
  ...paperworkDocumentsService,
  ...paperworkWorkflowService,
};
