## 1. Database
- [x] 1.1 Add preview/merge RPC, merge metadata and retired-reference guards; verify atomicity, snapshot/stock preservation, conflicts and tenant security with PGlite and real fulfillment triggers.
## 2. API and interface
- [x] 2.1 Add typed API/client contracts and active product filtering; verify validation, authorization and failure responses with API tests.
- [x] 2.2 Add accessible search/preview/confirm merge dialog in claim settings and canonical reload; verify desktop/mobile happy path, conflicts and failures in browser tests.
## 3. Integration
- [x] 3.1 Run typecheck, targeted lint, relevant regression tests and production build; record deployment prerequisites and verify OpenSpec validation.


Verification: all 123 unit/API/database regression tests passed; the full claim-settings browser harness passed at 390px and 1280px, including an ambiguous network result and successful-merge refresh recovery. Targeted ESLint, TypeScript/production build, strict OpenSpec validation and git diff whitespace checks passed. Full Supabase CLI advisors could not run because no local server listens on 127.0.0.1:54322; the migration was executed and verified in PGlite with real fulfillment triggers, and function privileges/reference guards were checked there. No production migration, deployment or customer-data merge was performed.


Rollout repair (2026-11-06): verified the linked database was missing the merge schema, then applied only `20261106013840_merge_preorders_into_inventory.sql` atomically and recorded its migration history. Product, stock and order-item totals were unchanged; zero product merges were performed. Verified the active-product query under an authenticated inventory role. Management API security advisors reported no new findings compared with the pre-update baseline. Added a physical-missing-column compatibility retry to both catalog readers; unrelated errors and schema-cache errors retain normal filtering/error handling. All 126 regression tests, targeted lint, typecheck and production build passed. The application compatibility edits remain local; no additional application deployment was performed during this repair.
