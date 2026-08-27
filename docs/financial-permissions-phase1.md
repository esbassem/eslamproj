# Financial Permissions & Resource Scope — Phase 1

## Decision

Phase 1 uses a hybrid adapter. `account_accounts` is the enforceable financial
resource until Money Destinations exist. Fine-grained assignments live in
`user_financial_account_access`; the older `user_account_access` remains unchanged
and maps to `view` only during migration.

No Payment, Transfer, Journal, or Money Destination domain object is introduced.

## Authorization contract

```text
Allowed =
  active tenant membership
  AND canonical financial action permission
  AND branch scope when a branch is supplied
  AND account-backed financial resource scope when a resource is supplied
  AND caller-confirmed valid state transition
```

Use:

```sql
can_perform_financial_action(
  tenant_id,
  'financial.payment.confirm',
  destination_account_id,
  'confirm',
  branch_id,
  payment_state_allows_confirmation
)
```

RPCs should normally call `assert_financial_authorized(...)`, which raises SQLSTATE
`42501` when any component is missing.

## Action permissions

The catalog contains payment create/submit/confirm/reject/reverse/refund/allocate,
transfer create/send/receive/confirm, reconciliation manage, manual move create,
move post, audit view, destination manage, and journal manage.

Permissions remain assigned through the existing canonical bridge:

```text
tenant user -> res_users_groups -> res_groups
            -> auth_group_permissions -> auth_permissions
```

No default groups are recreated and no permission is granted automatically to a
non-owner.

## Resource scope

Access types are `view`, `initiate`, `confirm`, `pay_out`, `transfer_from`,
`transfer_to`, and `reconcile`. Assignments may be tenant-global for an account or
limited to one branch. A branch-limited assignment additionally requires the target
user to have `user_branch_access` for that branch.

An employee automatically receives only `view` and `initiate` on the active account
whose `responsible_user_id` is that employee. Confirmation, payout, reconciliation,
and transfer from the custody require explicit assignments.

Owner is a centralized in-tenant superuser override. It never crosses tenants.

## Current RPC adapter boundary

Existing Showroom accounting RPCs do not consistently expose a Money Destination,
Journal, or branch-scoped financial resource. Production also had no branch/account
scope assignments at adoption. Phase 1 therefore does not inject fail-closed checks
into those RPCs yet, because doing so would stop valid current operations.

They remain legacy adapters behind the Phase 0 protected ledger. New Financial Core
RPCs must use `assert_financial_authorized`. Existing RPC enforcement should migrate
one flow at a time when its action and account-backed destination are unambiguous.

Suggested mapping:

| Current flow | Future action | Resource access |
| --- | --- | --- |
| `complete_showroom_sale` cash | `financial.payment.confirm` | custody `initiate`/`confirm` according to approval flow |
| `pay_showroom_sale_accounting` | `financial.payment.confirm` | destination `confirm` |
| `settle_showroom_sale_balance` | `financial.payment.confirm` | destination `confirm` |
| open-credit settlement | `financial.payment.allocate` | receivable `reconcile` |
| payment-entity credit | `financial.payment.create`/`confirm` | entity account `initiate`/`confirm` |
| sale cancellation | `financial.payment.reverse` plus commercial cancellation permission | affected resource `confirm` |
| confirmed return | `financial.payment.allocate` or `refund` when cash is actually paid | affected resource access |

## Migration path

```text
Current membership/role checks
  -> canonical action functions + account-backed scope adapter
  -> Money Destination references the ledger account
  -> copy account-backed grants to destination grants
  -> enforce each operational RPC
  -> retire user_account_access and scattered role checks after cutover
```

Settings can continue using the existing group permission editor for actions.
Financial account access is managed by the owner through
`set_user_financial_account_access`; a dedicated Financial Access UI can call this
RPC later without changing the authorization model.
