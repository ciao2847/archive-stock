## 1. Platform and Existing-Flow Review

- [x] 1.1 Read the installed Next.js routing/request documentation and current Supabase changelog plus Storage/RLS guidance, then record any version-specific constraints in implementation notes and verify every planned API is supported by the installed versions
- [x] 1.2 Trace the existing inventory membership, claim appearance, Turnstile, payment, customer settlement, and LINE lookup paths and verify the new implementation can reuse their canonical helpers without introducing a second configuration source

## 2. Database and Private Storage

- [x] 2.1 Add a Supabase migration for bundle orders, ordered images, one-to-one full payments, constraints, lifecycle fields, audit actors, and required indexes; verify the migration applies cleanly to a fresh/local database
- [x] 2.2 Add RLS and inventory-membership policies for all bundle tables plus a private `bundle-claim-screenshots` bucket and object policies; verify owner members can access their records while another inventory and anonymous table access are denied
- [x] 2.3 Add transactional database functions for opening, one-time customer confirmation, full-payment recording/reversal, receiving/outbound milestones, revocation, and draft deletion; verify SQL tests cover concurrency, invalid transitions, wrong totals, and cross-inventory calls
- [x] 2.4 Extend the inventory-scoped settlement/LINE query to union confirmed bundle claims without exposing account-holder names; verify same-phone fixtures in two inventories return only the configured inventory and exclude unavailable bundle orders
- [x] 2.5 Regenerate checked-in Supabase types and run database lint/security/performance advisors; verify there are no new actionable security findings or missing-index warnings for the new schema

## 3. Server Domain and APIs

- [x] 3.1 Add bundle-claim domain types, validation schemas, phone normalization, status derivation, and money formatting helpers; verify unit tests cover supported lifecycle and validation edge cases
- [x] 3.2 Implement authenticated inventory-scoped list, detail, create/update draft, open, revoke, payment, receiving, outbound, and draft-delete handlers; verify handler tests reject unauthenticated and cross-inventory requests
- [x] 3.3 Implement multi-image upload/removal for drafts with JPEG/PNG/WebP, 10-image, and 8-MB limits plus private signed-image delivery; verify invalid files and unrelated paths are rejected and confirmed evidence cannot be changed
- [x] 3.4 Implement the public token read endpoint and Turnstile-protected atomic confirmation endpoint; verify malformed/unavailable tokens return a common safe response and concurrent confirmation creates exactly one customer record

## 4. Admin Workspace

- [x] 4.1 Add the dashboard navigation entry and inventory-reset behavior for `單張大禮包喊單系統`; verify switching accounts or inventories clears stale bundle data before loading the next authorized result set
- [x] 4.2 Build the responsive create-draft flow with screenshot previews/reordering, fixed total, description, optional customer hint/expiry, validation, review, and open-link generation; verify a valid order yields a copyable `/bundle/<token>` URL
- [x] 4.3 Build searchable/filterable order listing and detail views with customer, confirmation, amount, payment, link, receiving, and outbound statuses; verify confirmed-unpaid and operational filters return the expected fixtures
- [x] 4.4 Add preview, copy link, revoke, full-payment/reversal, receiving/reversal, outbound/reversal, and draft-delete controls with transition-aware confirmation states; verify impossible actions are disabled in the UI and still rejected by the server
- [x] 4.5 Reuse the project design system and add a link to existing claim appearance/settings rather than duplicating controls; verify desktop, tablet two-column, and 375-pixel mobile layouts have no horizontal overflow or clipped actions

## 5. Customer Confirmation Experience

- [x] 5.1 Add `/bundle/[token]` using the installed Next.js route conventions and render the inventory banner, theme, private screenshot gallery, description, and non-editable gold fixed total; verify unavailable links reveal no order metadata
- [x] 5.2 Add nickname, 09-prefixed 10-digit phone, optional note, consent, Turnstile, and submission feedback while exposing no amount or quantity controls; verify keyboard and mobile touch interaction completes successfully at 375 pixels
- [x] 5.3 Build the confirmed result layout with confirmation number, agreed order summary, gold total, inventory completion message, official LINE action, and enabled transfer details excluding account-holder name; verify reopening the link shows the same result without another submission

## 6. Settlement and LINE Integration

- [x] 6.1 Include confirmed bundle claims in the admin customer settlement view with a source label and full-payment-only action; verify totals update correctly when payment is recorded or reversed
- [x] 6.2 Include confirmed unpaid bundle claims in LINE phone-based checkout/detail responses and reuse current inventory transfer settings; verify `我要結帳`, `查詢明細`, and `匯款帳號` flows prompt for phone and return bundle details without cross-inventory data or account-holder name

## 7. Verification and Release

- [x] 7.1 Add end-to-end coverage for create/upload/open/confirm/pay/receive/outbound/reopen/revoke flows plus mobile and cross-tenant regressions; verify the targeted test suite passes consistently
- [x] 7.2 Run formatting, lint, type checking, production build, and the existing claim/LINE regression suites; verify all commands pass without introducing warnings treated as release blockers
- [x] 7.3 Apply the reviewed Supabase migration, deploy to Vercel Production, and perform production smoke tests for authenticated admin, private images, Turnstile confirmation, completion settings, LINE lookup, and 375-pixel responsiveness; verify `archive-stock.vercel.app` serves the released workflow end to end
