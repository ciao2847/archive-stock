## Context

Add independent bundle activities to the existing inventory-scoped shared-menu system. The latest user decision is direct bundle pricing: staff enter one item/title and fixed total and attach product screenshots, without mandatory per-image names or amounts. Existing private storage, receipts, full-payment accounting and operational checks stay compatible.

## Goals

- Multiple activities per inventory with independent titles, descriptions, publication switches and `/bundles/[campaign_token]` links.
- Activity switching and creation in the existing admin workspace, including showing all activities.
- Direct title and positive two-decimal total entry, with screenshots followed by item information and gold total.
- Preserve existing menu tokens, orders, per-order links, payments and shared inventory theme/bank settings.

## Decisions

### Database and compatibility

`bundle_claim_campaigns` has identity id, inventory owner, title, description, unique UUID token, enabled flag and audit fields. New activities default to paused; publication is an explicit staff action. The migration creates a legacy activity for each existing inventory using its current token and enabled state, then associates all existing orders with that activity.

Orders use a composite `(campaign_id, owner_id)` foreign key, preventing cross-inventory association even through direct SQL. Activity deletion with associated orders is restricted. Activity deletion is outside the current UI/API scope. An insert trigger assigns older order-creation clients to the inventory's legacy activity, creating it lazily for future inventories. A compatibility trigger synchronizes old inventory menu enablement into the legacy activity.

Campaign tables have RLS and authenticated SELECT only. Authenticated mutations use a public invoker RPC delegating to a private definer function with explicit inventory authorization and an empty search path. New campaign-aware draft RPCs wrap the existing RPCs using distinct names, avoiding overloaded PostgREST functions. They lock the campaign before the order and validate its inventory owner.

### Publication and confirmation

Public reads resolve only an enabled campaign and query allocations with both matching campaign id and inventory id. No broad inventory fallback is allowed, because that could expose other activities or bypass a paused campaign. Existing tokens are preserved by migration instead.

Confirmation acquires a shared campaign lock followed by an order row lock, requires an exact campaign/owner match, and preserves original-request retry and duplicate rejection. Execution remains service-only after Turnstile verification. Pausing a campaign does not modify confirmed orders or financial/warehouse records.

### Direct fixed totals

Opening a draft still requires at least one screenshot and a valid stored total. It does not calculate per-image amounts. Removing a draft screenshot does not alter its manually entered total. Old product-name/amount columns and the older product mutation RPC remain compatible, but the new UI does not require or display per-image prices; legacy data is not deleted or reinterpreted.

### User interface

The activity control provides a dropdown, create/edit dialog, enabled switch and copy/preview links. Newly created activity data updates the parent immediately and is selected automatically. Changing activities closes an editor and clears stale allocations. Owner changes clear activity/editor state; aborted or stale reads cannot restore another activity's records.

The public page renders the activity title and description with shared inventory appearance. Buyers click a name, review screenshots and the item/title with one gold fixed total, then submit contacts, consent and Turnstile. Mobile stacks content; desktop places products beside the form.

## Verification and release

Apply the migration first in a rolled-back diagnostic transaction with campaign SQL checks. Verify RLS, cross-activity and cross-inventory boundaries, legacy token/record compatibility, pause behavior and idempotent confirmation. Then apply the reviewed migration, regenerate schema types, run original SQL regressions and security advisors, browser checks at 375/768/1440 pixels, lint, type checks, tests and production build. Release to Vercel and perform route smoke checks. Real Turnstile and LINE operator acceptance remains distinct from mocked browser integration.

### Reference layout refinement

Use compact nickname buttons with a check on the selected allocation and strike-through unavailable labels. Render square screenshot previews, the bundle title and description, and a primary-colored footer containing the customer label and gold fixed total. Keep direct bundle pricing rather than adding per-image prices from the visual mock. Desktop uses a wide product card beside a compact contact form; mobile stacks both. Retain inventory-configured colors, confirmation behavior and real Turnstile.

## Latest pricing decision: itemized display (2026-10-06)

The user's latest explicit request supersedes the earlier direct-total UI: show each product name and amount below its image, with nickname, item count and summed gold total in a primary-colored footer. Reuse existing product columns and set-products RPC. The editor computes totals in integer cents and requires complete per-image metadata; successful uploads retain their image IDs and field values if later metadata saving fails. Restore locked open/remove functions to recompute complete itemized draft totals, preserving all-null legacy integrations and existing published order data. No public overview entry is shown.

## Unified ordering page and naming (2026-10-07)

Use 配單管理 in the admin workspace and 配單確認 on the public fixed allocation flow; use 訂購管理 in admin and 預購／現貨訂購 on public self-selection pages. Product choice/assigned-name selection stays specific to each flow. Both pages present products and gold total on the left and contact/consent/Turnstile on the right on desktop, stacking on mobile. Regular orders no longer navigate to a separate contact step. A mobile summary can scroll to the in-page contact form. Product quantities remain bounded, paused products unavailable and closed forms non-submittable. Failed submit keeps selection/contact fields and refreshes verification. Successful submit renders a standalone completion page. Existing routes, server payload contracts and historical order/activity titles remain compatible.

## Shared admin composition
Use small presentation components accepting scalar display data, item arrays, children and callbacks; they must not import claim/bundle APIs or inspect source enums. Customer selection keys include source and ID. Containers own selection reconciliation, async actions, full-only versus partial payment validation and optional fulfillment. The shared controlled payment editor accepts amount presets/read-only amount configuration and submit/cancel callbacks; both source containers retain their validation. Procurement stays an ordering-only tab. Bundle receiving/outbound checks remain optional and do not mutate actual stock. Hide metadata behind disclosure; group bundle fulfillment in one section.

## Safe record removal
Add an inventory-authorized, locked allocation-delete RPC alongside the legacy draft-only RPC. Reject deletion with payments or receiving/outbound checks; cascade screenshot metadata and return storage paths atomically for post-commit object cleanup. Accept expected updated timestamp for stale-record rejection. Reuse a presentation-only trash button in management and settlement. Containers own confirmation, guards and callbacks; decline sends no request, errors retain selection, successful deletion reconciles the list and campaign counts.

## Availability controls
Use a controlled presentation-only AvailabilitySwitch with accessible switch semantics, status text and helper text. Containers own confirmation and existing API calls. Ordering must not update isOpen before save succeeds; campaign state is replaced only on successful response. Paused ordering rejects new submissions; paused campaign menus cannot be viewed or submitted. Existing records remain.

## Ordering customer search
Keep legacy exact customerPhone API compatibility. New customerSearch uses quoted, wildcard-escaped literal ILIKE across nickname, normalized phone and confirmation code. Restrict query to inventory-owned form IDs before pagination. Header accepts text, Enter/click submits; clear resets page one.

## Responsive management reference layout
Use a full-width selector and two action columns on small ordering headers; use bounded selector plus fixed action columns when space allows. Use customer/detail columns on large screens and stack below; detail header shows status beside name. Shared item cards have bordered heading/rows and an integrated primary-color total footer. Long titles and labels wrap without page overflow.

## Inline search behavior
Remove ordering header portal. Pass presentation search controls into ClaimSubmissionsView below link/status and above customer list. Debounce input 300ms; allow continued typing, cancel previous search and guard load sequence before state changes. Clear restores the selected activity. Abort timers/requests on activity/tab changes and unmount.
