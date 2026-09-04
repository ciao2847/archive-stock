// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260904024911_allow_admin_force_delete_records.sql",
  ),
  "utf8",
).toLowerCase();

describe("admin force-delete migration", () => {
  it("keeps both destructive functions admin-only and security-invoker", () => {
    expect(migration).toContain(
      "create or replace function public.force_delete_order",
    );
    expect(migration).toContain(
      "create or replace function public.delete_inventory_product",
    );
    expect(migration).toContain("(select public.my_role()) <> 'admin'");
    expect(migration).toContain("security invoker");
    expect(migration).toContain(
      "revoke all on function public.force_delete_order(uuid) from public, anon",
    );
  });

  it("deletes order settlement, packing and detail history", () => {
    expect(migration).toContain("delete from public.settlements s");
    expect(migration).toContain(
      "delete from public.packing_scans where order_id",
    );
    expect(migration).toContain(
      "delete from public.order_items where order_id",
    );
    expect(migration).toContain("delete from public.orders where id");
  });

  it("restores stock for previously packed or shipped orders", () => {
    expect(migration).toContain("if v_status in ('packed', 'shipped')");
    expect(migration).toContain("set stock = p.stock + item.quantity");
  });

  it("deletes every product dependency and its referencing orders", () => {
    expect(migration).toContain(
      "perform public.force_delete_order(v_order_id)",
    );
    expect(migration).toContain("delete from public.product_qr_labels");
    expect(migration).toContain("delete from public.location_movements");
    expect(migration).toContain("delete from public.products where id");
  });
});
