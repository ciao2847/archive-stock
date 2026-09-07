## 1. Extract Dashboard Sub-Components

- [x] 1.1 Extract ProductTable into `src/components/products/ProductTable.tsx`. Verified existing standalone component file and imports.
- [x] 1.2 Extract OrderTable into `src/components/orders/OrderTable.tsx`. Verified existing standalone component file and imports.
- [x] 1.3 Create `src/components/dashboard/Overview.tsx` extracting stats cards, packing waitlist, financial summary, and recent products view. Verify file exists and exports Overview.
- [x] 1.4 Create `src/components/packing/PackingQueue.tsx` extracting queue heading and order packing list. Verify file exists and exports PackingQueue.
- [x] 1.5 Update `src/components/index.ts` to export all components with unified barrel exports. Verify exports with TypeScript typecheck.

## 2. Refactor Dashboard Shell & Organize Domain Folders

- [x] 2.1 Refactor `src/components/dashboard/Dashboard.tsx` to import `Overview` and `PackingQueue` and remove inline function implementations. Verify `Dashboard.tsx` compiles without missing references.
- [x] 2.2 Reorganize `src/components/` into feature domain folders (`dashboard/`, `products/`, `orders/`, `packing/`, `locations/`, `settlement/`, `settings/`, `ui/`) and update all internal and app-level imports.
- [x] 2.3 Verify overall dashboard navigation, props wiring, and line reduction in `Dashboard.tsx` via `npm run typecheck` and `npm run lint`.

## 3. Form Component Modularization

- [ ] 3.1 Refactor `src/components/orders/NewOrder.tsx` by extracting pricing calculation and product search helpers into focused utilities or sub-components. Verify order creation flow with typecheck.
- [ ] 3.2 Refactor `src/components/products/NewProduct.tsx` by separating image upload validation and spec fieldsets into reusable helpers or sub-components. Verify product creation flow with typecheck.

## 4. Final Quality Verification

- [ ] 4.1 Run full project build and lint verification (`npm run typecheck && npm run lint`). Verify 0 errors.
