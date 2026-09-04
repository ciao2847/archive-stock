// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260904020810_scope_inventory_domains_by_owner.sql",
  ),
  "utf8",
).toLowerCase();

describe("owner domain scope migration", () => {
  it.each(["orders", "customers", "locations", "settlements"])(
    "adds a required owner to %s",
    (table) => {
      expect(migration).toContain(`alter table public.${table}`);
      expect(migration).toContain(`${table}_owner_id_idx`);
    },
  );

  it("isolates orders, customers and locations with auth.uid plus admin override", () => {
    expect(migration).toContain('policy "owners or admins read orders"');
    expect(migration).toContain('policy "owners or admins read customers"');
    expect(migration).toContain('policy "owners or admins read locations"');
    expect(migration).toContain(
      'policy "product owners or admins read movements"',
    );
    expect(migration).toContain("owner_id = (select auth.uid())");
    expect(migration).toContain("(select public.my_role()) = 'admin'");
  });

  it("prevents products, locations and order items from crossing owners", () => {
    expect(migration).toContain("enforce_inventory_owner_consistency");
    expect(migration).toContain("enforce_order_item_owner_consistency");
    expect(migration).toContain("mixed product owners are not allowed");
  });

  it("scopes settlement inputs to one owner without bypassing RLS", () => {
    expect(migration).toContain(
      "create function public.create_financial_settlement(p_owner_id uuid",
    );
    expect(migration).toContain("where o.owner_id=p_owner_id");
    expect(migration).toContain("where p.owner_id=p_owner_id");
    expect(migration).toContain("security invoker");
  });
});
