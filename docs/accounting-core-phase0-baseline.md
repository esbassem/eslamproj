# Accounting Core Phase 0 Baseline

Status: documentation-only schema reference.  
Captured from: the Supabase project linked by `supabase/.temp/project-ref`.  
Captured at: 2026-08-26T16:18:50.630Z.  
Database session: `default_transaction_read_only = on`, then `SET ROLE postgres`.  

This file is deliberately outside `supabase/migrations`. It must not be executed as
a migration and makes no database change. It records the live Accounting Core so a
future clean-environment baseline can be designed with dependency ordering and
explicit adoption semantics. Existing Production objects must not be recreated from
this document directly.

## Scope

The financial ledger core is:

```text
account_groups
  └─ account_accounts
       └─ account_move_lines ── account_moves
              └─ account_partial_reconcile (debit/credit line links)

account_journals ── account_moves
```

No additional table is itself required to calculate a ledger account balance. The
core references operational master records in `tenants`, `branches`, `partners`,
`tenant_users`, `account_payment_methods`, `account_payments`, and
`product_products`.

## Live row counts at capture time

| Table | Rows |
| --- | ---: |
| `account_groups` | 146 |
| `account_accounts` | 144 |
| `account_journals` | 36 |
| `account_moves` | 375 |
| `account_move_lines` | 750 |
| `account_partial_reconcile` | 187 |

All 375 moves were `posted`. Observed move types were `journal` 83, `payment` 99,
`refund` 6, and `sale` 187. Observed journal types were `bank`, `cash`, `purchase`,
and `sale`, with 9 rows of each.

## `account_groups`

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` |
| `tenant_id` | uuid | no | — |
| `code` | text | no | — |
| `name` | text | no | — |
| `created_at` | timestamptz | no | `now()` |
| `updated_at` | timestamptz | no | `now()` |
| `code_prefix_start` | text | yes | — |
| `code_prefix_end` | text | yes | — |
| `parent_id` | uuid | yes | — |

Constraints:

- PK `account_groups_pkey (id)`.
- UNIQUE `(tenant_id, code)` and `(tenant_id, name)`.
- FK `tenant_id → tenants(id) ON DELETE CASCADE`.
- FK `parent_id → account_groups(id)`; this is not tenant-composite.

Indexes include the PK, tenant index, three redundant unique indexes on
`(tenant_id, code)`, and the unique constraint indexes.

Trigger: `trg_account_groups_set_updated_at`, BEFORE UPDATE, calls
`set_updated_at()`.

## `account_accounts`

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` |
| `tenant_id` | uuid | no | — |
| `group_id` | uuid | yes | — |
| `code` | text | no | — |
| `name` | text | no | — |
| `account_type` | text | no | — |
| `reconcile` | boolean | no | `false` |
| `active` | boolean | no | `true` |
| `created_at` | timestamptz | no | `now()` |
| `updated_at` | timestamptz | no | `now()` |
| `responsible_user_id` | uuid | yes | — |

Constraints:

- PK `(id)` and unique index `(id, tenant_id)`.
- UNIQUE `(tenant_id, code)` and `(tenant_id, name)`.
- CHECK `account_type IN ('asset','liability','equity','income','expense')`.
- FK `tenant_id → tenants(id) ON DELETE CASCADE`.
- FK `group_id → account_groups(id) ON DELETE SET NULL`; not tenant-composite.
- FK `responsible_user_id → tenant_users(id) ON DELETE SET NULL`; not
  tenant-composite.

Indexes include redundant unique indexes on `(tenant_id, code)`, indexes on tenant
and group, and unique active custody ownership:
`(tenant_id, responsible_user_id) WHERE responsible_user_id IS NOT NULL AND active`.

Trigger: `trg_account_accounts_set_updated_at`, BEFORE UPDATE, calls
`set_updated_at()`.

## `account_journals`

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` |
| `tenant_id` | uuid | no | — |
| `branch_id` | uuid | yes | — |
| `name` | text | no | — |
| `code` | text | yes | — |
| `type` | text | no | — |
| `default_account_id` | uuid | yes | — |
| `is_active` | boolean | no | `true` |
| `created_at` | timestamptz | no | `now()` |
| `updated_at` | timestamptz | no | `now()` |
| `incoming_payment_method_default_id` | uuid | yes | — |
| `outgoing_payment_method_default_id` | uuid | yes | — |
| `outstanding_receipts_account_id` | uuid | yes | — |
| `outstanding_payments_account_id` | uuid | yes | — |
| `suspense_account_id` | uuid | yes | — |
| `profit_account_id` | uuid | yes | — |
| `loss_account_id` | uuid | yes | — |

Constraints:

- PK `(id)` and UNIQUE `(tenant_id, name)`.
- Unique indexes `(tenant_id, code)`; one is partial for non-null codes.
- CHECK `type IN ('cash','bank','sale','purchase','general')`.
- FK `tenant_id → tenants(id) ON DELETE CASCADE`.
- FK `branch_id → branches(id) ON DELETE SET NULL`.
- FK `default_account_id → account_accounts(id) ON DELETE SET NULL`.
- FKs for outstanding receipt/payment, suspense, profit and loss accounts use
  `account_accounts(id) ON DELETE RESTRICT`.
- Incoming/outgoing payment method defaults reference
  `account_payment_methods(id) ON DELETE SET NULL`.
- None of the branch/account/payment-method FKs is tenant-composite.

Trigger: `trg_account_journals_set_updated_at`, BEFORE UPDATE, calls
`set_updated_at()`.

## `account_moves`

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` |
| `tenant_id` | uuid | no | — |
| `branch_id` | uuid | yes | — |
| `name` | text | no | — |
| `move_type` | text | no | — |
| `move_number` | text | yes | — |
| `partner_id` | uuid | yes | — |
| `invoice_date` | date | no | `CURRENT_DATE` |
| `date` | timestamptz | no | `now()` |
| `amount_total` | numeric | no | `0` |
| `state` | text | no | `'draft'` |
| `ref` | text | yes | — |
| `notes` | text | yes | — |
| `pay_method` | varchar | yes | — |
| `currency_code` | varchar | no | `'EGP'` |
| `created_by` | uuid | yes | — |
| `created_at` | timestamptz | no | `now()` |
| `updated_at` | timestamptz | no | `now()` |
| `journal_id` | uuid | yes | — |
| `payment_id` | uuid | yes | — |
| `reversed_entry_id` | uuid | yes | — |
| `reversed_move_id` | uuid | yes | — |

Constraints:

- PK `(id)`, UNIQUE `(id, tenant_id)`.
- CHECK state in `draft`, `posted`, `cancelled`.
- CHECK move type in `sale`, `purchase`, `refund`, `payment`, `journal`,
  `cash_in`, `cash_out`, `opening`.
- CHECK `reversed_entry_id IS NULL OR reversed_entry_id <> id`.
- Tenant FK with cascade.
- `reversed_entry_id,tenant_id → account_moves(id,tenant_id) ON DELETE RESTRICT`.
- `reversed_move_id → account_moves(id) ON DELETE SET NULL`; not tenant-composite.
- Branch, journal, partner, payment and created-by FKs use IDs only and do not
  enforce same-tenant linkage.

Important indexes: `(tenant_id,date DESC)`, `(tenant_id,move_type)`, unique non-null
`(tenant_id,move_number)`, and one reversal per original via unique
`(tenant_id,reversed_entry_id) WHERE reversed_entry_id IS NOT NULL`.

Trigger: `trg_account_moves_set_updated_at`, BEFORE UPDATE only. There is no live
balance-validation or posted-immutability trigger.

## `account_move_lines`

| Column | Type | Null | Default / generated |
| --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` |
| `tenant_id` | uuid | no | — |
| `move_id` | uuid | no | — |
| `account_id` | uuid | no | — |
| `partner_id` | uuid | yes | — |
| `label` | text | yes | — |
| `quantity` | numeric | no | `1` |
| `unit_price` | numeric | no | `0` |
| `debit` | numeric | no | `0` |
| `credit` | numeric | no | `0` |
| `line_type` | text | yes | — |
| `due_date` | date | yes | — |
| `is_reconciled` | boolean | no | `false` |
| `created_by` | uuid | yes | — |
| `created_at` | timestamptz | no | `now()` |
| `balance` | numeric | yes | GENERATED ALWAYS AS `(debit-credit)` |
| `currency_code` | varchar | no | `'EGP'` |
| `amount_residual` | numeric | no | `0` |
| `amount_residual_currency` | numeric | no | `0` |
| `parent_state` | text | yes | — |
| `product_product_id` | uuid | yes | — |
| `source_entity_id` | uuid | yes | — |

There is no ordinal position 13 in the live catalog, showing a previously dropped
column.

Constraints:

- PK `(id)`, UNIQUE `(id,tenant_id)`.
- `debit >= 0`, `credit >= 0`, `quantity > 0`, `unit_price >= 0`.
- A strict debit/credit check requires exactly one side to be greater than zero and
  the other to equal zero. Therefore both-positive and both-zero lines are rejected.
- A second overlapping amounts check also rejects negatives and both-positive.
- FKs `move_id → account_moves(id) ON DELETE CASCADE` and
  `account_id → account_accounts(id) ON DELETE RESTRICT` are not tenant-composite.
- Partner, product and created-by FKs are not tenant-composite.
- Only `source_entity_id,tenant_id → partners(id,tenant_id)` is tenant-composite.

There are no user triggers on this table. In particular there is no trigger that
guards posted lines or validates the move total.

## `account_partial_reconcile`

| Column | Type | Null | Default |
| --- | --- | --- | --- |
| `id` | uuid | no | `gen_random_uuid()` |
| `tenant_id` | uuid | no | — |
| `debit_move_id` | uuid | no | — |
| `credit_move_id` | uuid | no | — |
| `amount` | numeric | no | — |
| `max_date` | date | yes | — |
| `create_date` | timestamptz | no | `now()` |
| `created_by` | uuid | yes | — |

Constraints:

- PK `(id)`.
- CHECK `amount > 0`.
- CHECK `debit_move_id <> credit_move_id`.
- Debit/credit line FKs reference `account_move_lines(id) ON DELETE CASCADE` and
  are not tenant-composite.
- `created_by → tenant_users(id) ON DELETE SET NULL` is not tenant-composite.
- Tenant FK cascades from `tenants`.

There is no trigger or global constraint preventing over-reconciliation, verifying
line polarity/account/currency, or forcing the reconciliation tenant to equal both
line tenants. Operational RPCs perform locking and validation for their own flows.

## RLS and grants

All six tables have RLS enabled, not forced. Each has exactly one permissive policy:

```sql
FOR ALL TO authenticated
USING (is_tenant_member(tenant_id))
WITH CHECK (is_tenant_member(tenant_id))
```

`authenticated` and `service_role` have direct SELECT, INSERT, UPDATE, DELETE,
TRUNCATE, REFERENCES and TRIGGER table grants. No material table grant to `anon` was
found. Consequently any active tenant member can directly read and mutate all six
tables through PostgREST within that tenant; writes are not RPC-only. The owner of a
table and bypass-RLS roles are not constrained by these policies because RLS is not
forced.

## DB guarantees snapshot

| Rule | Live guarantee |
| --- | --- |
| Tenant membership at table boundary | RLS `is_tenant_member(tenant_id)` |
| Same-tenant foreign relations | Partial; most operational FKs use ID only |
| Unique account code | Yes, `(tenant_id,code)` |
| Unique group code | Yes, `(tenant_id,code)` |
| Unique non-null journal code | Yes, by unique indexes |
| Debit non-negative | Yes |
| Credit non-negative | Yes |
| Exactly one debit/credit side positive | Yes |
| Move globally balanced | No trigger, constraint, or deferred constraint |
| Posted move immutable | No |
| Posted move-line immutable | No |
| Posted move protected from delete | No |
| Posted move-line protected from delete | No |
| Positive reconciliation amount | Yes |
| Non-self reconciliation | Yes |
| Same-tenant reconciliation | No composite FK/trigger |
| Over-reconciliation prevention | No global DB guarantee |

## Exact index inventory

- `account_groups`: `account_groups_pkey`, `account_groups_tenant_code_uniq`,
  `account_groups_tenant_id_code_key`, `account_groups_tenant_id_name_key`,
  `idx_account_groups_tenant_id`, `ux_account_groups_tenant_code`.
- `account_accounts`: `account_accounts_id_tenant_unique`,
  `account_accounts_pkey`, `account_accounts_tenant_code_uniq`,
  `account_accounts_tenant_id_code_key`, `account_accounts_tenant_id_name_key`,
  `idx_account_accounts_group_id`, `idx_account_accounts_tenant_id`,
  `uq_account_accounts_active_responsible_user`,
  `ux_account_accounts_tenant_code`.
- `account_journals`: `account_journals_pkey`,
  `account_journals_tenant_code_uniq`, `account_journals_tenant_id_name_key`,
  `idx_account_journals_branch`, `idx_account_journals_tenant`,
  `ux_account_journals_tenant_code`.
- `account_moves`: `account_moves_id_tenant_key`, `account_moves_pkey`,
  `idx_account_moves_branch_id`, `idx_account_moves_date`,
  `idx_account_moves_journal`, `idx_account_moves_move_type`,
  `idx_account_moves_partner_id`, `idx_account_moves_payment_id`,
  `idx_account_moves_tenant_id`, `ux_account_moves_one_reversal_per_original`,
  `ux_account_moves_tenant_move_number`.
- `account_move_lines`: `account_move_lines_id_tenant_key`,
  `account_move_lines_pkey`, `idx_account_move_lines_account_id`,
  `idx_account_move_lines_is_reconciled`, `idx_account_move_lines_move_id`,
  `idx_account_move_lines_move_id_account_id`,
  `idx_account_move_lines_open_entity_credits`,
  `idx_account_move_lines_partner_id`,
  `idx_account_move_lines_source_entity_tenant`,
  `idx_account_move_lines_tenant_id`, `ix_account_move_lines_account_id`,
  `ix_account_move_lines_move_id`, `ix_account_move_lines_partner_id`.
- `account_partial_reconcile`: `account_partial_reconcile_pkey`,
  `idx_account_partial_reconcile_credit_move_id`,
  `idx_account_partial_reconcile_debit_move_id`,
  `idx_account_partial_reconcile_max_date`,
  `idx_account_partial_reconcile_tenant_id`.

## Ledger-writing functions present in the live DB

All operations below are atomic at PostgreSQL function/statement transaction scope.
Except for the two migration helpers, the direct writers are SECURITY DEFINER.

Active operational direct writers:

- `complete_showroom_sale(uuid,numeric,text,jsonb)` — moves, lines, reconciliation.
- `pay_showroom_sale_accounting(uuid,numeric,text,text)` — moves, lines,
  reconciliation; older payment entry point still present.
- `settle_showroom_sale_balance(uuid,numeric,text,uuid,text)` — moves, lines,
  reconciliation.
- `settle_showroom_sale_with_advance_credit(uuid,uuid,numeric,text)` — moves,
  lines, reconciliation; compatibility advance-credit flow.
- `settle_showroom_sale_with_open_credits(uuid,uuid,jsonb)` — updates lines and
  writes reconciliation.
- `create_accountant_payment_entity_credit(jsonb)` — moves and lines.
- `cancel_showroom_sale(uuid,uuid,text,text)` — moves, lines, reconciliation.
- `create_confirmed_showroom_sale_return(uuid,uuid,jsonb,text,text,uuid)` — moves,
  lines, reconciliation.
- `delete_account_move_atomic(uuid,uuid)` — deletes moves, lines and reconciliation;
  owner gate is injected by the authorization baseline migration.

Live definition inspection found no named `has_permission(...)` check in any direct
ledger writer. `cancel_showroom_sale`, `create_confirmed_showroom_sale_return`, and
`delete_account_move_atomic` contain owner/role gating; the other active writers
validate authentication/tenant membership but contain no owner/role gate. The
six-argument CRM overload of `complete_showroom_sale` is an indirect writer: it calls
the four-argument ledger writer and then links the CRM state.

Legacy migration writers:

- `migrate_old_showroom_sale_payments()` — SECURITY INVOKER, writes all three
  ledger tables, and has EXECUTE grants to `anon`, `authenticated`, and
  `service_role`.
- `migrate_old_showroom_sales_invoice_moves()` — SECURITY INVOKER, writes moves and
  lines, and has EXECUTE grants to `anon`, `authenticated`, and `service_role`.

Referenced but not direct writers include cancellation preview, customer-open-credit
listing, paperwork delivery checks, pending-sale deletion and custody-account
deletion.

Production drift: `create_cash_location_operation(uuid,uuid,uuid,text,numeric,text)`
is referenced by the current frontend and exists in repository migration
`20260720120000_create_cash_location_operation_rpc.sql`, but the function was not
present in the linked live database catalog at capture time.

## Audit fields

- Groups/accounts/journals: `created_at`, `updated_at`; no creator/updater IDs.
- Moves: `created_at`, `updated_at`, `created_by`, `ref`, `notes`,
  `reversed_entry_id`, `reversed_move_id`.
- Lines: `created_at`, `created_by`; no `updated_at`.
- Reconciliation: `create_date`, `created_by`; no `updated_at`.
- No core table has `updated_by`, `posted_at`, `posted_by`, `reversed_by`, or
  `reversed_at`.

## Read-only data-quality audit

Every count below was zero at capture time:

- duplicate tenant/account, tenant/group, or tenant/journal codes;
- accounts without groups or with group tenant mismatch;
- moves without lines, unbalanced moves, unbalanced posted moves, or moves without
  tenants;
- move/journal and move/branch tenant mismatches;
- negative debit, negative credit, both-positive, both-zero, or accountless lines;
- line/move and line/account tenant mismatches;
- non-positive, self, missing-line, or cross-tenant reconciliations;
- debit-side or credit-side obvious over-reconciliation.

The zero-count audit demonstrates current data quality; it does not replace missing
constraints for future writes.

## Legacy and compatibility markers

- `pay_showroom_sale_accounting` remains callable beside the newer settlement flow.
- `settle_showroom_sale_with_advance_credit` remains beside open-credit settlement.
- The two `migrate_old_*` functions remain live and broadly executable.
- `payment_id`, `pay_method`, `parent_state`, cached residual columns, and both
  `reversed_entry_id`/`reversed_move_id` support multiple generations of flows.
- Several duplicate indexes exist on account/group codes and move-line FK columns.
- `account_move_lines` has a dropped-column ordinal gap.

## Reproduction and adoption notes

This snapshot is safe because it contains documentation only and is not in the
migration directory. To build a new clean environment later:

1. Generate a complete schema-only dump from the authoritative project.
2. Order dependencies before these tables (`tenants`, partners, branches, users,
   payments and products).
3. Convert the selected objects into an idempotent clean-install baseline.
4. Add a separate adoption/no-op strategy for existing Production databases.
5. Test both a fresh install and an upgrade from current migration history.

Do not copy these definitions into `supabase/migrations` until those two paths are
tested. Phase 0 intentionally makes no ledger protection or authorization change.
