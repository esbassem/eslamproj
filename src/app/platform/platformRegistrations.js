import { createNavigationRegistry, createRouteManifest } from '@/platform';
import { SALES_APP_REGISTRATION, SALES_ROUTE_METADATA } from '@/features/sales/platform';

export const OFFICIAL_APP_REGISTRY = createNavigationRegistry([
  SALES_APP_REGISTRATION,
]);

export const OFFICIAL_ROUTE_MANIFEST = createRouteManifest([
  ...SALES_ROUTE_METADATA,
]);
