## Purpose

Provide an inventory-scoped ordering flow for single-poster bundle sales where staff have already agreed the allocation and total with a customer, while preserving the original screenshots for payment, receiving, and packing verification.

## ADDED Requirements

### Requirement: Dedicated single-poster bundle claim workspace
The system SHALL provide authenticated inventory members with a dedicated admin workspace named "單張大禮包喊單系統" that is separate from catalog-based claim forms.

#### Scenario: Member opens the workspace
- **WHEN** an authenticated inventory member selects "單張大禮包喊單系統"
- **THEN** the system shows only bundle claim orders belonging to the currently selected inventory

#### Scenario: Account or inventory changes
- **WHEN** the signed-in account or selected inventory changes
- **THEN** the workspace clears stale results and loads records authorized for the new inventory only

### Requirement: Staff can create a fixed-total screenshot-backed order
The system SHALL let an authorized inventory member create an order with a customer-facing title or description, a positive fixed total, and at least one reference screenshot before opening it to a customer.

#### Scenario: Valid order is opened
- **WHEN** staff supply all required fields and supported screenshots and choose to open the order
- **THEN** the system creates an open order and provides an unguessable customer link

#### Scenario: Invalid order is rejected
- **WHEN** the total is zero or negative, no screenshot is attached, or an uploaded file violates the supported file rules
- **THEN** the system does not open the order and identifies the fields or files that must be corrected

### Requirement: Reference screenshots remain private and usable for verification
The system SHALL store bundle claim screenshots privately and SHALL reveal an order's screenshots only to authorized members of its inventory or to a visitor presenting that order's valid customer token or its inventory's enabled shared-menu token for a published allocation. Supported uploads SHALL be JPEG, PNG, or WebP, with a maximum of 10 images and 8 MB per original file.

#### Scenario: Customer views their screenshots
- **WHEN** a visitor opens a valid customer link
- **THEN** the system grants time-limited access only to the screenshots attached to that order

#### Scenario: Unrelated screenshot is requested
- **WHEN** a visitor or inventory member requests a screenshot outside the order or inventory they are authorized to access
- **THEN** the system denies access without revealing whether the unrelated file exists

#### Scenario: Confirmed evidence is protected
- **WHEN** an order has been confirmed by the customer
- **THEN** staff cannot replace or remove its verification screenshots

### Requirement: Customer links have an explicit lifecycle
Each bundle claim order SHALL have an unguessable link and a state that distinguishes draft, open, confirmed, cancelled, and expired orders. Staff SHALL be able to copy, preview, revoke, and optionally expire an open link.

#### Scenario: Open link is visited
- **WHEN** a visitor opens a non-expired order whose state is open
- **THEN** the system displays the order confirmation form

#### Scenario: Unavailable link is visited
- **WHEN** a visitor opens a draft, cancelled, expired, unknown, or malformed link
- **THEN** the system displays a safe unavailable message and does not expose order or inventory data

#### Scenario: Confirmed link is reopened
- **WHEN** the confirmed customer reopens the same link
- **THEN** the system shows the existing confirmation result and does not accept another order submission

### Requirement: Customers confirm the seller-defined order without editing its value
The public page SHALL show the agreed screenshots, description, and fixed total, and SHALL collect a nickname, a valid 10-digit Taiwan mobile number beginning with 09, optional notes, required consent, and a valid anti-bot challenge. Customers SHALL NOT be able to edit the total, create line items, or change quantities.

#### Scenario: Customer confirms successfully
- **WHEN** a customer submits valid details and passes the anti-bot challenge for an open order
- **THEN** the system atomically records one confirmation, issues a confirmation number, and shows the completion page

#### Scenario: Two submissions race
- **WHEN** multiple valid submissions attempt to confirm the same open order
- **THEN** exactly one confirmation succeeds and later attempts receive the existing or unavailable state without creating duplicates

#### Scenario: Customer data is invalid
- **WHEN** the phone, nickname, consent, or anti-bot verification is invalid
- **THEN** the system rejects the confirmation without changing the order state

### Requirement: Public presentation reuses inventory claim settings
The public confirmation and completion pages SHALL use the selected inventory's existing claim banner, banner position, theme colors, official LINE destination, completion message, and enabled transfer-account details. These settings SHALL be maintained in the existing claim appearance and inventory settings rather than duplicated for this feature.

#### Scenario: Inventory appearance is configured
- **WHEN** a customer opens a bundle claim link for an inventory with claim appearance settings
- **THEN** the page uses that inventory's banner and theme while preserving readable contrast and responsive layout

#### Scenario: Customer completes the order
- **WHEN** confirmation succeeds
- **THEN** the completion page shows the confirmation number, fixed total, configured next-step message, official LINE action when configured, and enabled transfer details without displaying the account-holder name

### Requirement: Bundle claims support full payment only
A confirmed bundle claim SHALL have only unpaid or paid payment states. Recording payment SHALL settle the entire fixed total in one operation; the system SHALL NOT offer or record partial payment for this order type.

#### Scenario: Staff records payment
- **WHEN** an authorized inventory member marks a confirmed unpaid order as paid
- **THEN** the system records a payment equal to the fixed total together with the payment time and acting member

#### Scenario: Partial amount is attempted
- **WHEN** any client attempts to record a payment amount different from the fixed total
- **THEN** the system rejects the operation and leaves the order unpaid

### Requirement: Staff can track receiving and outbound verification
The admin workspace SHALL keep the original screenshots visible beside the confirmed customer details and SHALL provide separate receiving and outbound verification states with timestamps and acting members.

#### Scenario: Item is checked on arrival
- **WHEN** an authorized member marks a confirmed order as received and checked
- **THEN** the system records who performed the receiving check and when

#### Scenario: Item is checked before shipment
- **WHEN** an authorized member marks a received order as checked for outbound packing
- **THEN** the system records who performed the outbound check and when

### Requirement: Staff can manage and find bundle claim orders
The admin workspace SHALL list the order's customer, confirmation number, fixed total, payment state, fulfillment checks, link state, and creation or confirmation time. It SHALL provide search and filters for operational states. The legacy draft-only RPC SHALL remain restricted to unconfirmed drafts. The guarded removal RPC SHALL allow authorized removal in every link state only after payment and fulfillment checks have been reversed, with a customer/code/amount confirmation and stale-record protection.

#### Scenario: Staff filters unpaid confirmations
- **WHEN** staff select the confirmed-unpaid filter
- **THEN** the list contains only confirmed unpaid bundle claims in the current inventory

#### Scenario: Legacy draft-only deletion rejects a confirmed order
- **WHEN** staff call the legacy draft-only deletion RPC for an order that is open, confirmed, cancelled, or expired
- **THEN** that RPC preserves the record

#### Scenario: Guarded removal protects financial and fulfillment records
- **WHEN** staff attempt guarded removal while the order still has a payment or receiving/outbound check
- **THEN** removal is rejected until the related records are reversed

### Requirement: Confirmed orders participate in customer settlement lookup
Confirmed bundle claims SHALL appear with existing claim records in authorized customer settlement views and inventory-scoped LINE phone lookup. Draft, open, cancelled, and expired bundle claims SHALL be excluded from customer payment totals.

#### Scenario: Customer requests checkout details by phone
- **WHEN** a phone number has a confirmed unpaid bundle claim in the configured inventory
- **THEN** the lookup response includes its confirmation number, description, fixed total, and the inventory's enabled transfer details without an account-holder name

#### Scenario: Same phone exists in another inventory
- **WHEN** the same phone number has records in multiple inventories
- **THEN** a lookup returns only records belonging to the inventory configured for that request

### Requirement: Tenant and role boundaries are enforced server-side
All administrative reads and writes SHALL require an authenticated user with access to the target inventory. Public operations SHALL be limited to narrowly scoped token-based viewing and one-time confirmation and SHALL not permit enumeration of customers, inventories, or orders outside the published allocations of an enabled shared menu.

#### Scenario: Unauthorized inventory access is attempted
- **WHEN** a user supplies an order identifier belonging to an inventory they do not own or manage
- **THEN** the system denies the operation even if the client interface was bypassed

#### Scenario: Tokens are guessed or enumerated
- **WHEN** repeated invalid public tokens are requested
- **THEN** responses disclose no order metadata and the public confirmation endpoint remains protected by anti-abuse controls

### Requirement: Bundle claim pages are usable across supported screen sizes
The admin workspace and public confirmation page SHALL remain readable and operable on 375-pixel mobile screens, tablets, and desktop layouts without horizontal overflow or clipped controls.

#### Scenario: Customer uses a narrow mobile screen
- **WHEN** the public page is rendered at a 375-pixel viewport
- **THEN** screenshots, fixed total, form controls, and completion actions fit the viewport and remain touch accessible


### Requirement: Public shared menu of preallocated bundles
Authorized staff SHALL enable, disable, copy and preview one random shared-menu link per inventory. Anyone with an enabled link SHALL see all published open/non-expired and confirmed allocations, with preassigned nickname, evidence, description and fixed total. Draft, cancelled, expired and other-inventory orders SHALL be excluded. Submitted contact details, payment metadata, receipts and individual tokens SHALL never appear in shared-menu reads.

#### Scenario: Customer selects their allocation
- **WHEN** a customer clicks their name button among multiple visible name options
- **THEN** the page highlights that name, shows its screenshots and fixed total before the final contact form, prefills the nickname, and requires phone, consent and Turnstile before submission; no dropdown is required

#### Scenario: Allocation is already confirmed
- **WHEN** a menu contains a confirmed allocation
- **THEN** it remains visible with an explicit confirmed status and cannot be selected or confirmed by a new request

#### Scenario: Menu confirmation races or retries
- **WHEN** multiple requests confirm one allocation
- **THEN** only the first request records customer data and receives a receipt; another request is rejected, while an identical request ID retry returns the original receipt

#### Scenario: Menu is disabled or a foreign order is submitted
- **WHEN** a disabled or unknown token is used, or an order belongs to another inventory
- **THEN** the request fails without returning customer or order metadata or changing an order

### Requirement: Itemized allocated product review

The system SHALL let staff enter a name and amount for each product image in a draft and calculate the bundle total from those amounts. Public product cards SHALL display the name and amount below each image using the project colors and gold prices.

#### Scenario: Save and publish allocated products
- **WHEN** staff save all product names and positive two-decimal amounts and open the allocation
- **THEN** the stored total equals the sum of the product amounts and the customer sees matching product cards and fixed total
- **AND** the published product details cannot be edited

#### Scenario: Review on narrow and wide screens
- **WHEN** the customer selects their name
- **THEN** desktop shows products beside the contact form and mobile stacks them without horizontal overflow
