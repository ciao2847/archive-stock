## Context

See `proposal.md` for motivation and `specs/claims/single-poster-bundle-orders/spec.md` for the behavior contract.

The existing claim system is inventory-scoped and already supplies public-form appearance, official LINE, completion copy, transfer-account settings, Cloudflare Turnstile verification, customer settlement views, and LINE phone lookup. Its data model assumes reusable catalog products and quantities, while this workflow starts only after a seller has manually allocated posters and calculated one customer's final total. Conversation screenshots may contain personal information and therefore cannot use the existing public image buckets.

The application is a Next.js application backed by Supabase Auth, Postgres, and Storage. The implementation must preserve tenant isolation when the signed-in account or selected inventory changes and must follow the installed Next.js version's local documentation before introducing routes or request APIs.

## Goals / Non-Goals

**Goals:**

- Model a bundle claim as one fixed-total customer order rather than artificial products or quantities.
- Reuse existing inventory presentation and settlement settings without duplicating configuration.
- Preserve private screenshots as immutable evidence after confirmation and make them convenient for receiving and packing checks.
- Make customer confirmation atomic, single-use, bot-protected, and safe under concurrent submissions.
- Keep full-payment, receiving, and outbound actions auditable and inventory-scoped.

**Non-Goals:**

- Importing or monitoring social-media discussion threads.
- OCR, screenshot interpretation, automated allocation, or supplier purchase-order generation.
- Building a poster SKU catalog or allowing buyers to select individual posters and quantities.
- Letting customers change the seller's total or make partial payments.
- Replacing the existing catalog-based claim workflow.

## Decisions

### 1. Use a separate bundle-order aggregate

Add `bundle_claim_orders`, `bundle_claim_order_images`, and `bundle_claim_payments` instead of inserting synthetic rows into existing claim-form product tables.

`bundle_claim_orders` owns:

- inventory/owner identifier and creator identifier;
- random public token and confirmation number;
- title, description, and fixed `numeric(12,2)` total greater than zero;
- lifecycle state (`draft`, `open`, `confirmed`, `cancelled`, `expired`);
- customer nickname, normalized phone, optional note, confirmation time, and optional expiry;
- receiving and outbound check timestamps and acting-member identifiers;
- created and updated timestamps.

`bundle_claim_order_images` owns the private storage path, stable sort order, media type, original filename, byte size, and creation time. Paths are unique and scoped beneath the order and inventory.

`bundle_claim_payments` is a one-to-one audit record for a confirmed order and stores the exact settled total, payment time, optional remittance metadata, note, and acting member. A database function inserts or removes this record only for authorized inventory members and enforces that the amount equals the order total.

This keeps existing claim reporting stable and makes the full-payment invariant enforceable. Reusing existing product rows was rejected because it would create misleading inventory quantities and require placeholder products. Storing payment only as mutable fields on the order was rejected because it weakens the audit boundary.

### 2. Keep screenshots in a new private Storage bucket

Create a non-public `bundle-claim-screenshots` bucket. Authenticated inventory members upload through a server-authorized flow after an order draft exists. The server validates MIME type, image count, and file size; metadata is committed only for a path belonging to that order.

Admin pages receive short-lived signed URLs after membership validation. A public visitor receives short-lived signed URLs only after the server validates the exact order token. Neither storage paths nor a service-role credential are accepted from the browser as authorization.

A confirmed order's image rows and objects become immutable. Staff can revoke the public link or cancel the order, but correcting confirmed evidence requires creating a new order. A public bucket was rejected because screenshots may expose conversation names, avatars, prices, or other personal information.

### 3. Expose one public route with a narrow server API

Use `/bundle/[token]` as the customer link and add narrowly scoped public read and confirm endpoints. Reads return only display-safe order data, inventory appearance, and temporary image access. Unknown, malformed, unavailable, and cross-order tokens use a common safe response.

Confirmation verifies the current Turnstile token on the server, normalizes and validates the Taiwan phone number, and invokes one database transaction that locks the open order, records customer details, assigns a confirmation number, and changes the state to `confirmed`. The operation is idempotent for the already-confirmed token and uses a state predicate so concurrent requests cannot create two confirmations.

Encoding a sequential database id in the URL was rejected because it is enumerable. Allowing multiple submissions under one token was rejected because each link represents one seller-calculated allocation.

### 4. Reuse inventory settings as live presentation configuration

The public route reads the same inventory fields used by claim forms: banner path and position, theme colors, official LINE id, completion message, and enabled bank/transfer data. There is no second appearance editor. The admin workspace links to the existing appearance/settings area when staff want to change shared presentation.

The completion page snapshots the confirmed order amount and confirmation code but uses current operational contact and payment configuration, matching the existing claim experience. As in current customer-facing flows, the account-holder name is never returned or rendered.

### 5. Add a dedicated dashboard view, not a second application shell

Add a dashboard navigation item named exactly `單張大禮包喊單系統`. The view reuses existing authentication, inventory selection, responsive shell, controls, and visual tokens. It contains:

- a create/edit draft panel with multi-image upload, fixed total, description, optional customer hint, and optional expiry;
- link copy and preview actions after opening;
- search and operational filters;
- order cards or table rows showing customer, confirmation, total, link, payment, receiving, and outbound states;
- actions for revoke/cancel, record or undo full payment, receiving check, outbound check, and draft deletion.

The order detail keeps screenshots visible beside operational controls. At tablet widths, the list/detail layout uses balanced columns; on narrow screens it stacks without fixed widths. A standalone admin route was considered, but a dashboard view better preserves current inventory context and avoids duplicating access control and navigation.

### 6. Enforce authorization in Postgres and server handlers

All three tables enable RLS. Authenticated policies and security-definer functions use the project's canonical inventory-membership helper rather than trusting an `owner_id` supplied by a client. Public clients receive no direct table access; public reads and confirmation go through server endpoints/RPCs exposing only the fields needed by a valid token.

Indexes cover inventory plus lifecycle state, inventory plus normalized phone, confirmation number, expiry, and image order. Unique constraints cover public token, confirmation number when present, image path, and one payment per order. Check constraints cover positive totals, allowed lifecycle values, normalized phone format after confirmation, non-negative sort order, and valid state transitions where enforceable.

Service-role operations remain server-only. All admin handlers revalidate the current user and inventory membership even when RLS also applies, providing defense in depth and consistent error messages.

### 7. Extend settlement lookup without merging storage models

Customer settlement screens and the LINE inventory-scoped lookup read a server-side union of existing confirmed claims and confirmed bundle orders. Each result retains a source type and its own identifier. Only confirmed records contribute to totals, and a bundle order contributes exactly its fixed total until its one full-payment record exists.

This avoids copying bundle orders into existing claim submissions while giving customers one coherent unpaid summary. Lookup remains scoped to the configured/current inventory, including when the same phone appears elsewhere.

### 8. Treat receiving and outbound checks as separate audited milestones

Receiving and outbound checks are timestamp/member pairs on the order because each milestone occurs at most once in the first version. Outbound confirmation requires a prior receiving check. Reversals are explicit authorized actions that clear the relevant timestamp and actor; clearing receiving also clears outbound to prevent an impossible state.

Separate event tables were considered but deferred because the current requirement needs the latest accountable milestone, not a full warehouse event ledger. Payment remains a separate record because it affects settlement reporting and may carry remittance metadata.

## Risks / Trade-offs

- **[Sensitive data in screenshots]** → Use a private bucket, short-lived signed URLs, strict token scoping, no indexing, and immutable evidence after confirmation.
- **[A customer forwards an open link]** → Use high-entropy tokens, optional expiry/customer hint, one successful confirmation, Turnstile, and immediate staff revocation; the first version deliberately does not require customer accounts.
- **[Large images make mobile pages slow]** → Limit count and original size, generate or request display-sized variants where supported, lazy-load gallery images, and keep originals for verification.
- **[Double submission creates conflicting customers]** → Confirm through a conditional database transaction that locks the order and accepts only the `open` state.
- **[Staff enters the wrong fixed total]** → Require a clear review step before opening and make confirmed financial evidence immutable; corrections use cancellation and a replacement order.
- **[Live inventory settings change after the link is sent]** → Appearance/contact/payment instructions intentionally follow current inventory settings, while the agreed total, screenshots, and customer confirmation are fixed on the order.
- **[Union lookup slows existing customer queries]** → Add inventory/phone/status indexes and return a bounded, server-defined result shape; inspect query plans before production rollout.
- **[More dashboard controls increase mobile density]** → Use compact status chips and progressive detail panels, validate at 375 px and tablet widths, and avoid fixed-width tab labels.

## Migration Plan

1. Add tables, constraints, indexes, RLS policies, private bucket policies, and inventory-scoped database functions without changing existing claim behavior.
2. Regenerate database types and verify migration/RLS tests plus Supabase security and performance advisors.
3. Deploy server APIs and the public route behind navigation that is not yet exposed; verify token, upload, confirmation, and signed-image behavior in preview.
4. Add the dashboard navigation/view and enable creation for authenticated inventory members.
5. Extend customer settlement and LINE lookup after bundle confirmation/payment behavior is verified.
6. Run responsive, concurrency, cross-inventory, Turnstile, build, and production smoke tests, then deploy to Vercel Production.

Rollback removes the navigation and disables create/confirm endpoints first, leaving tables and private objects intact so financial and verification evidence is not lost. Application code can then revert to the previous lookup behavior. Destructive removal of stored orders or screenshots requires a separate approved retention/migration operation.

