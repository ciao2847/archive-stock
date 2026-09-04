import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260904015816_grant_authenticated_app_table_access.sql",
  "utf8",
);

describe("authenticated Data API table grants", () => {
  it("allows authenticated users to read profiles for ownership labels", () => {
    expect(migration).toMatch(
      /grant select on table public\.profiles to authenticated/i,
    );
  });

  it("grants products and orders to authenticated while leaving authorization to RLS", () => {
    expect(migration).toMatch(/public\.products/i);
    expect(migration).toMatch(/public\.orders/i);
    expect(migration).toMatch(/to authenticated/i);
    expect(migration).not.toMatch(/to anon/i);
  });

  it("does not disable or bypass RLS", () => {
    expect(migration).not.toMatch(/disable row level security/i);
    expect(migration).not.toMatch(/bypassrls/i);
  });
});
