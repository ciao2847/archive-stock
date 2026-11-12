## 1. Database
- [x] 1.1 Add inventory modes, receipt batches, FIFO allocations and protected RPCs; verify database tests for spanning batches, missing costs, returns, adjustments and permissions.
- [x] 1.2 Extend settlement preview and immutable cost snapshots; verify manual compatibility, missing-cost rejection and historical consistency in database tests.

## 2. Application
- [x] 2.1 Add typed cost APIs, inventory mode settings and product batch editor; verify typecheck and browser interactions.
- [x] 2.2 Integrate product costs into accounting, shares, dashboard and Excel; verify accounting/export tests and browser preview.

## 3. Validation
- [x] 3.1 Document migration and opening costs, run tests, lint, typecheck, build and OpenSpec validation; record deployment limitations.

## Verification results
- 139 tests passed, including real migration execution in PGlite and API permission/validation tests.
- FIFO browser checks passed at 320, 390, 768 and 1280px; manual accounting checks passed at 320, 390, 768, 1024, 1280 and 1600px.
- Typecheck, ESLint, production build and strict OpenSpec validation passed.
- Supabase local security advisors attempted but unavailable: no PostgreSQL listener at 127.0.0.1:54322. RLS and RPC permission checks passed in PGlite.
- Existing product-intake browser assertion updated to match the country-flag naming already present in HEAD.
- User screenshot confirms hosted mode product_fifo with 60 batches for NN佛系海報代購 and period_total with 0 batches for 海報小天地 after the follow-up repair. Application deployment remains to be verified.

## 4. Confirmed inventory names
- [x] 4.1 Add an owner-run follow-up migration for the confirmed NN佛系海報代購 name, preserving 海報小天地 and existing batches; verify activation after the original migration, SQL Editor without JWT, repeat execution and permission rejection in PGlite.
- Follow-up repair verified with SQL Editor-style empty auth context, existing unsettled sales, retained entered costs, repeated execution, restricted caller rejection, and missing/duplicate name rejection.
