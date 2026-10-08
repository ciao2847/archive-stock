## Platform constraints reviewed before implementation

- Next.js `16.3.2` uses asynchronous dynamic route `params`; pages and route handlers must await them.
- Route handlers use Web `Request` / `Response`, are uncached by default, and every mutation endpoint must repeat authentication and resource authorization.
- Server-only data access returns minimal DTOs; Supabase secret keys stay in `server-only` modules and are never sent to Client Components.
- Supabase's current Data API guidance separates grants from RLS. New public-schema tables explicitly revoke anonymous access, grant only required authenticated operations, and enable RLS in the same migration.
- The April 2026 Supabase breaking change makes new Data API exposure opt-in; the migration therefore includes explicit grants instead of relying on legacy defaults.
- Private Storage objects are served with short-lived signed URLs. The screenshot bucket remains non-public and enforces MIME type and byte limits at both bucket and server-validation layers.
- Security-definer helpers use an empty `search_path`, schema-qualified references, explicit caller checks, and restricted execution grants. Public customer confirmation remains service-role-only after Turnstile verification.
- Fixed monetary values use `numeric(12,2)`, times use `timestamptz`, primary keys use identity `bigint`, and every foreign-key/filter path receives a matching index.
- One-time confirmation uses a short row lock inside a database function; Turnstile network verification happens before the transaction so no lock is held during external I/O.

## Existing flows reused

- Inventory authorization: `requireApiUser`, `profiles.inventory_owner_id`, `private.current_inventory_owner_id()`, and `public.my_role()`.
- Shared appearance: `inventory_databases.claim_banner_*` and `claim_theme_*` fields plus `claim-form-assets` public banner URLs.
- Shared checkout settings: `official_line_id`, `claim_completion_message`, and `claim_transfer_*` fields. Customer DTOs deliberately omit `claim_bank_account_name`.
- Anti-abuse: the existing Cloudflare Turnstile server verification and widget action.
- Customer settlement: the existing claim customer grouping UI receives bundle claims as a distinct source with one fixed-total line item; bundle payment actions remain full-payment-only.
- LINE: `query_customer_claims_summary(phone, inventory)` remains server-only and inventory-scoped, with bundle claims unioned into the existing response.

## Current documentation consulted

- Bundled Next.js docs: layouts/pages, Server and Client Components, Route Handlers, Data Security, and the Next.js 16 upgrade guide.
- Supabase changelog (reviewed 2026-10-05), Storage access control/private downloads, API security, and Row Level Security documentation.


## Shared menu verification — 2026-10-06

- Added inventory menu UUID + disabled-by-default setting and service-only `confirm_bundle_menu_order`. Applied migration `20261006003221` through the Management API and recorded it in migration history. A transaction containing the migration and 12 SQL checks passed before applying; afterward the same 12 checks and existing 30 pgTAP checks passed. All test fixtures were rolled back; zero test orders remain and no inventory menu was enabled automatically.
- Regenerated public schema types from the remote project. `plpgsql_check` found no errors in the new function; the extension was enabled only within a rolled-back diagnostic transaction. Security advisors report no bundle findings; performance reports only informational unused preexisting bundle indexes. This does not claim unrelated project-wide findings are resolved.
- Node tests: 13 passing, including publication lifecycle, DTO privacy, preassigned labels, allocation validation and stripping client price overrides.
- `npm run test:bundle-ui` uses the actual React components, production-built CSS, synthetic data, mocked menu API and a mocked Turnstile widget. Chrome checks at 375/768/1440 pixels cover selection before contact entry, disabled confirmed options, prefill and form reset, consent gating, gold computed color, submission payload, receipt, stale-confirmation refresh and no horizontal overflow. Header content bounds are checked to avoid the global app-header height clipping the menu introduction. This is UI integration coverage, not a real Cloudflare or LINE end-to-end test.
- Lint, TypeScript and production build passed. Formatting checks for changed supported files passed; the two previously reported unrelated formatting issues are outside this change.
- Existing per-order links, full payments, settlement and warehouse operations remain compatible. Shared-menu reads never include submitted contacts, notes, confirmation codes, payments, original filenames or per-order tokens.
- Live operator acceptance remains: log in, open each allocation, enable the shared menu, use an incognito browser to complete a real Turnstile submission, and verify payment/receiving/outbound and LINE in the operational inventory. True simultaneous multi-session confirmation was not exercised by the sequential SQL checks; the new RPC's row lock and original-request check enforce that behavior.

- Released to Vercel Production: `dpl_6egxdNixkY69fmgjew7KFMx4i9Wq`, aliased to `https://archive-stock.vercel.app`. Live smoke: login 200; unknown valid menu UUID returns safe 404; public menu page renders unavailable state without authentication redirect; admin menu API rejects anonymous access with 401; cross-site public POST rejects with 403. Menus remain disabled until staff explicitly publish them.
- New standalone SQL verification lives at `supabase/scripts/verify-bundle-menu.sql` (single DO block, 12 checks, automatic fixture rollback). It is separate from the pgTAP suite. Browser checks run with `npm run test:bundle-ui` after building; use installed Chromium (`npx playwright install chromium`) or an existing macOS Chrome, with an optional `POSTER_CHROME_PATH` override.

## Direct name selection — 2026-10-06

- Replaced the public dropdown with visible name buttons, selected-state highlighting and disabled confirmed names. All allocation previews remain accessible in expandable details. The admin creation button now reads `新增姓名選項`.
- Browser checks passed at 375/768/1440 pixels, including direct name selection, switching names, contact prefill/reset, selected button colors, confirmation and stale availability. These use mocked API and Turnstile responses, as described above. TypeScript, lint, production build and strict OpenSpec validation passed.
- Released to Vercel Production: `dpl_DTzPmurhaE4G7AWPPa8md29ha8tg`, aliased to `https://archive-stock.vercel.app`. Post-deployment smoke confirmed login 200 and an unknown valid menu UUID returning 404. No menu was automatically enabled.

## Shared link admin clarification — 2026-10-06

- Removed individual URL, copy and preview actions from allocation details. Staff share via the inventory common-link control. Clarified item/amount description and withdrawal labels. Existing submitted records and legacy route compatibility are retained.
- TypeScript, scoped ESLint, production build, diff checks and strict OpenSpec validation passed. Deployed `dpl_2dp81L43rmgrA2t7MkrfrSewRieb` to `https://archive-stock.vercel.app`; live login smoke returned 200. Authenticated admin visual checks were not automated for this label/action cleanup.

## Product cards and itemized total — 2026-10-06

- Applied additive migration `20261006020637`: nullable per-image product name/amount for legacy compatibility, private authorized draft-only product mutation with public invoker wrapper, exact unique image set validation and numeric sum. Opening itemized bundles rechecks completeness and recomputes the total under the order lock. Deleting a draft image updates the remaining complete product sum. Existing published bundle totals were not reinterpreted as per-product prices.
- The admin editor requires per-image name/amount and shows a read-only computed total. Public cards show each name and gold amount beneath its image. The reference layout uses the existing project theme, numbered steps, visible name options and product/form columns at desktop sizes. Old unitemized records explicitly indicate that the bundle total applies.
- 15 new product SQL checks passed with fixture rollback, covering authorization, decimal sum, names, duplicates, missing/foreign ids, fractional cents, negative prices, incomplete publication, image deletion, open-time total correction and published immutability. The existing 12 menu checks and 30 pgTAP checks passed. No real user orders were created by verification.
- 14 Node tests passed. Browser integration at 375/768/1440 pixels verifies product captions, amounts and the existing confirmation flow; admin checks at 375/1440 verify editing, exact decimal sum, failed-save retry and new image upload metadata. API, browser storage and Turnstile are mocked in these browser checks. Screenshots were visually reviewed on mobile and desktop. TypeScript, lint, production build and strict OpenSpec validation passed.

- Product migration history and both columns confirmed; zero product SQL test orders remain. Security advisors report no bundle findings; performance findings are existing informational unused indexes. Production release `dpl_CtFFbosd8VsT8EhAyMwYVEYsdtaF` is aliased to `https://archive-stock.vercel.app`. Live smoke: login 200, unknown menu UUID 404, unauthenticated product mutation 401. Actual operator submission with real Turnstile and LINE remains a live acceptance check.
