## Context

`Dashboard.tsx` currently houses the main application shell, sidebar, and layout alongside inline implementations of `Overview` and `PackingQueue`. While `ProductTable` and `OrderTable` have already been extracted into standalone components, `Overview` (195 lines) and `PackingQueue` (23 lines) remain embedded inside `Dashboard.tsx`. Additionally, `NewOrder.tsx` and `NewProduct.tsx` contain densely coupled form rendering and calculation/upload logic. See `proposal.md` for motivation.

## Goals / Non-Goals

**Goals:**
- Extract `Overview` into `src/components/Overview.tsx` as a standalone presentation/sub-dashboard component.
- Extract `PackingQueue` into `src/components/PackingQueue.tsx` as a standalone order queuing component.
- Standardize the `DashboardView` type so views can be shared cleanly across `Dashboard.tsx` and `Overview.tsx` without circular imports.
- Re-export the newly extracted components via `src/components/index.ts`.
- Reduce `Dashboard.tsx` down to an orchestrator/layout shell handling navigation, global filters, and batch printing state.
- Provide a structured decomposition plan for `NewOrder.tsx` and `NewProduct.tsx` helper and form sub-components.

**Non-Goals:**
- Altering any visual layout, CSS styling, or runtime behavior of the dashboard views or packing queue.
- Modifying backend APIs, database schemas, or RPC functions.
- Redesigning form submission validation logic in Zod or database types.

## Decisions

### 1. Standalone `Overview.tsx` and `PackingQueue.tsx`
Extract `Overview` and `PackingQueue` into dedicated files in `src/components/`.
- **Rationale**: Isolates domain-specific dashboard widgets from top-level routing, search filter state, and batch-print controls in `Dashboard.tsx`.
- **Alternatives Considered**: Keeping them in `Dashboard.tsx` as sub-functions. Rejected because `Dashboard.tsx` remains bloated (>830 lines) and difficult to maintain.

### 2. View Type Definition Placement
Export `DashboardView` (or `View`) from `src/lib/types.ts` or `src/components/Dashboard.tsx` and import it into `Overview.tsx`.
- **Rationale**: `Overview` requires an `onNavigate: (view: DashboardView) => void` callback. Defining or re-exporting this cleanly prevents cyclic dependencies or loose `string` typing.
- **Alternatives Considered**: Using a raw `string` for view navigation in `Overview`. Rejected because it loses TypeScript compile-time exhaustiveness checking.

### 3. Component Interface Contracts
- **`OverviewProps`**:
  ```ts
  export interface OverviewProps {
    onNavigate: (view: DashboardView) => void;
    products: Product[];
    orders: Order[];
    finance: { revenue: number; cost: number; profit: number } | null;
    isAdmin: boolean;
    roleLoaded: boolean;
    onPack: (order: Order) => void;
    onSelectProduct: (product: Product) => void;
  }
  ```
- **`PackingQueueProps`**:
  ```ts
  export interface PackingQueueProps {
    orders: Order[];
    onPack: (order: Order) => void;
  }
  ```
- **Rationale**: Props remain 100% backward-compatible with the existing inline calls inside `Dashboard.tsx`, ensuring zero behavioral regressions.

### 4. Phased Form Component Modularization
For `NewOrder.tsx` and `NewProduct.tsx`:
- Keep form state and submission orchestration in the main component.
- Extract calculation logic (discounts, net revenue, shipping math) and specialized field groups into helper files or focused sub-components.

## Risks / Trade-offs

- **[Risk] Unintended re-renders when passing callbacks down to standalone components** → **Mitigation**: Props and callbacks (`onPack`, `onSelectProduct`, `onNavigate`) are already stable or memoized in `Dashboard.tsx`.
- **[Risk] Circular dependency between `Dashboard.tsx` and `Overview.tsx`** → **Mitigation**: Place `DashboardView` in `src/lib/types.ts` or a shared types file so neither component imports the other for types.
