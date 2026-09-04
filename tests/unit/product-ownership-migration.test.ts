// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260904003415_add_product_ownership.sql",
  ),
  "utf8",
).toLowerCase();

describe("product ownership migration", () => {
  it("adds a required indexed owner foreign key", () => {
    expect(migration).toContain("owner_id uuid references public.profiles(id)");
    expect(migration).toContain("alter column owner_id set not null");
    expect(migration).toContain("products_owner_id_idx");
  });

  it("backfills existing products before requiring ownership", () => {
    expect(migration.indexOf("set owner_id = created_by")).toBeLessThan(
      migration.indexOf("alter column owner_id set not null"),
    );
  });

  it("limits product reads and writes by auth.uid with an admin override", () => {
    expect(migration).toContain('policy "owners or admins read products"');
    expect(migration).toContain('policy "owners create products"');
    expect(migration).toContain('policy "owners or admins update products"');
    expect(migration).toContain("owner_id = (select auth.uid())");
    expect(migration).toContain("(select public.my_role()) = 'admin'");
  });

  it("applies parent-product ownership to QR labels", () => {
    expect(migration).toContain(
      'policy "product owners or admins read qr labels"',
    );
    expect(migration).toContain(
      'policy "product owners or admins create qr labels"',
    );
    expect(migration).toContain(
      'policy "product owners or admins update qr labels"',
    );
  });

  it("keeps public recommendations within the scanned product owner", () => {
    expect(migration).toContain("product.owner_id = source_product.owner_id");
  });
});
