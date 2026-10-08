## Campaign release verification — 2026-10-06

- The latest user-supplied plan supersedes per-image pricing: staff now enter a title and direct total, then attach screenshots. Stored older product metadata is retained but hidden in the new UI. Draft image removal and opening preserve the direct stored total.
- Applied migration `20261006064734_add_bundle_campaign_management.sql` after a rolled-back rehearsal. A digest comparison inside the application transaction verified existing order totals, status, tokens, confirmation data and warehouse milestones were unchanged. Legacy tokens/enablement were copied to default campaigns and all existing orders were associated with their inventory's default campaign.
- Campaign mutations use authenticated invoker RPCs with private authorization, not service-role writes in the admin API. Campaign-aware draft RPCs use distinct names, and the composite owner/campaign foreign key prevents cross-inventory associations. Confirmation locks the campaign before the order and requires an exact campaign match; public reads do not bypass paused campaigns via legacy fallback.
- Post-migration SQL verification: 25 campaign, 15 product/compatibility, 12 shared menu and 30 original pgTAP checks passed; every verification fixture was rolled back. The previous product verification script was updated to the new direct-total contract.
- Regenerated remote schema types. Security advisors report no bundle findings; performance has informational unused audit indexes, including the new campaign created-by index. Live PostgREST count relationship was verified for campaign allocation counts.
- 15 Node tests passed. Browser integration passed for public 375/768/1440 and admin 375/1440, including campaign create/switch/edit/toggle/links, direct totals, upload, publishing without per-image prices, failed-save retry and allocation-count refresh. Public receipt, repeat disabling, stale conflict, consent, gold and no-overflow checks passed. These use mocked API/browser storage/Turnstile, not real Cloudflare or LINE end-to-end coverage.
- TypeScript, lint, production build, scoped formatting and strict OpenSpec validation passed. Visual review used the generated mobile and desktop screenshots. Real operator acceptance remains: create a genuine activity and allocation, enable both, submit through real Turnstile and check downstream LINE/payment/receiving/outbound in the operating inventory. True concurrent browser sessions were not exercised by the sequential SQL checks.

- Released to Vercel Production: `dpl_3s8Ck8DeKS6JS4D7FjEqjeJsoZ2y`, aliased to `https://archive-stock.vercel.app`. Login smoke returned 200; anonymous campaign read/create returned 401; unknown public activity returned 404. Migration history confirmed, zero unassigned orders and zero remaining verification orders. Tests did not enable operational activities or create permanent customer records.

## Reference layout refinement (2026-10-06)

Matched the supplied three references with compact name options, selected checkmark, disabled strike-through names, square screenshot previews, a primary-colored total footer with gold amount, and a compact adjacent contact form. Inventory colors remain configurable; pricing stays one direct bundle title and fixed total. No database changes.

Typecheck, ESLint, 15 unit tests and production build passed. Browser integration passed at public widths 375/768/1440px and admin widths 375/1440px; inspected public mobile/desktop screenshots. Browser verification uses mocked API and Turnstile.

Deployed reference layout to production `dpl_yZjcVzhnDYBWkyRsvUyZTNZkxMCg` (READY), alias https://archive-stock.vercel.app. Live smoke checks: login 200, unauthenticated campaign endpoint 401, unknown public campaign 404.

## Latest user refinement: item captions and summed totals (2026-10-06)

Restored per-image name/price inputs and cent-based live totals. Saving uses the existing authenticated set-products RPC after upload. Uploaded image IDs and product fields survive a later metadata-save failure, so retry does not upload duplicates. Public cards show each name and gold amount below its image, with nickname/item count/gold total in the primary-color footer. Admin previews also show saved names/prices. Historical unpriced published orders keep their original fixed total and use an included-in-total caption; no names or prices are invented.

Applied `20261006090000_restore_bundle_itemized_totals.sql` after rollback preview. The migration restores locked open/delete recalculation for complete itemized drafts and rejects incomplete itemized publication, retaining all-null legacy compatibility. In the apply transaction 16 product, 25 campaign and 12 common-menu checks passed; before/after hashes confirmed existing orders and image metadata unchanged. Migration history is recorded. Live audit found no mismatched itemized totals and one legacy unpriced published allocation. Management API security advisor found zero bundle findings; the CLI advisor stalled at login initialization and was stopped after the API check completed.

Typecheck, lint, 15 unit tests, build and browser flows passed. Browser public fixture verifies 天空之城 $499、龍貓 $450、神隱少女 $450 and `james（共 3 件）` / $1,399 at 375/768/1440px. Admin 375/1440px checks include decimal sums, read-only total, save retry, uploaded metadata save failure, no duplicate upload and publication gating. Screenshot previews use mocked images/API/Turnstile.

Original 30-test pgTAP lifecycle/RLS/settlement/LINE lookup regression also passed (83 total SQL checks including product/campaign/menu). Released final itemized UI to `dpl_3CyGhc2i7uxsqKun8jWksa9METjq` (READY), alias https://archive-stock.vercel.app. Smoke checks: login 200, unauthenticated campaigns 401, unknown public campaign 404. Pending file keys are released on editor resets, successful saves and pending image removal.

## Simplified allocation form (2026-10-06)

Removed the separate item/title input. Saving a draft now uses its selected campaign title. Customer group nickname is required by HTML and the shared draft schema used in POST/PUT, rejecting missing or whitespace-only names. Total displays 0 initially and updates from per-image amounts in integer cents, is read-only, and includes explanatory text. No database schema changes. Sixteen unit tests passed; typecheck, lint, build and public/admin responsive browser checks passed, including stored campaign titles and required nickname with decimal totals.

Released simplified form to production `dpl_GnxdWnyHXuv7fU62fHr5eG4NQPh4` (READY), alias https://archive-stock.vercel.app. Live login 200 and unauthenticated bundle management 401 smoke checks passed.

## Desktop-friendly LINE receipt contact (2026-10-06)

Retained the existing mobile official-account launch link and added a locally rendered QR Code encoding exactly the same URL (official ID, activity title and confirmation code). Added a copy-confirmation-message button with success feedback and the existing prompt-based manual-copy fallback when clipboard access fails. Instructions explain using phone LINE to scan or pasting into an already-added official-account desktop conversation and pressing Send. All alternatives render when a valid official destination exists; no browser/device detection is required. No QR service or external QR request is used.

Typecheck, lint, 16 unit tests and production build passed. Public receipt/browser checks at 375/768/1440px verify the exact encoded LINE href, QR SVG rendering, exact copied message, clipboard denial fallback and no overflow. Existing public selection/confirmation and admin flows at 375/1440px passed. Mobile/desktop receipt screenshots inspected. Browser API, clipboard and Turnstile are mocked; real LINE application scanning/sending remains a device acceptance check.

Released LINE contact alternatives to production `dpl_5ffCN8hGvgrnWsFDoEXRvzSP3itv` (READY), alias https://archive-stock.vercel.app. Live login 200 and unauthenticated bundle management 401 smoke checks passed.

## Standalone completion page (2026-10-07)

Shared-menu confirmation now returns the independent PublicBundleClaimView receipt before rendering the campaign banner or selection section. Removed the return-to-menu branch/control. Completion retains receipt/order/payment/LINE QR-copy content, with 480px max width and matching regular claim form card spacing. Selection/confirmation flows before submission are unchanged. Typecheck, lint, production build and browser public 375/768/1440px plus admin 375/1440px checks passed. Receipt tests explicitly reject campaign intro, nickname heading/group and return-to-menu control; mobile receipt screenshot inspected.

Released standalone completion page to production `dpl_2fczQ8Wx86kPKHzDNvfw81s6PMtU` (READY), alias https://archive-stock.vercel.app. Live login 200 and unauthenticated bundle management 401 smoke checks passed; mobile and desktop receipt screenshots inspected.


## Unified naming and same-page ordering (2026-10-07)

Admin navigation and presentation now use 配單管理 and 訂購管理. Public pages use 配單確認 and 預購／現貨訂購; submitted receipts use the corresponding confirmation/success wording. Existing routes, stored activity titles and order identifiers are preserved. Shared completion settings describe both flows.

Regular ordering now renders products, selected-item review, live total and contacts on one responsive page. Desktop places contacts beside products; mobile/tablet stack them, with a mobile total/contact-scroll bar. Quantity limits, paused products, closed forms, phone validation, consent and Turnstile remain enforced. Failed submissions preserve quantities, contacts, notes and the request ID while resetting verification. Both flows have three-stage progress labels and independent success receipts.

Typecheck, ESLint, unit tests and production build passed. Browser checks passed at 375/768/1440px for regular ordering and bundle confirmation, and 375/1440px for bundle management. New assertions verify same-page contacts before selection, quantity clamps, live totals, invalid phone rejection, retained failed-submit data and identical retry request ID/payload, disabled closed forms and independent receipts. Desktop/mobile screenshots inspected; API and Turnstile are mocked in browser tests.

Released unified ordering UI to production `dpl_DmvD39Nf9VYBRfPTaFgANwwWMPBV` (READY), alias https://archive-stock.vercel.app. Live smoke checks passed: login 200, unauthenticated bundle management 401, unknown public campaign API 404. The unknown campaign page streams its unavailable state with HTTP 200. Real customer submissions and LINE sending were not performed. OpenSpec strict validation passed.


## Shared admin composition and simplified details (2026-10-07)

Extracted CustomerList, OrderContactDetails, OrderItems, PaymentSection, PaymentHistory and controlled PaymentRecordEditor under components/order-management. These accept presentation data, children and callbacks without importing source APIs or branching on claim/bundle sources. Existing containers retain source adaptation, amount rules, request handling and fulfillment actions.

Ordering defaults to compact customer selection beside one selected item/payment detail. Procurement totals and CSV remain in a separate tab. Source+ID selection and scope-specific editor keys prevent overlapping claim/bundle IDs or activity/page changes from exposing another record’s editor. Payment entry is now available directly, retaining partial payments and legacy quick statuses when no recorded payments exist. Actual partial remittances display 部分付款. Customer settlement reuses the controlled editor.

Bundle management uses the same customer/item/contact/payment components, fixed full-payment amount editor with date/last-five/note, expandable metadata and payment history, and one receiving/outbound section. Cancelled/expired records are collapsed in the all filter. Existing draft editing, uploads, publication and actions are preserved. Receiving/outbound remain checks rather than inventory mutations. Empty action footers are omitted.

Typecheck, ESLint, 16 unit tests, production build, OpenSpec strict validation and diff whitespace checks passed. Browser integration passed at 375/768/1440px for ordering management, settlement and public forms; bundle admin passed at 375/1440px. Added coverage for overlapping source IDs, partial payment/overpayment rejection, failed-save retention and retry payload, full-only allocation entry, quick-status gating, pagination/activity reconciliation, deletion, procurement CSV callback, collapsed cancelled records, full-payment reversal and receiving/outbound prerequisites/reversal. Mobile/desktop ordering and bundle screenshots inspected. Tests use mock APIs and callbacks; no live customer or financial records were changed.

Released shared admin components to production `dpl_Bxu8DKeF16pLQjWX2FmVV7KwiYHj` (READY), alias https://archive-stock.vercel.app. Live smoke checks passed: login 200, anonymous allocation/ordering management 401, unknown public allocation-menu API 404. All 39 tasks complete.


## Trash actions and guarded removal (2026-10-07)

Added a shared RemoveRecordButton to allocation management, ordering detail and customer settlement. Confirmation displays customer, activity, confirmation number, total and irreversible deletion warning. Cancellation sends no request; in-flight removal is disabled; failures retain the selected record. Successful removal refreshes the list/selection and allocation activity counts. Allocation-source deletion now dispatches to its own API from settlement/ordering containers instead of rejecting all confirmed allocations.

Added `20261007011431_safe_bundle_order_removal.sql` with authenticated public invoker/private definer RPCs, existing inventory-access assertion, parent-row locking, payment and receiving/outbound guards, optional expected updated timestamp and atomic return of image object paths. The existing draft-only RPC remains unchanged. The API cleans storage only after successful database deletion and handles protected/stale/missing records explicitly. Authenticated aggregate allocation DTOs include updated/check timestamps for source-safe removal guards and timestamp forwarding. Existing remittance restrictions remain on regular orders.

Migration preview passed 14 rolled-back SQL checks, then the apply transaction repeated those checks and verified before/after hashes of existing orders, image metadata and payments unchanged. Migration history recorded. Combined SQL regression passed 97 checks (16 product, 25 campaign, 12 menu, 14 removal, 30 lifecycle/RLS/settlement/LINE). Security advisor returned zero findings for the new delete functions. No actual customer or financial records were deleted.

Browser checks passed at 375/768/1440px for ordering management/settlement/public flows and 375/1440px for allocation management. Added assertions for confirmation content, cancel/no request, failed-delete retention/retry, source dispatch with colliding IDs, paid/check button guards, confirmed/cancelled removal and refreshed selection/counts. API callbacks and browser records are mocked. Typecheck, ESLint, 16 unit tests, production build, strict OpenSpec and diff checks passed.

Released trash/removal actions to production `dpl_8X8GDoXM9haY25rfVUxDCNuBCvwb` (READY), alias https://archive-stock.vercel.app. Live login 200, anonymous allocation/ordering DELETE requests 401, unknown allocation menu API 404. Migration history and RPC execution grants confirmed. All 42 tasks complete.

## Availability switches (2026-10-07)
Shared accessible themed switches for ordering reception and public allocation menus. Confirm closing only; no optimistic ordering state update. Verified cancellation/no request, immediate reopening, campaign failed-save retained state, mobile/tablet/desktop browser regression, 16 unit tests, typecheck, lint, build and strict specs. Production dpl_5BqdAM1a9f9zVEcyCjwS4EZ8jNau READY at https://archive-stock.vercel.app; login 200 and anonymous management APIs 401.

## Ordering search repair (2026-10-07)
Removed full-mobile-only input restriction; customerSearch supports nickname/partial normalized phone/confirmation code with literal quoted filters, inventory form restriction and server pagination. Legacy customerPhone remains supported. Actual ClaimFormPanel browser checks at 375/1440px verify Enter/button, trimming, retained failure/retry, clear and no matches. 17 unit tests and full responsive/browser regression, typecheck, lint/build/strict specs pass. Read-only production database checks confirm matching and empty foreign inventory. Production dpl_EDMZDGGekT8UKbsj6cQcoxyR37S3 READY; login 200 and anonymous search API 401.

## Reference admin layout (2026-10-07)
Refined campaign/header cards, status next to customer name, customer cards and integrated bordered item/primary total cards, retaining project colors. Ordering selector/action grid prevents IP create/remove overflow. Long title and create/cancel/remove confirmation tests at 375/768/1024/1440px passed, along with full browser regression, 17 unit tests, typecheck, lint/build and strict specs. Inspected ordering desktop/header mobile and allocation mobile screenshots. Production dpl_G82kFTKY7ri1FMCTi5sTQMAGxYGq READY at https://archive-stock.vercel.app; login 200 and anonymous management APIs 401.

## Inline automatic ordering search (2026-10-07)
Moved ordering search out of the dashboard portal into the customer-list area after its view tabs, matching allocation search placement. Input debounces 300ms with immediate Enter/button/clear; cancel superseded requests and guard load sequence, keep input available in flight, clean up on tab/activity/unmount. Actual ClaimFormPanel browser tests at 375/768/1024/1440px verify inline location, automatic text search, immediate search, failed retry, empty/clear and delayed stale response protection. Live read-only PostgREST checks verify actual nickname, phone fragment, code and quoted punctuation matching under form scope without changing records. Full browser regression, 17 unit tests, typecheck/lint/build and strict specs pass. Production dpl_JAcEhFDqV3u8bJKn2M3mVpS5YGJa READY at https://archive-stock.vercel.app; login 200 and anonymous search 401.

## Duplicate search clear button fix (2026-10-07)
Scoped ordering search input class hides the native WebKit search cancel button, preserving the existing accessible clear action. Build, lint and browser flows passed; visually verified only one clear icon. Production dpl_sdkLpfDmvjEpKs43uA1j5ayLrREr READY; login 200.
