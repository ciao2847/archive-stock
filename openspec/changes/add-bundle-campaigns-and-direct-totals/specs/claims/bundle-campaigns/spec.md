## Purpose

Provide inventory-scoped bundle campaign management where staff can create multiple distinct sales events, each with its own public shared link, and price bundles directly with item names and fixed totals without per-image itemized subtotal overhead.

## ADDED Requirements

### Requirement: Dedicated bundle campaign management
The system SHALL provide authenticated inventory members with the ability to manage multiple bundle claim campaigns (大禮包活動) within their authorized inventory.

#### Scenario: Member views campaigns in the workspace
- **WHEN** an authenticated inventory member opens "單張大禮包喊單系統"
- **THEN** the system lists all campaigns belonging to the selected inventory, displaying each campaign's title, description, enabled status, and allocation count

#### Scenario: Member creates a new campaign
- **WHEN** an authorized member provides a campaign title and optional description
- **THEN** the system creates a new campaign with a unique unguessable public token and initially paused status

#### Scenario: Member toggles campaign availability
- **WHEN** an authorized member enables or disables a campaign
- **THEN** the campaign's public availability updates immediately without affecting already confirmed orders or other campaigns

### Requirement: Campaign-scoped public shared menu
The system SHALL expose an unguessable public route `/bundles/[campaign_token]` that renders only the published allocations belonging to that specific campaign.

#### Scenario: Visitor views campaign shared menu
- **WHEN** a visitor navigates to an enabled campaign's public token URL
- **THEN** the system displays the campaign title, description, inventory appearance (banner and theme), and visible nickname buttons for allocations within that campaign

#### Scenario: Visitor confirms an allocation in a campaign
- **WHEN** a visitor selects their nickname in an enabled campaign, provides valid contact details, and completes verification
- **THEN** the system confirms that allocation under the selected campaign, issues a confirmation receipt, and disables the nickname button for subsequent visitors

#### Scenario: Disabled or non-existent campaign visited
- **WHEN** a visitor navigates to a disabled, unknown, or malformed campaign token
- **THEN** the system displays a safe unavailable notice without disclosing internal campaign or customer data

### Requirement: Per-image product details and summed bundle total
The system SHALL let staff fill a product name and positive two-decimal amount for each screenshot. New and edited drafts SHALL calculate their fixed total from these amounts.

#### Scenario: Staff saves an itemized draft
- **WHEN** staff upload product screenshots and provide each product's name and amount
- **THEN** the system saves all product metadata and computes the bundle total in integer cents without duplicate uploads on retry

#### Scenario: Staff enters a customer option without a separate bundle title
- **WHEN** staff create or edit a bundle allocation
- **THEN** the editor requires a nonblank customer group nickname, uses the selected campaign title as the stored bundle title, and displays a read-only total computed from product amounts

#### Scenario: Buyer reviews the selected allocation
- **WHEN** a buyer selects their nickname
- **THEN** each image displays its product name and gold price directly below it, and a primary-color footer displays the nickname, item count and gold summed total

#### Scenario: Staff opens or removes an itemized draft image
- **WHEN** staff open a draft or remove a product image
- **THEN** the database recomputes the complete itemized total and rejects publication of partially priced screenshots

#### Scenario: Legacy published allocation lacks product metadata
- **WHEN** a buyer views a previously published allocation without per-image names or amounts
- **THEN** the system retains its original fixed total and presents the bundle title with a note that the image price is included in the total, without inventing item prices

### Requirement: Shared appearance and payment settings across campaigns
The system SHALL share the inventory's existing claim banner, theme colors, official LINE destination, completion message, and enabled transfer-account details across all bundle campaigns.

#### Scenario: Campaign renders inventory settings
- **WHEN** a visitor views any enabled bundle campaign in that inventory
- **THEN** the page renders using that inventory's configured appearance and supplies the inventory's transfer account upon confirmation without exposing account-holder names

### Requirement: Compatibility and strict activity isolation
The system SHALL preserve existing menu URLs by assigning their tokens and existing allocations to default campaigns. Confirmation SHALL reject orders belonging to another campaign even within the same inventory.

#### Scenario: Existing customer follows an old shared link
- **WHEN** a migrated legacy campaign remains enabled
- **THEN** the existing link opens that campaign's existing allocations and stored historical totals are unchanged

#### Scenario: Another activity's order id is submitted
- **WHEN** a visitor submits an order id outside the token's campaign
- **THEN** the confirmation fails without changing any order

#### Scenario: Paused legacy activity is visited
- **WHEN** its inventory-level legacy flag remains enabled but the campaign is paused
- **THEN** the public read and confirmation remain unavailable and do not fall back to the inventory-wide menu

### Requirement: Desktop-friendly LINE contact after confirmation
The system SHALL show a mobile LINE launch link, an in-page QR Code encoding the same official-account link and prefilled confirmation message, and a copy-message action on confirmed bundle receipts when a valid official LINE destination is available.

#### Scenario: Buyer contacts staff from a desktop browser
- **WHEN** a confirmed buyer views their receipt on desktop
- **THEN** they can scan its QR Code with phone LINE or copy the confirmation message and paste it into an existing official-account conversation, with an instruction to send the message themselves

#### Scenario: Clipboard permission is denied
- **WHEN** copying the confirmation message fails
- **THEN** the page provides the exact same message for manual copying

#### Scenario: No official account is configured
- **WHEN** the inventory has no valid official LINE ID
- **THEN** no LINE contact link or QR Code is presented

### Requirement: Standalone bundle confirmation completion page
The system SHALL replace the shared menu view with the standalone confirmed receipt after successful submission. The completion page SHALL follow the regular claim form receipt's width and card spacing.

#### Scenario: Buyer completes a shared-menu allocation
- **WHEN** the confirmation API succeeds and provides the receipt
- **THEN** only the confirmation number, order summary, completion/payment instructions and LINE contact alternatives are rendered, without the campaign banner, progress list, nickname selector or return-to-menu control

### Requirement: Unified same-page ordering and contact experience
The public fixed-allocation flow SHALL be labeled 配單確認 and managed through 配單管理. The public selectable-product flow SHALL be labeled 預購／現貨訂購 and managed through 訂購管理. Both SHALL combine item/total review and contact entry on a single responsive page with independent completion pages.

#### Scenario: Customer selects products and enters contacts
- **WHEN** a customer changes eligible product quantities on an open ordering page
- **THEN** the item count and total update without hiding product choices or navigating to a separate contact step, and submission requires selected items, valid contacts, consent and verification

#### Scenario: Ordering submission fails
- **WHEN** the server rejects a submission
- **THEN** the page retains selections/contact details, refreshes verification and permits a retry using the original request ID

#### Scenario: Ordering is closed
- **WHEN** a customer views a closed ordering form
- **THEN** products remain viewable, quantity controls are disabled and ordering cannot be submitted

#### Scenario: Ordering succeeds
- **WHEN** a submission succeeds
- **THEN** the page displays a standalone 訂購成功 or 配單確認成功 receipt without selection/header controls

### Requirement: Shared admin presentation with independent workflows
The system SHALL compose ordering and allocation management from shared customer-list, item-detail, customer metadata and payment presentation components while retaining source-specific APIs and rules.

#### Scenario: View one customer detail
- **WHEN** an operator selects a list row
- **THEN** only that record’s products and payment controls are displayed
- **AND** selection is reconciled after reload, pagination or activity change

#### Scenario: Source-specific payment rules
- **WHEN** the shared payment editor is opened
- **THEN** ordinary ordering allows a positive partial amount within the outstanding balance
- **AND** allocations show a read-only exact full amount
- **AND** source containers validate and call their own APIs

#### Scenario: Separate procurement and fulfillment
- **WHEN** the operator views ordering management
- **THEN** customer details are the default and procurement totals/CSV remain accessible in a separate tab
- **AND** bundle receiving/outbound checks retain their existing prerequisites and reversal behavior

### Requirement: Confirmed record removal with safeguards
The system SHALL show a trash/remove action for ordering and allocation records and require confirmation showing customer, confirmation number and amount before removal.

#### Scenario: Operator cancels removal
- **WHEN** the operator declines confirmation
- **THEN** no delete request is made and the record remains

#### Scenario: Allocation has protected records
- **WHEN** an allocation has a payment or receiving/outbound check
- **THEN** deletion is rejected until those records are reversed
- **AND** ordinary ordering retains existing remittance deletion restrictions

#### Scenario: Eligible record removed
- **WHEN** an authorized inventory member confirms removal of an unchanged allocation without protected records
- **THEN** the allocation and image metadata are removed atomically and the interface refreshes selection/counts
- **AND** image object cleanup happens only after success

#### Scenario: Stale record or another inventory
- **WHEN** the record was updated since selection or belongs to another inventory
- **THEN** removal fails without modifying any record

### Requirement: Explicit availability switches
The system SHALL provide labeled, themed availability switches for ordering reception and allocation public menus.

#### Scenario: Close or open availability
- **WHEN** an operator closes a switch
- **THEN** confirmation is required once and cancellation sends no request
- **AND** opening requires no confirmation

#### Scenario: Saving or failure
- **WHEN** availability is being saved
- **THEN** the switch is disabled and retains its previous state until success
- **AND** failure preserves the previous state and displays an error

### Requirement: Ordering customer search
The system SHALL allow ordering management search by nickname, partial phone or confirmation number within the authorized inventory.

#### Scenario: Text search or clear
- **WHEN** an operator searches by nickname, partial phone or code using Enter or the search button
- **THEN** matching records across inventory activities are returned with server pagination
- **AND** clearing returns to the selected activity

#### Scenario: Literal punctuation
- **WHEN** a query contains punctuation or wildcard characters
- **THEN** it is treated as literal search text and cannot widen inventory access

### Requirement: Responsive reference management layout
The system SHALL render ordering and allocation management according to the supplied hierarchy while retaining project colors and existing operations.

#### Scenario: Narrow management view
- **WHEN** management is viewed on a phone or tablet with long activity titles
- **THEN** selectors and create/remove IP buttons remain within the viewport, readable and operable
- **AND** customer/detail cards stack without horizontal page scrolling

#### Scenario: Wide management view
- **WHEN** management is viewed on a large screen
- **THEN** the customer list and selected detail appear side by side with status/name, item card, total footer and payment operations

### Requirement: Inline automatic ordering search
The system SHALL place ordering search above its customer list like allocation management and update results automatically after typing.

#### Scenario: Automatic or immediate search
- **WHEN** an operator types a customer query
- **THEN** the matching customer list updates after a short debounce without requiring submission
- **AND** Enter and the query button trigger immediate search

#### Scenario: Query changes during a request
- **WHEN** another query or activity supersedes a search
- **THEN** the previous response cannot overwrite the current results
- **AND** typing remains available while searching
