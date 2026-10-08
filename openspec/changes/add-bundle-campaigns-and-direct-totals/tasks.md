## 1. Database Migration and Functions

- [x] 1.1 Create Supabase migration `20261006064734` adding `bundle_claim_campaigns` table, `campaign_id` foreign key on `bundle_claim_orders`, and data backfill mapping existing `bundle_menu_token` to a default campaign; verify migration applies cleanly
- [x] 1.2 Add RLS policies and inventory-membership authorization helpers for `bundle_claim_campaigns`, ensuring cross-inventory access is rejected; verify with SQL checks
- [x] 1.3 Update database functions using distinct campaign-aware draft RPC names: relax `open_bundle_claim_order` to accept direct `total_amount > 0` without requiring per-image prices, and update `confirm_bundle_menu_order` to validate campaign ownership and enablement; verify with test queries

## 2. Server APIs and Domain Models

- [x] 2.1 Update domain types, schemas, and helpers in `src/lib/bundle-claims.ts` to include `BundleClaimCampaign`, optional `campaignId`, and direct bundle total validation; verify type checks pass
- [x] 2.2 Implement `/api/bundle-campaigns` route for campaign listing, creation, and updating (toggle enabled, edit title/description); verify endpoint authorization
- [x] 2.3 Update `/api/bundle-claims` draft handlers to link orders to campaigns and accept direct totals without mandatory product array; verify unit tests pass
- [x] 2.4 Update `/api/public/bundle-menus/[token]` to resolve campaign by token, return campaign title and description, and filter allocations by `campaign_id`; verify public DTO privacy

## 3. Admin Workspace

- [x] 3.1 Update `BundleClaimPanel` header with a campaign selector dropdown and a "＋建立新大禮包活動" modal dialog, matching `ClaimFormPanel` design
- [x] 3.2 Display active campaign details, enabled toggle, and dedicated "複製活動選單連結" button in the admin panel
- [x] 3.3 Simplify bundle creation/editing form to directly enter item name (`title`), description, and `total_amount`, removing mandatory per-image price inputs
- [x] 3.4 Support filtering bundle orders by selected campaign or showing all campaigns within the inventory

## 4. Public Customer Experience

- [x] 4.1 Update `PublicBundleMenuView` to display the active campaign title, description, and campaign-specific nickname options
- [x] 4.2 Update `PublicBundleClaimView` and `PublicBundleMenuView` layout to display screenshots directly followed by the item name and gold total amount, removing per-image subtotals and redundant breakdown blocks
- [x] 4.3 Ensure confirmation receipts and completion views continue to show confirmation codes and shared inventory transfer details

## 5. Verification and Delivery

- [x] 5.1 Run test suite covering campaign creation, direct total validation, public menu confirmation, and cross-inventory isolation
- [x] 5.2 Verify mobile (375px) and desktop layouts for both admin panel and public menu views
- [x] 5.3 Run type checking, linting, and production build to confirm zero regressions

- [x] 5.4 Apply the reviewed migration, regenerate schema types, run advisors, deploy to production and perform live route smoke checks.

## 6. Reference Layout Refinement

- [x] 6.1 Match supplied references with compact nickname buttons, unavailable strike-through labels, square screenshot grid, primary-color bottom total bar and compact contact form while retaining inventory theme and direct bundle total.
- [x] 6.2 Verify type checking, lint, unit tests, production build and browser flows at 375/768/1440px; visually inspect mobile and desktop screenshots.
- [x] 6.3 Deploy refined layout and smoke-check production routes.

## 7. Per-image Product Pricing Refinement

- [x] 7.1 Restore per-image name/amount editing, cent-based live totals and metadata save after upload with safe retry.
- [x] 7.2 Render captions beneath images and nickname/item-count/summed-total footer using inventory colors; retain legacy published totals and remove public overview entries.
- [x] 7.3 Apply locked open/remove itemized recalculation migration and verify 53 SQL checks with existing order/image data unchanged.
- [x] 7.4 Finish lint, typecheck, unit/build/browser verification, inspect responsive screenshots and deploy to production.

## 8. Simplified allocation form

- [x] 8.1 Remove separate title input, use selected campaign title, require customer option name in UI and API validation, and display the live product sum as read-only with helper text.
- [x] 8.2 Verify mandatory nickname, automatic campaign title, decimal sums and editor behavior through unit, type, lint, build and responsive browser checks.
- [x] 8.3 Deploy and smoke-check production.

## 9. Desktop LINE Contact Alternatives

- [x] 9.1 Retain the mobile LINE link and add locally generated QR Code and copy-confirmation-message action with manual-copy fallback.
- [x] 9.2 Verify receipt layout, encoded link/message, copy success/fallback and responsive flows; deploy and smoke-check production.

## 10. Standalone Completion Page

- [x] 10.1 Render the confirmed receipt independently of shared-menu header/selection controls and match regular claim receipt width/spacing.
- [x] 10.2 Verify responsive completion page and existing flows, then deploy and smoke-check production.

## 11. Shared Ordering Experience and Naming

- [x] 11.1 Rename customer/admin surfaces to 配單管理／配單確認 and 訂購管理／預購／現貨訂購 without changing existing routes, stored campaign names or order identifiers.
- [x] 11.2 Replace regular ordering product/details steps with one responsive page containing product selection, item/total review and contact fields; retain quantity limits, disabled products, closed forms, consent, Turnstile, retry and independent receipt. Align bundle progress labels and submission/success names.
- [x] 11.3 Verify mobile/tablet/desktop ordering and bundle flows, validation and failed-submit retry, then deploy and smoke-check.

## 12. Shared Admin Components

- [x] 12.1 Extract presentation-only customer list, contact/details, item list, payment section and controlled payment editor; no source API imports or source-mode switches.
- [x] 12.2 Compose ordering management as customer list → item detail → payment actions, with procurement on a separate tab; preserve quick statuses, reconciliation, pagination and deletion. Reuse payment editor in customer settlement.
- [x] 12.3 Simplify bundle management using the same components, compact customer rows, disclosed metadata and grouped fulfillment, preserving draft/editor and full-payment/receiving/outbound behavior.
- [x] 12.4 Verify selection, partial/full payment rules, API callbacks, fulfillment prerequisites, responsive layout and existing flows; run checks and deploy.

## 13. Safe Record Removal

- [x] 13.1 Add locked inventory-scoped allocation delete RPC with payment/check/stale guards and returned image cleanup paths; verify authorization and all states without changing existing records.
- [x] 13.2 Wire removal API and shared trash button in allocation, ordering and settlement, with informative confirmation, cancellation, busy guards and selection/count refresh.
- [x] 13.3 Verify database/browser regression, checks and production deploy/smoke.

## 14. Availability switches

- [x] 14.1 Share themed accessible availability switches, preserve state on failure and confirm only closing.
- [x] 14.2 Verify responsive toggle/cancellation/error behavior and existing flows; build and deploy.

## 15. Ordering search repair

- [x] 15.1 Accept text queries and implement inventory-scoped literal search before pagination.
- [x] 15.2 Verify header submit/clear/retry, query encoding, real database matching, checks and deployment.

## 16. Reference management layout

- [x] 16.1 Refine reference hierarchy/cards using project colors and fix responsive IP controls.
- [x] 16.2 Verify long titles, create/cancel/remove safeguards and responsive existing flows; deploy.

## 17. Inline automatic ordering search

- [x] 17.1 Move ordering search above the customer list and add debounced search, abort and stale-response guards.
- [x] 17.2 Verify automatic/Enter/button/clear/failure/rapid typing and responsive positions; deploy.
