## 1. Database
- [x] 1.1 Add inventory modes, receipt batches, FIFO allocations and protected RPCs; verify database tests for spanning batches, missing costs, returns, adjustments and permissions.
- [x] 1.2 Extend settlement preview and immutable cost snapshots; verify manual compatibility, missing-cost rejection and historical consistency in database tests.

## 2. Application
- [x] 2.1 Add typed cost APIs, inventory mode settings and product batch editor; verify typecheck and browser interactions.
- [x] 2.2 Integrate product costs into accounting, shares, dashboard and Excel; verify accounting/export tests and browser preview.

## 3. Validation
- [x] 3.1 Document migration and opening costs, run tests, lint, typecheck, build and OpenSpec validation; record deployment limitations.

## Verification results
- 145 tests passed, including real migration execution in PGlite and API permission/validation tests.
- FIFO browser checks passed at 320, 390, 768 and 1280px; manual accounting checks passed at 320, 390, 768, 1024, 1280 and 1600px.
- Typecheck, ESLint, production build and strict OpenSpec validation passed.
- Supabase local security advisors attempted but unavailable: no PostgreSQL listener at 127.0.0.1:54322. RLS and RPC permission checks passed in PGlite.
- Existing product-intake browser assertion updated to match the country-flag naming already present in HEAD.
- User screenshot confirms hosted mode product_fifo with 60 batches for NN佛系海報代購 and period_total with 0 batches for 海報小天地 after the follow-up repair. Production deployment verified at archive-stock.vercel.app.

## 4. Confirmed inventory names
- [x] 4.1 Add an owner-run follow-up migration for the confirmed NN佛系海報代購 name, preserving 海報小天地 and existing batches; verify activation after the original migration, SQL Editor without JWT, repeat execution and permission rejection in PGlite.
- Follow-up repair verified with SQL Editor-style empty auth context, existing unsettled sales, retained entered costs, repeated execution, restricted caller rejection, and missing/duplicate name rejection.

## 5. Direct per-poster cost entry
- [x] 5.1 Add a nullable poster unit cost and atomic product/cost save RPC; verify create, zero-stock, new receipts, existing batches, revision rollback and tenant access with SQL tests.
- [x] 5.2 Add direct cost fields to product creation/editing and validated API routing; verify browser tests for FIFO and manual inventories plus API validation.
- [x] 5.3 Run checks, apply the prepared migration if connection access is available, and synchronize GitHub and deployment; report the verified release state.

### Direct poster cost release verification
- Production migration 20261112024350 applied and recorded; prior batch and settlement records were unchanged.
- Live product-cost read RPC and execute permissions verified; security advisors retained 0 errors and the same 19 pre-existing warnings.
- 145 tests, typecheck, lint, production build and direct-cost browser scenarios passed; existing intake and preorder browser checks passed.
- Product form code commit 87d46d59802cf1f55defb5e3f430c01f65bc7a78 pushed to main and deployed to production as dpl_EGQgnef5jSssC3Z4ewPHJza3tHGv.
