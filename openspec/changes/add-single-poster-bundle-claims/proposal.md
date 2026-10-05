## Why

Single-poster bundle sales currently happen through image-heavy discussion threads, where the seller manually quotes prices, confirms allocations, and calculates each buyer's final amount. The existing product claim form is too structured for this workflow because creating a catalog product for every poster would add significant overhead, while the final checkout, payment, receiving, and packing records still need a reliable system of record.

## What Changes

- Add a dedicated admin page named "單張大禮包喊單系統" for creating fixed-total, screenshot-backed claim orders.
- Let staff upload one or more private reference screenshots, enter the customer-facing description and final total, and generate an unguessable customer link.
- Add a customer confirmation page that reuses the inventory's existing claim banner, theme, official LINE, completion message, and transfer-account settings.
- Allow customers to review screenshots, enter their nickname and Taiwan mobile number, and confirm the seller-defined total without changing quantities or price.
- Restrict this workflow to full payment only, with simple unpaid and paid states.
- Keep the original screenshots attached to the order for receiving and outbound packing verification, with separate receiving and shipping check states.
- Surface confirmed bundle orders in admin customer/payment views and LINE phone lookup without mixing records across inventory databases.
- Protect public confirmation with the existing Cloudflare Turnstile pattern and make each order link single-confirmation and revocable.

## Capabilities

### New Capabilities

- `claims/single-poster-bundle-orders`: Create, share, confirm, pay, receive, and pack fixed-total screenshot-backed claim orders.

### Modified Capabilities

None.

## Impact

- Adds Supabase tables, private screenshot storage policies, inventory-scoped database functions, generated database types, and API routes.
- Adds an authenticated admin route and a public token route, reusing existing claim appearance and payment configuration.
- Extends dashboard navigation and LINE customer settlement lookup to include confirmed bundle orders.
- Introduces no breaking change to existing public claim forms or existing product inventory records.
