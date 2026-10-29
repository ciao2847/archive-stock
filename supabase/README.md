# Supabase database workflow

This project uses timestamped, imperative migrations.

## Source of truth

- `migrations/` contains every new production database change.
- `legacy/` contains historical installation scripts that were applied manually
  before migration tracking was introduced. Do not edit or rerun them blindly.
- `scripts/` contains destructive or one-off maintenance tools. Review and run
  them manually; they are never part of deployment migrations.

## Commands

```bash
npx supabase@2.116.0 migration new descriptive_name
npx supabase@2.116.0 migration list --linked
SUPABASE_PROJECT_ID=your-project-ref npm run db:types
```

Apply migrations to a staging project first. Run database advisors and the test
suite before applying the same migration to production.

## Stall checkout

Apply `20261014002007_add_stall_checkout.sql` to staging before deploying the
checkout UI, then run `tests/stall_checkout.test.sql` as the database owner on
a test database with a staff member and two inventories. The test rolls back
its fixtures. Apply the migration to production through the usual release
workflow after validation.

Existing `products.price` values remain member prices. Label exports show
member prices and list prices (member price + NT$150). The authenticated
checkout RPC recalculates list prices, checks the displayed total, records a
paid, packed order, decrements stock and consumes the scanned labels in one
transaction. A retry with the exact original set of sold labels returns the
existing receipt. No payment gateway is involved; staff confirm payment at
the stall.
