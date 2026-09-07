## Why

Currently, the system assumes a single shared inventory or relies on hardcoded email checks for sharing. To support scale and professional organization, we need a formal way to group users into logical "inventory databases" that can be named and managed by an administrator.

## What Changes

- **Inventory Databases**: Introduce a new `inventory_databases` table to represent logical data silos.
- **Membership Management**: Introduce `inventory_database_members` to map users to databases with specific roles (e.g., owner).
- **Admin Controls**: Add a system-level admin capability to create/rename databases and assign owners.
- **Access Control**: Update RLS policies to scope all inventory-related data (products, orders, customers, locations) by the user's current `inventory_owner_id`.
- **User Experience**: The UI will need to respect the database assignment, potentially allowing admins to switch contexts or manage multiple databases.

## Capabilities

### New Capabilities
- `inventory/database-management`: Defines how logical inventory databases are created, named, and assigned to users.
- `inventory/scoped-access`: Defines how data access is restricted to the active inventory database for a user.

### Modified Capabilities
- (None)

## Impact

- **Database Schema**: New tables `inventory_databases`, `inventory_database_members`.
- **Profiles**: `profiles` table updated to include `inventory_owner_id`.
- **RLS Policies**: Extensive updates to `products`, `orders`, `customers`, `locations`, `settlements`.
- **Backend Functions**: New/updated RPC functions like `update_inventory_database_access` and `create_inventory_product`.
- **Frontend**: Store and UI components need to handle the inventory context (though primarily handled by RLS).
