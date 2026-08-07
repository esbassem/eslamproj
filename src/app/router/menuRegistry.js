import { lazy } from 'react';
import { routeLoaders } from '@/app/router/appRouteRegistry';

function lazyNamed(loader, exportName) {
  return lazy(() => loader().then((module) => ({ default: module[exportName] })));
}

function component(loaderName, exportName) {
  return lazyNamed(routeLoaders[loaderName], exportName);
}

const routes = {};
function register(paths, loaderName, exportName) {
  const Component = component(loaderName, exportName);
  paths.forEach((path) => { routes[path] = Component; });
}

register(['/app/products'], 'products', 'ProductsPage');
register(['/app/products/attributes'], 'productAttributes', 'ProductAttributesPage');
register(['/app/products/attribute-values'], 'productAttributeValues', 'ProductAttributeValuesPage');
register(['/app/products/tracking-identifiers'], 'productTrackingIdentifiers', 'ProductTrackingIdentifiersPage');
register(['/app/inventory'], 'inventory', 'InventoryDashboard');
register(['/app/inventory/stock'], 'inventoryStock', 'StockListPage');
register(['/app/inventory/serials'], 'inventorySerials', 'SerialUnitsPage');
register(['/app/inventory/moves'], 'inventoryMoves', 'StockMovesPage');
register(['/app/sales', '/app/sales/invoices'], 'invoices', 'InvoicesPage');
register(['/app/sales/contracts', '/app/contracts'], 'contracts', 'ContractsPage');
register(['/app/accounting', '/app/accounting/payments', '/apps/accounting', '/apps/accounting/payments'], 'payments', 'PaymentsPage');
register(['/app/accounting/journals', '/apps/accounting/journals', '/apps/accountant/journals'], 'settings', 'SettingsPage');
register(['/apps/accountant', '/apps/accountant/payments'], 'accountant', 'AccountantHomePage');
register(['/app/contacts'], 'contacts', 'ContactsPage');
register(['/app/contacts/customers', '/app/partners/customers'], 'customers', 'CustomersPage');
register(['/app/contacts/suppliers', '/app/partners/suppliers'], 'suppliers', 'SuppliersPage');
register(['/app/contacts/payment-entities', '/app/partners/payment-entities'], 'paymentEntities', 'PaymentEntitiesPage');
register(['/photos', '/app/photos'], 'photosHome', 'PhotosHomePage');
register(['/photos/all', '/app/photos/all'], 'photosAll', 'PhotosAllPage');
register(['/photos/unlinked', '/app/photos/unlinked'], 'photosUnlinked', 'PhotosUnlinkedPage');
register(['/photos/settings', '/app/photos/settings'], 'photosSettings', 'PhotosSettingsPage');
register(['/app/partners'], 'partners', 'PartnersPage');
register(['/app/pos'], 'pos', 'PosPage');
register(['/app/old_cashbox', '/app/old-cashbox', '/apps/old-cashbox'], 'oldCashbox', 'OldCashboxPage');
register(['/app/showroom_point', '/app/showroom_point/new', '/app/showroom_point/customers', '/app/showroom_point/settings'], 'showroomSell', 'ShowroomSellPage');
register(['/app/moto-customer-care', '/app/moto-customer-care/dashboard', '/app/moto-customer-care/sales', '/apps/moto-customer-care', '/apps/moto-customer-care/dashboard', '/apps/moto-customer-care/sales'], 'customerCareList', 'MotoCustomerCareSalesFollowUpListPage');
register(['/app/receivables', '/app/receivables/installments', '/apps/receivables', '/apps/receivables/installments'], 'receivables', 'ReceivablesPage');
register(['/app/settings', '/app/settings/team', '/app/settings/permissions', '/app/team'], 'settings', 'SettingsPage');
register(['/app/settings/accounting/cash-locations'], 'cashLocationsSettings', 'CashLocationsSettingsPage');

export const MENU_COMPONENTS = routes;
