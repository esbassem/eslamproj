import { ROUTES } from '@/core/config/routes.config';

export function getDefaultAuthenticatedRoute(hasTenant, role) {
  if (!hasTenant) {
    return ROUTES.onboarding;
  }

  return ROUTES.admin;
}

