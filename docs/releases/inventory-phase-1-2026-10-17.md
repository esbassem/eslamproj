# Inventory Phase 1 release manifest

This manifest isolates the Inventory navigation and stock-balances release from
the other changes currently present in the working tree.

## Database (apply first)

- `supabase/migrations/20261017120000_inventory_navigation_and_stock_balances.sql`

## Frontend

- `src/app/router/AppRouter.jsx`
- `src/app/router/appRouteRegistry.js`
- `src/app/router/menuRegistry.js`
- `src/contexts/AppContext.jsx`
- `src/core/navigation/platformNavigation.js`
- `src/features/inventory/api/inventory.api.js`
- `src/features/inventory/hooks/useStock.js`
- `src/features/inventory/pages/InventoryReturnReviewsPage.jsx`
- `src/features/inventory/pages/StockListPage.jsx`
- `src/features/products/pages/InventoryLocationsPage.jsx`
- `src/features/products/pages/InventoryOverviewPage.jsx`
- `src/services/apps.service.js`

## Verification only (do not ship in the runtime bundle)

- `src/features/inventory/inventoryNavigationStock.test.mjs`

## Explicit exclusions

- `public/version.json` (build-generated/pre-existing working-tree change)
- Sales and POS files
- Inventory Core migrations and runtime tests
- All other working-tree changes not listed above

`src/core/navigation/platformNavigation.js` also contains a pre-existing Sales
hunk in the dirty working tree. Release preparation must select only its
Inventory navigation hunk; the Sales hunk is not part of this release.

Deployment remains intentionally unexecuted pending explicit approval. Apply the
database migration before publishing the frontend so the stock-balance RPC and
the centralized menu rows exist when the new UI becomes active.
