import { describe, expect, it } from "vitest";

import {
  API_ROUTES,
  isProductAvailable,
  LOCATION_CODE_PATTERN,
  PRODUCT_SKU_PATTERN,
} from "@/constants";

describe("shared constants", () => {
  it("encodes dynamic API route segments", () => {
    expect(API_ROUTES.product("a/b")).toBe("/api/products/a%2Fb");
  });

  it("accepts only valid location and product codes", () => {
    expect(LOCATION_CODE_PATTERN.test("A-03-02")).toBe(true);
    expect(LOCATION_CODE_PATTERN.test("A-3-2")).toBe(false);
    expect(PRODUCT_SKU_PATTERN.test("A000123")).toBe(true);
  });

  it("requires both stock and available status", () => {
    expect(isProductAvailable("在庫", 1)).toBe(true);
    expect(isProductAvailable("在庫", 0)).toBe(false);
    expect(isProductAvailable("已預留", 1)).toBe(false);
  });
});
