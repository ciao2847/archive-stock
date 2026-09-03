## Why

`Dashboard.tsx` has grown to nearly 1,000 lines of code, housing multiple large nested views and sub-components (`Overview`, `ProductTable`, `OrderTable`, `PackingQueue`, `ProductImage`) alongside the main layout, sidebar states, and global search filter logic. Similarly, form components like `NewOrder.tsx` (355 lines) and `NewProduct.tsx` (421 lines) combine dense UI layouts, complex mathematical calculations, and file-upload validation. This high degree of coupling reduces code readability, increases cognitive load for developers, and complicates testing. Refactoring these files now will establish a clean, modular foundation for future enhancements.

## What Changes

- **Extract Dashboard Sub-components**:
  - Move the `Overview` component into a new standalone file `src/components/Overview.tsx`.
  - Move `ProductTable` and its helper `ProductImage` into a new standalone file `src/components/ProductTable.tsx`.
  - Move `OrderTable` into a new standalone file `src/components/OrderTable.tsx`.
  - Move `PackingQueue` into a new standalone file `src/components/PackingQueue.tsx`.
- **Refactor `Dashboard.tsx`**:
  - Clean up `Dashboard.tsx` to act purely as the routing shell, layout wrapper, and state orchestrator for the above sub-components.
- **Refactor `NewOrder.tsx`**:
  - Extract the product selection/search logic and financial summary computation into helper functions or sub-components to improve legibility and maintainability.
- **Refactor `NewProduct.tsx`**:
  - Extract image-upload/validation handlers and specialized form fieldsets (such as Poster-specific specs) into focused, clean sub-components or helpers.
- **Expose via Exports**:
  - Update `src/components/index.ts` to export all newly created components.

## Capabilities

### New Capabilities

_(Skipped - Pure refactor under `skip_specs: true`)_

### Modified Capabilities

_(Skipped - Pure refactor under `skip_specs: true`)_

## Impact

- `src/components/Dashboard.tsx` (reduced lines of code, layout only)
- `src/components/Overview.tsx` (new component)
- `src/components/ProductTable.tsx` (new component)
- `src/components/OrderTable.tsx` (new component)
- `src/components/PackingQueue.tsx` (new component)
- `src/components/NewOrder.tsx` (refactored for cleaner form structure)
- `src/components/NewProduct.tsx` (refactored for cleaner form structure)
- `src/components/index.ts` (updated exports)
