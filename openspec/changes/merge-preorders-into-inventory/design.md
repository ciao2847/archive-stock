## Context
See proposal.md. Products have physical stock/QR/location data; claim submissions retain transaction snapshots and synchronously project into unique (order, product) fulfillment lines. Source tables require privileged mutations.

## Goals / Non-Goals
Goals: preserve the paid ledger and fulfillable identity, give staff a concrete preview, and serialize confirmation with concurrent writes.
Non-goals: bulk or automatic matching, merging two physically received products, combining distinct customer lines or repricing orders.

## Decisions
- Keep source rows with merged_into_product_id, merged_at and merged_by. Exclude them from active APIs and guard future writes. This preserves auditability instead of destructive deletion.
- Use one authenticated RPC for preview/commit, a private definer implementation with an invoker public wrapper, explicit owner checks, empty search_path and revoked default privileges. Existing RLS prohibits direct source mutations.
- A source must have zero stock and no location, QR labels, movements or allocations, and must have preorder/listing history. A target must have receiving evidence. Same-inventory pairs only.
- A commit takes short write locks across referenced ledgers, then locks both products deterministically and recomputes the preview token. Preview is read-only. Timeouts return retryable errors; no user interaction occurs while holding locks.
- Rewrite fulfillment identities before claim item identities so existing synchronization guards see an equivalent projection, including locked orders. Preserve all scalar transaction snapshots and progress fields.
- Keep an existing target listing when both are on a form; otherwise move the source listing preserving its settings. A customer-order collision blocks the operation because the existing unique-line schema cannot preserve two original prices without a broader checkout redesign.
- UI opens from claim product settings, requires saved settings first, searches same-inventory received products, previews and explicitly confirms, then reloads canonical persisted form data, replaces the affected local product selection, and reloads products/orders. Unrelated title/appearance drafts remain intact. Failed refresh after success is reported separately from failed merge.

## Risks / Trade-offs
- Short table write locks can contend with checkout → lock timeout, atomic rollback, retry message; ordinary reads continue.
- Stale tabs can attempt source references → database guards reject them.
- Same-order collisions cannot be safely collapsed → preview blocks and identifies affected order numbers.
- Existing unrelated local changes → keep edits scoped; no live merges are performed by implementation or tests.

## Migration Plan
Apply the additive migration before deploying dependent UI/API code; run database/API/browser regressions first. Do not reverse a performed identity merge by deleting audit metadata. Roll back application UI if necessary; retain metadata and guards for completed merges.
