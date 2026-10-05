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

