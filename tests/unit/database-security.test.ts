// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260903001511_harden_rls_and_rpc_privileges.sql",
  ),
  "utf8",
).toLowerCase();

const publicTables = [
  "profiles",
  "works",
  "locations",
  "products",
  "location_movements",
  "customers",
  "orders",
  "order_items",
  "packing_scans",
  "product_qr_labels",
  "settlements",
  "settlement_orders",
  "settlement_products",
];

const privilegedFunctions = [
  "create_inventory_product",
  "update_inventory_product",
  "adjust_product_stock",
  "archive_order",
  "complete_order_packing",
  "consume_product_qr",
  "consume_product_sku",
  "create_financial_settlement",
  "create_order_with_items",
  "delete_inventory_product",
  "get_admin_product_costs",
  "set_admin_product_cost",
  "update_order_details",
  "update_order_financials",
];

describe("database security migration", () => {
  it.each(publicTables)("enables RLS for %s", (table) => {
    expect(migration).toContain(
      `alter table public.${table} enable row level security`,
    );
  });

  it.each(privilegedFunctions)(
    "includes %s in privilege hardening",
    (functionName) => {
      expect(
        migration.includes(`'${functionName}'`) ||
          migration.includes(`revoke all on function public.${functionName}(`),
      ).toBe(true);
    },
  );

  it("revokes public/anon and grants only authenticated execution dynamically", () => {
    expect(migration).toContain(
      "execute format('revoke all on function %s from public, anon', v_function)",
    );
    expect(migration).toContain(
      "execute format('grant execute on function %s to authenticated', v_function)",
    );
  });

  it("defines the stock RPC instead of assuming a legacy script installed it", () => {
    expect(migration).toContain(
      "create or replace function public.adjust_product_stock(",
    );
  });

  it("keeps only the public QR landing function anonymous", () => {
    expect(migration).toMatch(
      /grant execute on function public\.get_public_qr_landing\(uuid, text\)[\s\S]*?to anon, authenticated/,
    );
  });
});
