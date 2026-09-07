## Context

The system currently relies on the user's `id` as the `owner_id` for inventory records. To support shared inventories, we need a layer of abstraction. See `proposal.md` for the motivation. The implementation leverages Supabase RLS and PostgreSQL functions to maintain security and data isolation.

## Goals / Non-Goals

**Goals:**
- Implement a robust multi-tenant inventory structure.
- Ensure all legacy data is correctly migrated to the new schema.
- Provide admin-level RPC functions for managing database membership.

**Non-Goals:**
- Implementation of a frontend admin UI (this design focuses on the database and API layer).
- Multi-database membership for a single user (users are mapped to exactly one active inventory).

## Decisions

### 1. Schema Structure
Introduce `inventory_databases` and `inventory_database_members`.
- **Rationale**: Separates the concept of a "login account" from an "inventory database". Multiple accounts can point to the same canonical inventory.
- **Alternatives**: Using a tagging system or roles-based access on the `profiles` table directly. However, a dedicated database table allows for richer metadata (names, timestamps) and cleaner membership management.

### 2. Context Retrieval via `private` schema
Create a `private.current_inventory_owner_id()` function.
- **Rationale**: Centralizes the logic for determining which inventory the current user should see. Using a `private` schema prevents accidental exposure or modification from the client.
- **Alternatives**: Passing `inventory_id` in every request. This is less secure and prone to error compared to a server-side context derived from the JWT.

### 3. RLS Scoping
Update RLS policies for `products`, `orders`, `customers`, `locations`, and `settlements` to check against `private.current_inventory_owner_id()`.
- **Rationale**: Leverages native PostgreSQL security to ensure data isolation at the engine level.

## Risks / Trade-offs

- **[Risk] Performance impact of subqueries in RLS** → **Mitigation**: Use `security definer` and `stable` keywords for context functions and ensure proper indexing on `inventory_owner_id` and membership tables.
- **[Risk] Migration of existing records** → **Mitigation**: The migration script must carefully assign existing records to the user's initial inventory database (matching their `id`) to ensure no data is lost.

## Migration Plan

1. Create new tables and columns.
2. Populate initial inventory databases for existing users.
3. Assign existing records to their respective new inventory databases.
4. Update RLS policies and backend functions.
5. Verify access controls with tests.
