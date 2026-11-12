## Why
Preorders can accidentally duplicate a product already received into inventory. Existing customer orders and payments must survive consolidation without changing physical stock.

## What Changes
- Add an authenticated preview and atomic merge from an unstocked preorder into an existing inventory product in the same inventory.
- Preserve transaction snapshots, payments, quantities and fulfillment progress; retire the duplicate without deleting it.
- Confirm affected forms/orders and detect duplicate product conflicts before committing.

## Capabilities
### New Capabilities
- `preorder-product-merge`: Preview and consolidate duplicate preorder identities safely.
### Modified Capabilities
None.

## Impact
Supabase product metadata, transactional RPC and reference guards; product and location APIs; claim settings merge dialog; database/API/browser regression coverage. No new dependency. Production data is only merged after a user explicitly confirms a selected pair in the UI.
