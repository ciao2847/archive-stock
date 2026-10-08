# Manual maintenance scripts

Files in this directory are never applied automatically. Review the target
project and take a backup before running a destructive script.

## Bundle claim verification

`verify-bundle-claims-sql-editor.sql` wraps the 30 pgTAP checks for SQL Editor. Run the whole file; the final `TEST REPORT (intentional rollback)` exception intentionally displays the report and rolls back test data. Check every numbered result for `ok`.

`verify-bundle-menu.sql` runs 12 shared-menu authorization and lifecycle checks in one block. It requires two existing inventories and rolls back all fixtures and menu-setting changes internally. Success produces no result rows; failures raise their diagnostic message. It is a standalone SQL verification script, not a pgTAP test file.

`verify-bundle-products.sql` verifies per-image names/prices, authoritative total, draft permissions and publication immutability in a single DO block. Run as postgres after `20261006020637`; all fixtures and role changes roll back automatically.

`verify-bundle-campaigns.sql` checks campaign authorization, legacy migration, direct totals, activity isolation, pause behavior and idempotent confirmation (25 checks with fixture rollback). Run after `20261006064734`. After `20261006090000`, `verify-bundle-products.sql` runs 16 checks for itemized name/price storage, cent-exact totals, incomplete-publication rejection, automatic recalculation on opening/removal, and all-null legacy fixed-total compatibility.

- `verify-bundle-removal.sql`: 14 rolled-back checks for all eligible allocation states, image metadata cascade/cleanup paths, inventory authorization, stale records and payment/receiving/outbound protection. Run as postgres after `20261007011431_safe_bundle_order_removal.sql`. Existing draft-only deletion remains available.

## Bimonthly manual accounting verification

`verify-calculator-accounting.sql` runs 42 checks for confirmed bimonthly totals, replacing corrections, stale-revision rejection, cost-only/zero-cost periods, Taipei date boundaries, poster revenue after discounts excluding buyer shipping, private attachments, inventory RLS, immutable snapshots and retiring product costs. Run as postgres after `20261008004748_calculator_period_accounting.sql` and `20261008014308_poster_revenue_settlement.sql`. Run the entire single `DO` block without selecting a fragment. It requires one staff member and two inventories. SQL Editor success with no rows means all 42 checks passed; a NOTICE reports `passed_checks = 42`. All fixtures and temporary objects roll back inside the block, so no follow-up query of temporary tables is needed. The app now uses manual totals only; the historical script name and attachment checks remain for compatibility with existing records. No OpenAI key is required. The poster revenue migration changes future calculations without rewriting existing snapshots. Deployment details are in `docs/calculator-accounting.md`.

Storage DELETE policies are exercised on a temporary copy with all applicable RLS policies. The script never deletes from `storage.objects` or disables Supabase Storage protection triggers.

## Cabinet / location verification

Run the entire `verify-cabinet-locations.sql` block as postgres after `20261008020858_simplify_product_intake.sql` and `20261008062944_cabinet_location_management.sql`. It checks grid sizes, naming, partial allocations, unchanged total stock, excessive-quantity rejection, movement, occupied-slot protection, adding/deleting empty slots, stock-decrease reconciliation, legacy movement, direct-write rejection and cross-inventory access. All fixtures roll back inside the single block. Details: `docs/cabinet-locations.md`.

For the cabinet tabs and equal grid rollout, run the whole `supabase/migrations/20261008073128_switchable_cabinet_grids.sql` file as postgres after the cabinet migration. It fills all configured coordinates, supports 1–99 rows/columns, adds whole columns or repairs holes, and clears location assignments across ALL inventories once while preserving product data, stock and images. A private maintenance record prevents re-running the file from clearing subsequent putaway records. It rolls back the whole update if product data or stock changes unexpectedly. The original verification block above also works after this migration.

`reset-all-poster-location-assignments.sql` remains available for an explicitly requested future reset of ALL inventories. It is not needed for the rollout above and has no repeat-run guard: every execution clears both primary location pointers and slot allocations. It preserves product data, stock, images, cabinets, slots and historical movements, with checks inside the transaction. The returned row reports the cleared counts and zero remaining assignments. It is never applied automatically during deployment.
