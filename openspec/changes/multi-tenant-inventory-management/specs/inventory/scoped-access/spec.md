## Purpose

Ensures that all inventory data (products, orders, locations, customers) is strictly scoped to the user's active inventory database.

## ADDED Requirements

### Requirement: Data Isolation by Inventory Owner
The system SHALL isolate all inventory-related records (Products, Orders, Customers, Locations, Settlements) based on the `inventory_owner_id` associated with the user's profile.

#### Scenario: User queries products
- **WHEN** a user requests a list of products
- **THEN** the system returns only products belonging to the user's active inventory database

### Requirement: Cross-Database Access Prevention
The system SHALL prevent users from accessing or modifying records belonging to an inventory database they are not members of.

#### Scenario: User attempts to access unauthorized record
- **WHEN** a user attempts to read or update a record with an `owner_id` that does not match their assigned `inventory_owner_id`
- **THEN** the system denies access (e.g., returns no rows or an error)

### Requirement: Inventory Creation Context
The system SHALL automatically associate new inventory records (e.g., creating a product) with the user's active inventory database.

#### Scenario: User creates a new product
- **WHEN** a user submits a request to create a new product
- **THEN** the system assigns the product to the user's active `inventory_owner_id`
