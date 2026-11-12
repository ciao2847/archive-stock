## Purpose
Support independent inventory accounting policies, valuing sold units using their FIFO receipt batches while preserving existing manual period accounting and immutable historical settlement evidence.

## ADDED Requirements

### Requirement: Independent accounting mode
The system SHALL retain manual period accounting by default and support FIFO product costs per inventory.
#### Scenario: Separate inventories
- **WHEN** NN佛系海報代購 uses FIFO and 海報小天地 uses manual accounting
- **THEN** each inventory calculates costs independently and old settlements remain unchanged

### Requirement: Receipt batch cost management
The system SHALL record receipt quantities separately with nullable total costs and derived average unit costs, allow explicit zero costs and opening-cost entry, and expose remaining batch quantities to authorized inventory users.
#### Scenario: Missing cost
- **WHEN** stock is received without cost
- **THEN** a missing-cost batch is visible and sales remain possible

### Requirement: FIFO allocation and returns
The system SHALL allocate outgoing packed units from oldest available batches, preserve existing allocations, and restore original batches when unsettled quantities are reduced or cancelled.
#### Scenario: Sale spans batches
- **WHEN** 12 units sell from 10 units at 180 followed by 10 at 200
- **THEN** sold product cost is 2200 and 8 units at 200 remain
#### Scenario: Cancellation
- **WHEN** an unsettled sale is cancelled with stock restored
- **THEN** its original batch quantities become available without a duplicate receipt

### Requirement: Settlement snapshots and extra expenses
The system SHALL total sold product costs plus individually entered period expenses, block missing costs, and freeze mode and batch cost evidence at settlement.
#### Scenario: Incomplete product costs
- **WHEN** an eligible sale has missing batch costs
- **THEN** settlement is rejected and the missing products are identified
#### Scenario: Historical consistency
- **WHEN** later receipts or cost edits occur
- **THEN** existing settlement totals and exported batch details remain unchanged

### Requirement: Consistent financial outputs and tenant isolation
The system SHALL use the same product-plus-expense cost totals in preview, profit shares, dashboard and Excel, and deny cross-inventory access to non-admin users.
#### Scenario: Export
- **WHEN** a FIFO accounting report is exported
- **THEN** it includes sold batch costs and separate additional expenses with matching profit

### Requirement: Atomic product and batch cost entry
The system SHALL save product metadata and all entered batch costs atomically in FIFO inventories. Blank totals SHALL remain unknown and explicit zero SHALL be accepted. Existing batch revisions and settled locks SHALL be checked before committing any changes. Manual-accounting inventories SHALL retain their existing forms.
#### Scenario: Create a poster with cost
- **WHEN** a FIFO inventory user creates a poster with receipt quantities and total costs
- **THEN** the poster and all receipt batches are saved together
#### Scenario: Create a zero-stock preorder
- **WHEN** a user creates a preorder without received batches
- **THEN** stock is zero and no receipt is invented
#### Scenario: Receive a new batch at a different price
- **WHEN** a user adds a receipt with its own total cost
- **THEN** physical stock increases by that receipt quantity and earlier batch costs remain unchanged
#### Scenario: Concurrent or locked batch changes
- **WHEN** a cost revision is stale or an edited batch has settled allocations
- **THEN** the entire product and batch save is rejected

### Requirement: Multiple batch totals in product forms
The system SHALL let FIFO inventory users enter multiple batches with quantity, total cost, date and notes in product creation/editing. Average cost SHALL be derived from each batch total. Remaining stock SHALL be derived from batch quantities, including explicit new receipts. Existing unsettled batches SHALL support splitting while retaining original total quantity and reallocating only that batch's unsettled outbound quantities. Settled batches SHALL remain locked.
#### Scenario: Two batches in one save
- **WHEN** a product is created with 10 units costing 1800 and 5 units costing 1000
- **THEN** stock is 15 with two separate receipt batches and displayed average costs of 180 and 200
#### Scenario: Non-divisible total
- **WHEN** a batch has 3 units and a total cost of 100 and all three units are sold across separate orders
- **THEN** the accumulated sold costs equal exactly 100, with returns restoring the original allocated amount
#### Scenario: Split opening inventory
- **WHEN** an unsettled opening batch of 15 units is split into 10 and 5 units
- **THEN** physical stock remains unchanged and existing outbound units retain their order references with costs allocated across the new child batches
#### Scenario: Same-date batch splitting
- **WHEN** the earliest of multiple equal-date receipts is split, including repeated splitting
- **THEN** its children retain its FIFO position and their displayed order, ahead of later receipts

### Requirement: Public unfulfilled orders remain available
The system SHALL allow token-validated public order submissions without requiring inventory management membership. Creating or editing an order with no packed quantities or cost allocations SHALL NOT invoke privileged cost reconciliation. Packing, cancelling packed orders and inventory changes SHALL retain FIFO reconciliation and tenant authorization.
#### Scenario: Anonymous customer places an order
- **WHEN** a customer submits an enabled product on an open FIFO inventory form without an employee session
- **THEN** the submission and pending fulfillment order are created atomically, with stock, batches and cost allocations unchanged
#### Scenario: Signed-in customer from another inventory
- **WHEN** a customer with an unrelated account submits the public form
- **THEN** the pending public order is accepted without granting access to the target inventory's costs
#### Scenario: Later packing and cancellation
- **WHEN** an authorized employee packs or cancels a packed public order
- **THEN** normal FIFO allocation or return applies and unauthorized cost writes remain rejected
