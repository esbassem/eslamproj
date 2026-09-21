# Platform navigation standard

Navigation follows five distinct levels: platform launcher, application, primary section, entity details, and temporary task flow. A platform-home action always links to `/app`; it is never browser history.

## Ownership

- React Router and feature route constants own valid URLs.
- `ir_ui_menus` owns installed application-menu visibility, hierarchy, labels, and order.
- `platformNavigation.js` owns canonical breadcrumb metadata for adopted routes and canonical sidebar-section mapping.
- Loaded entity data supplies dynamic detail labels. Breadcrumb rendering must not trigger data requests.

## Menu convention

- `<app>.root` is a menu container and application identity.
- `<app>.overview` is an optional clickable application home when a real overview exists.
- `<app>.<section>` is a primary application section.
- Entity details and task flows are routes, not primary sidebar rows.
- Applications that naturally open on their main list do not need a synthetic overview.

## Compatibility audit (2026-08-23)

- Standard: Paperwork, Inventory, CRM menu data, Settings, Contacts.
- Direct-list/no synthetic home required: Receivables, POS, Accountant, Old Cashbox.
- Custom shell/navigation retained for compatibility: CRM, Showroom Point, Moto Customer Care.
- Root/home collision requiring a future app-specific decision: Photos.
- Showroom menu URLs use legacy `/showroom-point` metadata while routed pages use `/app/showroom_point`; handle in an app-specific migration, not a platform-wide rewrite.

Custom shells must still expose the shared platform-home action. Migration toward the central DB-driven sidebar is app-specific and must not be bundled with business workflow changes.
