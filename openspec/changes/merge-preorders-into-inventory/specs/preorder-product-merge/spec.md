## Purpose
Safely consolidate accidentally duplicated preorder products into received inventory products while preserving customer transaction and fulfillment history.

## ADDED Requirements

### Requirement: Preview an authorized product merge
The system SHALL let inventory staff preview an unstocked, never-received preorder and an existing received product belonging to the same inventory. It SHALL show their names/SKUs, affected forms and order counts, target stock and blocking conflicts. A merge SHALL require explicit confirmation of that preview.

#### Scenario: Preview a duplicate with existing orders
- **WHEN** staff selects a received target for an unstocked preorder
- **THEN** the preview shows affected forms, orders and unchanged target stock without mutating any data

#### Scenario: Invalid pair or unauthorized caller
- **WHEN** the pair crosses inventories, refers to the same product, includes a retired product, or the caller lacks inventory access
- **THEN** the operation is rejected without exposing another inventory's records

### Requirement: Preserve transactions and inventory atomically
The system SHALL transfer source listings and order/fulfillment references atomically, preserve customer item name/SKU snapshots, quantities, original prices, payments, order identities and packing progress, and SHALL NOT change physical stock, allocations or QR labels. The duplicate SHALL be retained as a read-only merge record and excluded from active product pickers.

#### Scenario: Confirm merge with paid orders
- **WHEN** staff confirms a current conflict-free preview
- **THEN** source references use the target, all transaction values remain unchanged, and the duplicate is retired

#### Scenario: Same form lists both products
- **WHEN** the target is already listed in a source form
- **THEN** its existing listing settings are retained and the source listing is removed, as described in the preview

#### Scenario: Same order contains both products
- **WHEN** consolidation would collapse distinct customer lines in the same submission, fulfillment order or bundle
- **THEN** the preview identifies the conflict and confirmation is blocked without rewriting original prices or quantities

#### Scenario: Stale preview or failing mutation
- **WHEN** relevant data changes after preview or any write fails
- **THEN** confirmation is rejected or rolled back completely and staff can request a fresh preview

### Requirement: Prevent retired product reuse
The system SHALL reject writes that reuse a retired product in listings, customer orders, fulfillment, receiving or inventory intake, including stale clients. Reconfirming a completed pair SHALL not repeat mutations.

#### Scenario: Stale browser saves the retired source
- **WHEN** a browser submits a product reference from before the merge
- **THEN** it receives an actionable refresh error and no duplicate is reactivated
