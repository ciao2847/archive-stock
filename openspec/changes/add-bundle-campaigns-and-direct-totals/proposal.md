## Why

Currently, single-poster bundle orders (大禮包喊單) are all lumped into a single global shared menu per inventory (`/bundles/[token]`), preventing sellers from organizing sales by distinct events or batches (e.g., "10月海報第一彈", "一番賞配單特輯"). Furthermore, the previous itemized model forced staff to enter an item name and amount for every screenshot and calculated the total automatically. For sellers who already calculated a bundle's fixed total during discussion threads, entering itemized sub-amounts creates unnecessary overhead.

By introducing independent bundle campaigns (大禮包活動) with dedicated shared links and direct total pricing (商品截圖下直接顯示品項與總額，不再需要逐張填寫單價明細), sellers can manage multiple events cleanly—similar to the regular claim form system—while buyers can review screenshots, item names, and total amounts directly.

## What Changes

- **Multiple Bundle Campaigns (活動管理)**:
  - Add campaign management for bundle claims (create, edit, enable/disable).
  - Each campaign has its own title, description, and unguessable public shared link (`/bundles/[campaign_token]`).
  - Inventory visual appearance (banner, theme colors) and transfer bank account information remain shared inventory-wide.
  - The admin workspace (`單張大禮包喊單系統`) allows switching between campaigns and creating new campaigns via a selector, matching the `ClaimFormPanel` experience.

- **Direct Total and Item Pricing (截圖 + 品項與直接總額)**:
  - Remove mandatory per-image price breakdown and sum calculations.
  - Staff enter the overall item name / title, description, and direct total amount for each bundle allocation.
  - In public menu and confirmation screens, display product screenshots followed directly by the item name and total amount in gold text, eliminating per-image subtotal noise.

- **Downstream Operations & Compatibility**:
  - Existing bundle allocations are automatically associated with a default campaign so that no data or active links break.
  - Single order links (`/bundle/[order_token]`) continue to function.
  - Customer settlement views and LINE phone-based lookup remain inventory-scoped.

## Capabilities

### New Capabilities

- `claims/bundle-campaigns`: Create, configure, and publish independent bundle claim campaigns with dedicated public shared links and direct bundle pricing without itemized breakdowns.

### Modified Capabilities

None.

## Impact

- Database schema: adds `bundle_claim_campaigns` table and links `bundle_claim_orders.campaign_id` via migration; updates shared menu RPCs.
- Server APIs: adds campaign CRUD endpoints (`/api/bundle-campaigns`), updates public menu resolution by campaign token.
- Admin UI: updates `BundleClaimPanel` with campaign selector, creation dialog, and campaign-level public link controls; simplifies order editor to direct total entry.
- Public UI: updates `PublicBundleMenuView` and `PublicBundleClaimView` to render campaign title/description and display screenshots directly paired with item name and total amount.

## Latest user refinement (2026-10-06)

The latest explicit requirement replaces direct total editing with per-image product name/price fields and automatic summation. Each public image has a name and gold amount below it; the footer shows nickname, item count and summed amount using the project's existing primary color. Existing published totals are preserved, with fallback content for missing historical metadata.

## Unified purchase experience refinement (2026-10-07)

Rename the fixed-allocation workflow to 配單確認／配單管理 and the selectable-product workflow to 預購／現貨訂購／訂購管理. Both customer pages combine item/amount review and contact details on one page, with independent completion pages. Preserve configured inventory appearance and existing data/API identifiers.

## Shared admin components refinement
Unify ordering and allocation management around customer list, item detail and payment actions. Extract presentation-only components and a controlled payment editor, keeping source-specific API calls, validation, deletion and fulfillment rules in their existing containers. Keep procurement totals in a separate ordering tab.

## Safe removal refinement
Expose a visible trash/remove action for both allocation and ordering records, including confirmed allocations, with customer/code/amount confirmation. Preserve remittances and allocation fulfillment checks by requiring reversal before removal. Existing draft-only RPC remains compatible.

## Availability switch refinement
Replace ordering reception and allocation menu action buttons with themed switches showing explicit status. Closing confirms once; opening is immediate. Save before updating the visible state and disable during requests.

## Ordering search fix
Ordering header search accepts customer nickname, partial phone and confirmation number; remove mobile-only validation.

## Reference admin layout refinement
Match supplied management references with compact header, campaign card, customer cards and bordered item/payment detail cards, retaining project colors. Fix IP create/delete control overflow.

## Inline automatic ordering search
Place ordering search above the customer list like allocation management; automatically search after typing, retain Enter/button and cancel outdated requests.
