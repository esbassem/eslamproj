// Clean baseline: only application-entry permissions exist. Application codes
// remain data-driven; this list is an optional typed reference for shared code.
export const PERMISSIONS = Object.freeze({
  ACCOUNTANT_APP_ACCESS: 'accountant_app.access',
  CONTACTS_ACCESS: 'contacts.access',
  CRM_ACCESS: 'crm.access',
  MOTO_CUSTOMER_CARE_ACCESS: 'moto_customer_care.access',
  OLD_CASHBOX_ACCESS: 'old_cashbox.access',
  PHOTOS_ACCESS: 'photos.access',
  POS_ACCESS: 'pos.access',
  PRODUCTS_ACCESS: 'products.access',
  RECEIVABLES_ACCESS: 'receivables.access',
  SETTINGS_ACCESS: 'settings.access',
  SHOWROOM_POINT_ACCESS: 'showroom_point.access',
});

export const PERMISSION_CODES = Object.freeze(Object.values(PERMISSIONS));
