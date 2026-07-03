import { lazy } from 'react';

function lazyNamed(loader, exportName) {
  return lazy(() => loader().then((module) => ({ default: module[exportName] })));
}

export const MENU_COMPONENTS = {
  '/app/products': lazyNamed(() => import('@/features/products/pages/ProductsPage'), 'ProductsPage'),
  '/app/products/attributes': lazyNamed(() => import('@/features/products/pages/ProductAttributesPage'), 'ProductAttributesPage'),
  '/app/products/attribute-values': lazyNamed(() => import('@/features/products/pages/ProductAttributeValuesPage'), 'ProductAttributeValuesPage'),
  '/app/products/tracking-identifiers': lazyNamed(() => import('@/features/products/pages/ProductTrackingIdentifiersPage'), 'ProductTrackingIdentifiersPage'),

  '/app/inventory': lazyNamed(() => import('@/features/inventory/pages/InventoryDashboard'), 'InventoryDashboard'),
  '/app/inventory/stock': lazyNamed(() => import('@/features/inventory/pages/StockListPage'), 'StockListPage'),
  '/app/inventory/serials': lazyNamed(() => import('@/features/inventory/pages/SerialUnitsPage'), 'SerialUnitsPage'),
  '/app/inventory/moves': lazyNamed(() => import('@/features/inventory/pages/StockMovesPage'), 'StockMovesPage'),

  '/app/sales': lazyNamed(() => import('@/features/invoices/pages/InvoicesPage'), 'InvoicesPage'),
  '/app/sales/invoices': lazyNamed(() => import('@/features/invoices/pages/InvoicesPage'), 'InvoicesPage'),
  '/app/sales/contracts': lazyNamed(() => import('@/features/contracts/pages/ContractsPage'), 'ContractsPage'),

  '/app/accounting': lazyNamed(() => import('@/features/payments/pages/PaymentsPage'), 'PaymentsPage'),
  '/app/accounting/payments': lazyNamed(() => import('@/features/payments/pages/PaymentsPage'), 'PaymentsPage'),
  '/app/accounting/journals': lazyNamed(() => import('@/features/settings/pages/SettingsPage'), 'SettingsPage'),

  '/app/contacts': lazyNamed(() => import('@/features/contacts/pages/ContactsPage'), 'ContactsPage'),
  '/app/contacts/customers': lazyNamed(() => import('@/features/contacts/pages/CustomersPage'), 'CustomersPage'),
  '/app/contacts/suppliers': lazyNamed(() => import('@/features/contacts/pages/SuppliersPage'), 'SuppliersPage'),

  '/photos': lazyNamed(() => import('@/features/photos/pages/PhotosHomePage'), 'PhotosHomePage'),
  '/photos/all': lazyNamed(() => import('@/features/photos/pages/PhotosAllPage'), 'PhotosAllPage'),
  '/photos/unlinked': lazyNamed(() => import('@/features/photos/pages/PhotosUnlinkedPage'), 'PhotosUnlinkedPage'),
  '/photos/settings': lazyNamed(() => import('@/features/photos/pages/PhotosSettingsPage'), 'PhotosSettingsPage'),
  '/app/photos': lazyNamed(() => import('@/features/photos/pages/PhotosHomePage'), 'PhotosHomePage'),
  '/app/photos/all': lazyNamed(() => import('@/features/photos/pages/PhotosAllPage'), 'PhotosAllPage'),
  '/app/photos/unlinked': lazyNamed(() => import('@/features/photos/pages/PhotosUnlinkedPage'), 'PhotosUnlinkedPage'),
  '/app/photos/settings': lazyNamed(() => import('@/features/photos/pages/PhotosSettingsPage'), 'PhotosSettingsPage'),

  '/app/partners': lazyNamed(() => import('@/features/partners/pages/PartnersPage'), 'PartnersPage'),
  '/app/pos': lazyNamed(() => import('@/features/pos/pages/PosPage'), 'PosPage'),
  '/app/old_cashbox': lazyNamed(() => import('@/features/old-cashbox/pages/OldCashboxPage'), 'OldCashboxPage'),
  '/app/old-cashbox': lazyNamed(() => import('@/features/old-cashbox/pages/OldCashboxPage'), 'OldCashboxPage'),
  '/apps/old-cashbox': lazyNamed(() => import('@/features/old-cashbox/pages/OldCashboxPage'), 'OldCashboxPage'),
  '/app/showroom_point': lazyNamed(() => import('@/features/showroom/pages/ShowroomSellPage'), 'ShowroomSellPage'),
  '/app/showroom_point/new': lazyNamed(() => import('@/features/showroom/pages/ShowroomSellPage'), 'ShowroomSellPage'),
  '/app/showroom_point/customers': lazyNamed(() => import('@/features/showroom/pages/ShowroomSellPage'), 'ShowroomSellPage'),
  '/app/showroom_point/settings': lazyNamed(() => import('@/features/showroom/pages/ShowroomSellPage'), 'ShowroomSellPage'),
  '/app/moto-customer-care': lazyNamed(() => import('@/features/moto-customer-care/pages/MotoCustomerCareHomePage'), 'MotoCustomerCareHomePage'),
  '/app/moto-customer-care/dashboard': lazyNamed(() => import('@/features/moto-customer-care/pages/MotoCustomerCareHomePage'), 'MotoCustomerCareHomePage'),
  '/app/moto-customer-care/sales': lazyNamed(() => import('@/features/moto-customer-care/pages/MotoCustomerCareHomePage'), 'MotoCustomerCareHomePage'),
  '/app/moto-customer-care/legacy': lazyNamed(() => import('@/features/moto-customer-care/pages/MotoCustomerCareSalesFollowUpListPage'), 'MotoCustomerCareSalesFollowUpListPage'),
  '/apps/moto-customer-care': lazyNamed(() => import('@/features/moto-customer-care/pages/MotoCustomerCareHomePage'), 'MotoCustomerCareHomePage'),
  '/apps/moto-customer-care/dashboard': lazyNamed(() => import('@/features/moto-customer-care/pages/MotoCustomerCareHomePage'), 'MotoCustomerCareHomePage'),
  '/apps/moto-customer-care/sales': lazyNamed(() => import('@/features/moto-customer-care/pages/MotoCustomerCareHomePage'), 'MotoCustomerCareHomePage'),
  '/app/receivables': lazyNamed(() => import('@/features/receivables/pages/ReceivablesPage'), 'ReceivablesPage'),
  '/app/receivables/installments': lazyNamed(() => import('@/features/receivables/pages/ReceivablesPage'), 'ReceivablesPage'),
  '/apps/receivables': lazyNamed(() => import('@/features/receivables/pages/ReceivablesPage'), 'ReceivablesPage'),
  '/apps/receivables/installments': lazyNamed(() => import('@/features/receivables/pages/ReceivablesPage'), 'ReceivablesPage'),
  '/app/contracts': lazyNamed(() => import('@/features/contracts/pages/ContractsPage'), 'ContractsPage'),
  '/app/settings': lazyNamed(() => import('@/features/settings/pages/SettingsPage'), 'SettingsPage'),
  '/app/settings/team': lazyNamed(() => import('@/features/settings/pages/SettingsPage'), 'SettingsPage'),
  '/app/settings/permissions': lazyNamed(() => import('@/features/settings/pages/SettingsPage'), 'SettingsPage'),
  '/app/team': lazyNamed(() => import('@/features/settings/pages/SettingsPage'), 'SettingsPage'),
};
