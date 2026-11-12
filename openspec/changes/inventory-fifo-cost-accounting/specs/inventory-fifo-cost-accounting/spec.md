## Purpose
Support independent inventory accounting policies, valuing sold units using their FIFO receipt batches while preserving existing manual period accounting and immutable historical settlement evidence.

## ADDED Requirements

### Requirement: Independent accounting mode
The system SHALL retain manual period accounting by default and support FIFO product costs per inventory.
#### Scenario: Separate inventories
- **WHEN** NN佛系海報代購 uses FIFO and 海報小天地 uses manual accounting
- **THEN** each inventory calculates costs independently and old settlements remain unchanged

### Requirement: Receipt batch cost management
The system SHALL record receipt quantities separately with nullable unit costs, allow explicit zero costs and opening-cost entry, and expose remaining batch quantities to authorized inventory users.
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

### Requirement: Direct per-poster cost entry
The system SHALL display a per-poster unit-cost field alongside selling price in FIFO inventory product creation and editing, save product data and costs atomically, and retain a default unit cost for zero-stock preorders and later receipts. Manual-accounting inventories SHALL retain their existing forms.
#### Scenario: Create a poster with cost
- **WHEN** a FIFO inventory user creates a poster with a unit cost
- **THEN** the poster and initial receipt cost are saved together, with explicit zero accepted
#### Scenario: Edit an existing opening batch
- **WHEN** a user enters cost for a poster with one editable receipt batch
- **THEN** saving the poster updates that batch and its default unit cost together
#### Scenario: Receive a new batch at a different price
- **WHEN** stock is increased with a new unit cost
- **THEN** only the new batch receives that cost and earlier batch costs remain unchanged
#### Scenario: Choose an existing batch
- **WHEN** a poster has multiple editable batches
- **THEN** the user explicitly selects the batch to edit and a revision conflict rejects the entire save
